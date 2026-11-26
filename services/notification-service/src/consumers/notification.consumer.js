const amqplib = require('amqplib');
const config = require('../config/env');
const defaultNotificationService = require('../services/notification.service');
const defaultDataSource = require('../config/data-source');
const { ReminderSchedulerService } = require('../services/reminder-scheduler.service');
const { NOTIFICATION_TYPE } = require('../constants/notification-type');
const { PROCESSING_STATUS } = require('../constants/processing-status');

/**
 * Format ISO datetime string to clean date
 * @param {string|Date} dateVal 
 * @returns {string}
 */
function formatDate(dateVal) {
  if (!dateVal) return 'Scheduled Date';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toISOString().split('T')[0];
  } catch {
    return String(dateVal);
  }
}

/**
 * Format ISO datetime string to clean UTC time
 * @param {string|Date} dateVal 
 * @returns {string}
 */
function formatTime(dateVal) {
  if (!dateVal) return 'Scheduled Time';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toISOString().split('T')[1].slice(0, 5) + ' UTC';
  } catch {
    return String(dateVal);
  }
}

/**
 * Detects whether an error is a database unique constraint violation / duplicate key conflict
 * @param {Error} error
 * @returns {boolean}
 */
function isDuplicateKeyError(error) {
  if (!error) return false;
  if (error.number === 2601 || error.number === 2627) return true;
  const msg = String(error.message || '').toLowerCase();
  return (
    msg.includes('duplicate key') ||
    msg.includes('unique constraint') ||
    msg.includes('violation of unique key') ||
    msg.includes('violation of primary key') ||
    msg.includes('uniqueindex')
  );
}

/**
 * Notification RabbitMQ Event Consumer
 * Subscribes to 'parkease.events' (Topic) for booking domain events,
 * guarantees deduplication via processed_events, and manages bounded retries/DLQ.
 */
class NotificationConsumer {
  /**
   * @param {object} [options]
   * @param {object} [options.amqpLib] - Injected amqplib for testing
   * @param {object} [options.notificationService] - Injected NotificationService
   * @param {object} [options.dataSource] - Injected TypeORM DataSource
   * @param {object} [options.config] - Injected configuration
   */
  constructor(options = {}) {
    this.amqp = options.amqpLib || amqplib;
    this.notificationService = options.notificationService || defaultNotificationService;
    this.dataSource = options.dataSource || defaultDataSource;
    this.cfg = options.config || config.rabbitmq;

    if (options.reminderScheduler) {
      this.reminderScheduler = options.reminderScheduler;
    } else if (this.dataSource && typeof this.dataSource.createQueryRunner === 'function') {
      this.reminderScheduler = new ReminderSchedulerService({ dataSource: this.dataSource });
    } else {
      this.reminderScheduler = null;
    }

    this.connection = null;
    this.channel = null;
    this.consumerTag = null;
    this.isShuttingDown = false;
    this.isConnected = false;
    this.reconnectTimer = null;
  }

  /**
   * Initialize RabbitMQ topology and start consumer
   */
  async start() {
    this.isShuttingDown = false;

    try {
      this.connection = await this.amqp.connect(this.cfg.url);
      this.isConnected = true;

      this.connection.on('error', (err) => {
        console.error('[NotificationConsumer Error] RabbitMQ Connection error:', err.message);
      });

      this.connection.on('close', () => {
        this.isConnected = false;
        if (!this.isShuttingDown) {
          console.warn('[NotificationConsumer] RabbitMQ connection closed unexpectedly. Scheduling reconnect...');
          this._scheduleReconnect();
        }
      });

      // Create ConfirmChannel for publisher confirmations
      if (typeof this.connection.createConfirmChannel === 'function') {
        this.channel = await this.connection.createConfirmChannel();
      } else {
        this.channel = await this.connection.createChannel();
      }

      // Set QoS Prefetch
      await this.channel.prefetch(this.cfg.prefetch || 10);

      // 1. Assert Dead Letter Exchange and Queue
      await this.channel.assertExchange(this.cfg.dlx, 'direct', { durable: true });
      await this.channel.assertQueue(this.cfg.dlq, { durable: true });
      await this.channel.bindQueue(this.cfg.dlq, this.cfg.dlx, 'dead');

      // 2. Assert Primary Topic Exchange
      await this.channel.assertExchange(this.cfg.exchange, 'topic', { durable: true });

      // 3. Assert Delayed Retry Topic Exchange and Retry Queue with TTL and Dead-Lettering
      const retryExchange = this.cfg.retryExchange || 'parkease.events.retry';
      const retryQueue = this.cfg.retryQueue || 'parkease.notifications.retry.queue';
      const retryDelayMs = this.cfg.retryDelayMs || 5000;

      await this.channel.assertExchange(retryExchange, 'topic', { durable: true });
      await this.channel.assertQueue(retryQueue, {
        durable: true,
        arguments: {
          'x-message-ttl': retryDelayMs,
          'x-dead-letter-exchange': this.cfg.exchange
        }
      });

      // 4. Bind Retry Queue to Retry Exchange for relevant booking routing keys
      const routingKeys = [
        'booking.created',
        'booking.cancelled',
        'booking.status.changed',
        'booking.status-changed'
      ];
      for (const key of routingKeys) {
        await this.channel.bindQueue(retryQueue, retryExchange, key);
      }

      // 5. Assert Primary Notification Queue with DLX configuration
      const queueOptions = {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': this.cfg.dlx,
          'x-dead-letter-routing-key': 'dead'
        }
      };
      await this.channel.assertQueue(this.cfg.queue, queueOptions);

      // 6. Bind Primary Queue to Primary Topic Exchange
      for (const key of routingKeys) {
        await this.channel.bindQueue(this.cfg.queue, this.cfg.exchange, key);
      }

      // 7. Start Consuming
      const { consumerTag } = await this.channel.consume(
        this.cfg.queue,
        (msg) => this.handleMessage(msg),
        { noAck: false }
      );
      this.consumerTag = consumerTag;

      console.log(`[NotificationConsumer] Started consuming from queue '${this.cfg.queue}' (prefetch: ${this.cfg.prefetch || 10})`);
      return { consumerTag };
    } catch (error) {
      console.error('[NotificationConsumer Error] Failed to initialize RabbitMQ consumer:', error.message);
      if (!this.isShuttingDown) {
        this._scheduleReconnect();
      }
      throw error;
    }
  }

  /**
   * Schedule automatic reconnection with backoff
   * @private
   */
  _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      if (!this.isShuttingDown && !this.isConnected) {
        console.log('[NotificationConsumer] Attempting to reconnect to RabbitMQ...');
        try {
          await this.start();
        } catch (err) {
          console.error('[NotificationConsumer] Reconnect failed:', err.message);
        }
      }
    }, 5000);
  }

  /**
   * Process individual message from queue
   * @param {import('amqplib').ConsumeMessage|null} msg 
   */
  async handleMessage(msg) {
    if (!msg) return; // Consumer cancelled by broker

    const routingKey = msg.fields.routingKey;
    const currentRetryCount = (msg.properties.headers && msg.properties.headers['x-retry-count']) || 0;

    // 1. Safe JSON parsing
    let payload;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch (parseError) {
      console.error(`[NotificationConsumer] Malformed JSON received on routingKey '${routingKey}'. Routing to DLQ. Error:`, parseError.message);
      this.channel.reject(msg, false); // Do not requeue poisoned message
      return;
    }

    // 2. Extract Event ID
    const eventId = msg.properties.messageId ||
      payload.eventId ||
      (payload.bookingId ? `evt-${routingKey.replace(/\./g, '-')}-${payload.bookingId}-${payload.currentStatus || payload.status || 'init'}` : null);

    if (!eventId) {
      console.error(`[NotificationConsumer] Missing eventId and bookingId on message '${routingKey}'. Routing to DLQ.`);
      this.channel.reject(msg, false);
      return;
    }

    // 3. Payload Validation
    if (!payload.bookingId || !payload.userId) {
      console.error(`[NotificationConsumer] Event validation failed: Missing bookingId or userId for eventId '${eventId}'. Routing to DLQ.`);
      this.channel.reject(msg, false);
      return;
    }

    // 4. Idempotency Check using processed_events
    const processedEventRepo = this.dataSource.getRepository('ProcessedEvent');
    try {
      const existingEvent = await processedEventRepo.findOneBy({ eventId });
      if (existingEvent) {
        if (existingEvent.processingStatus === PROCESSING_STATUS.COMPLETED) {
          console.log(`[NotificationConsumer] Duplicate event detected (eventId: ${eventId}). Acknowledging without re-processing.`);
          this.channel.ack(msg);
          return;
        }

        if (existingEvent.processingStatus === PROCESSING_STATUS.FAILED && existingEvent.retryCount >= (this.cfg.retryLimit || 3)) {
          console.warn(`[NotificationConsumer] Event previously exhausted max retries (eventId: ${eventId}). Routing to DLQ.`);
          this.channel.reject(msg, false);
          return;
        }
      } else {
        // Record event ingestion
        await processedEventRepo.save({
          eventId,
          eventType: routingKey,
          processingStatus: PROCESSING_STATUS.RECEIVED,
          retryCount: currentRetryCount
        });
      }
    } catch (dbError) {
      if (isDuplicateKeyError(dbError)) {
        console.warn(`[NotificationConsumer] Concurrent duplicate event insertion detected for event '${eventId}'. Re-checking event state...`);
        try {
          const reloadedEvent = await processedEventRepo.findOneBy({ eventId });
          if (reloadedEvent) {
            if (reloadedEvent.processingStatus === PROCESSING_STATUS.COMPLETED) {
              console.log(`[NotificationConsumer] Concurrent event '${eventId}' already completed by another worker. Acknowledging.`);
              this.channel.ack(msg);
              return;
            }
            // Event is currently being processed by another worker (RECEIVED, PERSISTED, etc.):
            // Acknowledge this duplicate delivery to prevent parallel dispatch
            console.log(`[NotificationConsumer] Concurrent event '${eventId}' is currently being processed (${reloadedEvent.processingStatus}). Acknowledging duplicate delivery.`);
            this.channel.ack(msg);
            return;
          }
        } catch (reloadErr) {
          console.error(`[NotificationConsumer] Error re-checking event '${eventId}' after conflict:`, reloadErr.message);
        }
      }

      console.error(`[NotificationConsumer Error] Database error checking idempotency for event '${eventId}':`, dbError.message);
      // Transient DB error: reject with requeue if retryable
      return this._handleRetry(msg, eventId, routingKey, currentRetryCount, dbError.message);
    }

    // 5. Map Event to Notification Parameters
    const dispatchPlan = this._mapEventToNotification(routingKey, payload);

    // 5b. Trigger Reminder Scheduler hooks (Phase 6)
    if (this.reminderScheduler) {
      try {
        if (routingKey === 'booking.created') {
          await this.reminderScheduler.handleBookingCreated(payload);
        } else if (routingKey === 'booking.status_changed') {
          await this.reminderScheduler.handleBookingStatusChanged(payload);
        }
      } catch (remErr) {
        console.error(`[NotificationConsumer] Error in reminder scheduler for event '${eventId}':`, remErr.message);
      }
    }

    if (!dispatchPlan) {
      // Ignored transition (e.g. status transition that requires no user notification)
      console.log(`[NotificationConsumer] Event '${routingKey}' status '${payload.previousStatus} -> ${payload.currentStatus}' ignored. Acknowledging.`);
      await this._markEventCompleted(eventId, processedEventRepo);
      this.channel.ack(msg);
      return;
    }

    // 6. Process Notification through NotificationService
    try {
      const result = await this.notificationService.processNotification({
        eventId,
        idempotencyKey: `NOTIF-${eventId}`,
        userId: payload.userId,
        recipientEmail: payload.recipientEmail, // Will resolve via User Service if absent
        notificationType: dispatchPlan.notificationType,
        subject: dispatchPlan.subject,
        templateName: dispatchPlan.templateName,
        templateData: dispatchPlan.templateData
      });

      // 7a. Notification Sent or Processed Successfully
      if (result.delivered) {
        await this._markEventCompleted(eventId, processedEventRepo);
        this.channel.ack(msg);
        console.log(`[NotificationConsumer] Successfully processed and dispatched notification for event '${eventId}'. Acknowledged.`);
        return;
      }

      // 7b. Permanent Failure (e.g. User 404 in User Service) - Do NOT retry
      if (!result.delivered && result.retryable === false) {
        await processedEventRepo.update({ eventId }, {
          processingStatus: PROCESSING_STATUS.FAILED,
          lastError: result.error || 'Permanent resolution failure',
          processedAt: new Date()
        });
        this.channel.ack(msg); // Do not requeue permanent failures; error is audited in notifications table
        console.warn(`[NotificationConsumer] Permanent failure for event '${eventId}': ${result.error}. Acknowledged without requeue.`);
        return;
      }

      // 7c. Transient Failure (e.g. User Service down, network error) - Trigger Bounded Retry
      await this._handleRetry(msg, eventId, routingKey, currentRetryCount, result.error);
    } catch (processingError) {
      console.error(`[NotificationConsumer Error] Unexpected error processing event '${eventId}':`, processingError.message);
      await this._handleRetry(msg, eventId, routingKey, currentRetryCount, processingError.message);
    }
  }

  /**
   * Helper to mark processed_events record as COMPLETED
   * @private
   */
  async _markEventCompleted(eventId, repo) {
    try {
      await repo.update({ eventId }, {
        processingStatus: PROCESSING_STATUS.COMPLETED,
        processedAt: new Date()
      });
    } catch (err) {
      console.error(`[NotificationConsumer Error] Failed to update processed_event status for '${eventId}':`, err.message);
    }
  }

  /**
   * Bounded delayed retry logic using RabbitMQ TTL and Publisher Confirms
   * @private
   */
  async _handleRetry(msg, eventId, routingKey, currentRetryCount, errorMessage) {
    const maxRetries = this.cfg.retryLimit || 3;
    const retryExchange = this.cfg.retryExchange || 'parkease.events.retry';
    const retryDelayMs = this.cfg.retryDelayMs || 5000;
    const processedEventRepo = this.dataSource.getRepository('ProcessedEvent');

    if (currentRetryCount < maxRetries) {
      const nextRetryCount = currentRetryCount + 1;
      console.warn(`[NotificationConsumer] Transient error for event '${eventId}'. Attempt ${nextRetryCount} of ${maxRetries}. Scheduling delayed retry (${retryDelayMs}ms)... Error: ${errorMessage}`);

      try {
        await processedEventRepo.update({ eventId }, {
          processingStatus: PROCESSING_STATUS.PERSISTED,
          retryCount: nextRetryCount,
          lastError: errorMessage
        });
      } catch (e) {
        // Continue retry even if tracking update fails
      }

      // Re-publish to retry exchange with updated retry-count header
      const headers = {
        ...(msg.properties.headers || {}),
        'x-retry-count': nextRetryCount
      };

      const publishOptions = {
        ...msg.properties,
        headers
      };

      try {
        // 4. Wait for RabbitMQ publisher confirmation before acknowledging original message
        await this._publishWithConfirm(
          retryExchange,
          routingKey,
          msg.content,
          publishOptions
        );

        // 5. Only after broker confirmation, ACK the original message
        this.channel.ack(msg);
        console.log(`[NotificationConsumer] Retry attempt ${nextRetryCount} published with confirmation to '${retryExchange}'. Original message ACKed.`);
      } catch (publishErr) {
        console.error(`[NotificationConsumer Error] Publisher confirmation failed for retry of event '${eventId}':`, publishErr.message);
        // Do NOT acknowledge the original message if publishing was not confirmed
        // Requeue to avoid message loss
        this.channel.nack(msg, false, true);
      }
    } else {
      // Max Retries Exhausted: Reject to DLQ
      console.error(`[NotificationConsumer] Max retries (${maxRetries}) exhausted for event '${eventId}'. Routing to Dead Letter Queue.`);

      try {
        await processedEventRepo.update({ eventId }, {
          processingStatus: PROCESSING_STATUS.FAILED,
          retryCount: currentRetryCount,
          lastError: `Max retries (${maxRetries}) exhausted: ${errorMessage}`,
          processedAt: new Date()
        });
      } catch (e) {
        // Ignore DB update error on rejection
      }

      // Reject without requeue -> RabbitMQ routes message to x-dead-letter-exchange
      this.channel.reject(msg, false);
    }
  }

  /**
   * Helper to publish with broker confirmation on ConfirmChannel
   * @private
   */
  _publishWithConfirm(exchange, routingKey, content, options) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const callback = (err, ok) => {
        if (settled) return;
        settled = true;
        if (err) return reject(err);
        resolve(ok);
      };

      try {
        const published = this.channel.publish(exchange, routingKey, content, options, callback);
        if (!settled) {
          if (typeof this.channel.waitForConfirms === 'function') {
            this.channel.waitForConfirms()
              .then(() => {
                if (!settled) {
                  settled = true;
                  resolve(true);
                }
              })
              .catch((err) => {
                if (!settled) {
                  settled = true;
                  reject(err);
                }
              });
          } else {
            // For channels or test mocks that execute synchronously or do not call callback
            setImmediate(() => {
              if (!settled) {
                settled = true;
                resolve(published !== false);
              }
            });
          }
        }
      } catch (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });
  }

  /**
   * Map domain event payload to notification type, subject, and template data
   * @private
   */
  _mapEventToNotification(routingKey, payload) {
    const facilityName = payload.facilityName || payload.facilityId;
    const bookingDate = formatDate(payload.startTime);
    const startTime = formatTime(payload.startTime);
    const endTime = formatTime(payload.endTime);

    // 1. BOOKING_CREATED
    if (routingKey === 'booking.created') {
      return {
        notificationType: NOTIFICATION_TYPE.BOOKING_CREATED,
        subject: 'ParkEase - Reservation Created',
        templateName: 'booking-created',
        templateData: {
          bookingReference: payload.bookingReference,
          facilityName,
          bookingDate,
          startTime,
          endTime,
          totalAmount: payload.totalAmount
        }
      };
    }

    // 2. BOOKING_CANCELLED
    if (routingKey === 'booking.cancelled') {
      return {
        notificationType: NOTIFICATION_TYPE.BOOKING_CANCELLED,
        subject: 'ParkEase - Reservation Cancelled',
        templateName: 'booking-cancelled',
        templateData: {
          bookingReference: payload.bookingReference,
          facilityName,
          bookingDate,
          startTime,
          endTime,
          message: payload.cancellationReason || 'Cancelled by customer'
        }
      };
    }

    // 3. BOOKING_STATUS_CHANGED
    if (routingKey === 'booking.status.changed' || routingKey === 'booking.status-changed') {
      if (payload.currentStatus === 'CONFIRMED') {
        return {
          notificationType: NOTIFICATION_TYPE.BOOKING_CONFIRMED,
          subject: 'ParkEase - Reservation Confirmed!',
          templateName: 'booking-confirmed',
          templateData: {
            bookingReference: payload.bookingReference,
            facilityName,
            bookingDate,
            startTime,
            endTime
          }
        };
      }

      if (payload.currentStatus === 'EXPIRED') {
        return {
          notificationType: NOTIFICATION_TYPE.BOOKING_EXPIRED,
          subject: 'ParkEase - Reservation Hold Expired',
          templateName: 'booking-expired',
          templateData: {
            bookingReference: payload.bookingReference,
            facilityName,
            bookingDate,
            startTime,
            endTime,
            message: 'Pending reservation hold elapsed'
          }
        };
      }

      // Other status transitions (e.g. PENDING -> PENDING, or COMPLETED) do not trigger notification
      return null;
    }

    return null;
  }

  /**
   * Graceful shutdown: cancel consumer, close channel and connection
   */
  async stop() {
    this.isShuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    try {
      if (this.channel && this.consumerTag) {
        await this.channel.cancel(this.consumerTag);
      }
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      console.log('[NotificationConsumer] Graceful shutdown completed.');
    } catch (err) {
      console.warn('[NotificationConsumer] Error during shutdown:', err.message);
    }
  }
}

const defaultConsumer = new NotificationConsumer();
defaultConsumer.NotificationConsumer = NotificationConsumer;

module.exports = defaultConsumer;
