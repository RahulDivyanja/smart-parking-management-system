const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { NotificationConsumer } = require('../../src/consumers/notification.consumer');
const { NOTIFICATION_TYPE } = require('../../src/constants/notification-type');
const { PROCESSING_STATUS } = require('../../src/constants/processing-status');

describe('RabbitMQ Notification Consumer Unit Tests', () => {
  let mockChannel;
  let mockConnection;
  let mockAmqp;
  let mockProcessedEventRepo;
  let mockDataSource;
  let mockNotificationService;
  let processedEventStore;

  beforeEach(() => {
    processedEventStore = new Map();

    mockProcessedEventRepo = {
      findOneBy: async (criteria) => {
        for (const item of processedEventStore.values()) {
          let match = true;
          for (const key of Object.keys(criteria)) {
            if (item[key] !== criteria[key]) match = false;
          }
          if (match) return item;
        }
        return null;
      },
      save: async (entity) => {
        const record = { ...entity, id: `pe-${Date.now()}` };
        processedEventStore.set(entity.eventId, record);
        return record;
      },
      update: async (criteria, updates) => {
        const record = processedEventStore.get(criteria.eventId);
        if (record) {
          Object.assign(record, updates);
        }
        return { affected: record ? 1 : 0 };
      }
    };

    mockDataSource = {
      getRepository: (entity) => {
        if (entity === 'ProcessedEvent') return mockProcessedEventRepo;
        throw new Error(`Unexpected entity: ${entity}`);
      }
    };

    mockNotificationService = {
      processNotification: async () => ({
        delivered: true,
        notification: { id: 'notif-1' }
      })
    };

    mockChannel = {
      assertExchange: async () => {},
      assertQueue: async () => {},
      bindQueue: async () => {},
      prefetch: async () => {},
      consume: async (queue, callback) => {
        mockChannel._callback = callback;
        return { consumerTag: 'test-consumer-tag-123' };
      },
      ack: (msg) => {
        mockChannel._acked = mockChannel._acked || [];
        mockChannel._acked.push(msg);
      },
      reject: (msg, requeue) => {
        mockChannel._rejected = mockChannel._rejected || [];
        mockChannel._rejected.push({ msg, requeue });
      },
      nack: (msg, allUpTo, requeue) => {
        mockChannel._nacked = mockChannel._nacked || [];
        mockChannel._nacked.push({ msg, allUpTo, requeue });
      },
      publish: (exchange, routingKey, content, properties, callback) => {
        mockChannel._published = mockChannel._published || [];
        mockChannel._published.push({ exchange, routingKey, content, properties });
        if (typeof callback === 'function') {
          callback(null, true);
        }
        return true;
      },
      cancel: async () => {},
      close: async () => {}
    };

    mockConnection = {
      createChannel: async () => mockChannel,
      createConfirmChannel: async () => mockChannel,
      on: (event, handler) => {
        mockConnection._handlers = mockConnection._handlers || {};
        mockConnection._handlers[event] = handler;
      },
      close: async () => {}
    };

    mockAmqp = {
      connect: async () => mockConnection
    };
  });

  let msgCounter = 1;
  // Helper to create synthetic AMQP message
  const createMockMsg = (routingKey, payloadObj, headers = {}, messageId = null) => {
    return {
      fields: { routingKey },
      properties: {
        messageId: messageId || `msg-${Date.now()}-${msgCounter++}`,
        headers
      },
      content: Buffer.from(typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj))
    };
  };

  it('1. should successfully connect and initialize topology (exchange, DLX, queues, bindings, prefetch)', async () => {
    const assertedExchanges = [];
    const assertedQueues = [];
    const boundQueues = [];
    let configuredPrefetch = null;

    mockChannel.assertExchange = async (name, type) => assertedExchanges.push({ name, type });
    mockChannel.assertQueue = async (name, opts) => assertedQueues.push({ name, opts });
    mockChannel.bindQueue = async (queue, ex, rk) => boundQueues.push({ queue, ex, rk });
    mockChannel.prefetch = async (count) => { configuredPrefetch = count; };

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });

    const result = await consumer.start();

    assert.strictEqual(result.consumerTag, 'test-consumer-tag-123');
    assert.strictEqual(configuredPrefetch, 10);

    // Verify DLX and Main Exchange
    assert.ok(assertedExchanges.find(e => e.name === 'parkease.events.dlx' && e.type === 'direct'));
    assert.ok(assertedExchanges.find(e => e.name === 'parkease.events' && e.type === 'topic'));

    // Verify Delayed Retry Exchange and Queue with TTL and DLX arguments
    const retryEx = assertedExchanges.find(e => e.name === 'parkease.events.retry' && e.type === 'topic');
    assert.ok(retryEx, 'Delayed retry exchange must be declared as topic');
    const retryQ = assertedQueues.find(q => q.name === 'parkease.notifications.retry.queue');
    assert.ok(retryQ, 'Delayed retry queue must be declared');
    assert.strictEqual(retryQ.opts.arguments['x-message-ttl'], 5000);
    assert.strictEqual(retryQ.opts.arguments['x-dead-letter-exchange'], 'parkease.events');
    assert.ok(boundQueues.find(b => b.queue === 'parkease.notifications.retry.queue' && b.ex === 'parkease.events.retry' && b.rk === 'booking.created'));

    // Verify DLQ and Main Queue with DLX arguments
    assert.ok(assertedQueues.find(q => q.name === 'parkease.notifications.dlq'));
    const mainQueue = assertedQueues.find(q => q.name === 'parkease.notifications.queue');
    assert.ok(mainQueue);
    assert.strictEqual(mainQueue.opts.arguments['x-dead-letter-exchange'], 'parkease.events.dlx');

    // Verify Routing Key Bindings
    assert.ok(boundQueues.find(b => b.rk === 'booking.created'));
    assert.ok(boundQueues.find(b => b.rk === 'booking.cancelled'));
    assert.ok(boundQueues.find(b => b.rk === 'booking.status.changed'));
  });

  it('2. should correctly process booking.created event and acknowledge message', async () => {
    let capturedParams = null;
    mockNotificationService.processNotification = async (params) => {
      capturedParams = params;
      return { delivered: true };
    };

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });
    await consumer.start();

    const msg = createMockMsg('booking.created', {
      bookingId: 'bk-uuid-001',
      bookingReference: 'BK-20261123-0001',
      userId: 'user-001',
      facilityId: 'FAC-NORTH',
      startTime: '2026-11-23T10:00:00Z',
      endTime: '2026-11-23T12:00:00Z',
      status: 'PENDING',
      totalAmount: 25.0
    });

    await consumer.handleMessage(msg);

    assert.ok(capturedParams);
    assert.strictEqual(capturedParams.notificationType, NOTIFICATION_TYPE.BOOKING_CREATED);
    assert.strictEqual(capturedParams.templateName, 'booking-created');
    assert.strictEqual(capturedParams.templateData.bookingReference, 'BK-20261123-0001');
    assert.strictEqual(mockChannel._acked.length, 1);
  });

  it('3. should correctly process booking.cancelled event', async () => {
    let capturedParams = null;
    mockNotificationService.processNotification = async (params) => {
      capturedParams = params;
      return { delivered: true };
    };

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });
    await consumer.start();

    const msg = createMockMsg('booking.cancelled', {
      bookingId: 'bk-uuid-002',
      bookingReference: 'BK-20261123-0002',
      userId: 'user-002',
      facilityId: 'FAC-SOUTH',
      cancellationReason: 'Flight delayed',
      status: 'CANCELLED'
    });

    await consumer.handleMessage(msg);

    assert.ok(capturedParams);
    assert.strictEqual(capturedParams.notificationType, NOTIFICATION_TYPE.BOOKING_CANCELLED);
    assert.strictEqual(capturedParams.templateName, 'booking-cancelled');
    assert.strictEqual(capturedParams.templateData.message, 'Flight delayed');
    assert.strictEqual(mockChannel._acked.length, 1);
  });

  it('4. should correctly process booking.status.changed for CONFIRMED and EXPIRED', async () => {
    const processedTemplates = [];
    mockNotificationService.processNotification = async (params) => {
      processedTemplates.push(params.templateName);
      return { delivered: true };
    };

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });
    await consumer.start();

    // 4a. CONFIRMED
    const confirmedMsg = createMockMsg('booking.status.changed', {
      bookingId: 'bk-uuid-003',
      bookingReference: 'BK-CONF-1',
      userId: 'user-003',
      facilityId: 'FAC-WEST',
      previousStatus: 'PENDING',
      currentStatus: 'CONFIRMED'
    });
    await consumer.handleMessage(confirmedMsg);

    // 4b. EXPIRED
    const expiredMsg = createMockMsg('booking.status.changed', {
      bookingId: 'bk-uuid-004',
      bookingReference: 'BK-EXP-1',
      userId: 'user-004',
      facilityId: 'FAC-WEST',
      previousStatus: 'PENDING',
      currentStatus: 'EXPIRED'
    });
    await consumer.handleMessage(expiredMsg);

    assert.deepStrictEqual(processedTemplates, ['booking-confirmed', 'booking-expired']);
    assert.strictEqual(mockChannel._acked.length, 2);
  });

  it('5. should acknowledge without processing for unsupported status transitions', async () => {
    let processCalled = false;
    mockNotificationService.processNotification = async () => {
      processCalled = true;
      return { delivered: true };
    };

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });
    await consumer.start();

    const ignoredMsg = createMockMsg('booking.status.changed', {
      bookingId: 'bk-uuid-005',
      userId: 'user-005',
      previousStatus: 'CONFIRMED',
      currentStatus: 'COMPLETED'
    });

    await consumer.handleMessage(ignoredMsg);

    assert.strictEqual(processCalled, false, 'Unsupported transition must not trigger notification');
    assert.strictEqual(mockChannel._acked.length, 1, 'Ignored message must be acknowledged');
  });

  it('6. should detect duplicate events via processed_events and acknowledge without re-processing', async () => {
    let processCount = 0;
    mockNotificationService.processNotification = async () => {
      processCount++;
      return { delivered: true };
    };

    // Pre-populate completed event
    processedEventStore.set('evt-dup-1', {
      eventId: 'evt-dup-1',
      eventType: 'booking.created',
      processingStatus: PROCESSING_STATUS.COMPLETED
    });

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });
    await consumer.start();

    const dupMsg = createMockMsg('booking.created', {
      eventId: 'evt-dup-1',
      bookingId: 'bk-dup-1',
      userId: 'user-dup'
    }, {}, 'evt-dup-1');

    await consumer.handleMessage(dupMsg);

    assert.strictEqual(processCount, 0, 'Duplicate event must not be re-processed');
    assert.strictEqual(mockChannel._acked.length, 1, 'Duplicate event must be acknowledged');
  });

  it('7. should reject malformed JSON message to DLQ without requeue', async () => {
    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });
    await consumer.start();

    const malformedMsg = {
      fields: { routingKey: 'booking.created' },
      properties: { headers: {} },
      content: Buffer.from('{ malformed: true,,,')
    };

    await consumer.handleMessage(malformedMsg);

    assert.strictEqual(mockChannel._rejected.length, 1);
    assert.strictEqual(mockChannel._rejected[0].requeue, false, 'Malformed message must not be requeued');
  });

  it('8. should acknowledge without requeue when User Service reports permanent 404', async () => {
    mockNotificationService.processNotification = async () => ({
      delivered: false,
      retryable: false,
      error: 'User not found in User Service for userId: user-missing'
    });

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });
    await consumer.start();

    const missingUserMsg = createMockMsg('booking.created', {
      bookingId: 'bk-404',
      userId: 'user-missing'
    });

    await consumer.handleMessage(missingUserMsg);

    assert.strictEqual(mockChannel._acked.length, 1, 'Permanent failure must be acknowledged (no requeue loop)');
    assert.strictEqual(mockChannel._rejected, undefined);

    const savedEvent = Array.from(processedEventStore.values())[0];
    assert.strictEqual(savedEvent.processingStatus, PROCESSING_STATUS.FAILED);
  });

  it('9. should perform bounded retry when User Service experiences transient failure', async () => {
    mockNotificationService.processNotification = async () => ({
      delivered: false,
      retryable: true,
      error: 'User Service 503 Unavailable'
    });

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService,
      config: { exchange: 'parkease.events', retryLimit: 3 }
    });
    await consumer.start();

    const transientMsg = createMockMsg('booking.created', {
      bookingId: 'bk-retry',
      userId: 'user-transient'
    }, { 'x-retry-count': 1 });

    await consumer.handleMessage(transientMsg);

    // Old message acknowledged because new retry message published
    assert.strictEqual(mockChannel._acked.length, 1);
    assert.strictEqual(mockChannel._published.length, 1);
    assert.strictEqual(mockChannel._published[0].exchange, 'parkease.events.retry', 'Must publish to delayed retry exchange');
    assert.strictEqual(mockChannel._published[0].properties.headers['x-retry-count'], 2);
  });

  it('10. should reject to DLQ when retry limit is exhausted', async () => {
    mockNotificationService.processNotification = async () => ({
      delivered: false,
      retryable: true,
      error: 'Service unavailable'
    });

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService,
      config: { exchange: 'parkease.events', retryExchange: 'parkease.events.retry', retryLimit: 3 }
    });
    await consumer.start();

    const exhaustedMsg = createMockMsg('booking.created', {
      bookingId: 'bk-exhausted',
      userId: 'user-exhausted'
    }, { 'x-retry-count': 3 }); // At max retries

    await consumer.handleMessage(exhaustedMsg);

    assert.strictEqual(mockChannel._rejected.length, 1);
    assert.strictEqual(mockChannel._rejected[0].requeue, false, 'Exhausted message must be routed to DLQ');
  });

  it('11. should handle graceful shutdown cleanly by cancelling consumer and closing channel', async () => {
    let cancelCalled = false;
    let channelClosed = false;
    let connectionClosed = false;

    mockChannel.cancel = async () => { cancelCalled = true; };
    mockChannel.close = async () => { channelClosed = true; };
    mockConnection.close = async () => { connectionClosed = true; };

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });
    await consumer.start();
    await consumer.stop();

    assert.strictEqual(cancelCalled, true);
    assert.strictEqual(channelClosed, true);
    assert.strictEqual(connectionClosed, true);
    assert.strictEqual(consumer.isConnected, false);
  });

  it('12. should nack with requeue and NOT acknowledge original message if publisher confirmation fails', async () => {
    mockNotificationService.processNotification = async () => ({
      delivered: false,
      retryable: true,
      error: 'Temporary error'
    });

    // Make publish simulate a broker nack / confirmation failure
    mockChannel.publish = (exchange, routingKey, content, properties, callback) => {
      mockChannel._published = mockChannel._published || [];
      mockChannel._published.push({ exchange, routingKey, content, properties });
      if (typeof callback === 'function') {
        callback(new Error('Broker nack / channel write error'));
      }
      return false;
    };

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService,
      config: { exchange: 'parkease.events', retryExchange: 'parkease.events.retry', retryLimit: 3 }
    });
    await consumer.start();

    const failPublishMsg = createMockMsg('booking.created', {
      bookingId: 'bk-pub-fail',
      userId: 'user-pub-fail'
    });

    await consumer.handleMessage(failPublishMsg);

    // Original message MUST NOT be acknowledged if confirmation failed!
    assert.strictEqual(mockChannel._acked?.length || 0, 0, 'Original message must not be ACKed on publish failure');
    // It should be NACKed with requeue=true to prevent message loss
    assert.strictEqual(mockChannel._nacked?.length, 1, 'Original message must be NACKed with requeue');
    assert.strictEqual(mockChannel._nacked[0].requeue, true);
  });

  it('13. should safely handle concurrent duplicate event insertion and avoid unhandled unique key error', async () => {
    let processCount = 0;
    mockNotificationService.processNotification = async () => {
      processCount++;
      return { delivered: true };
    };

    // Simulate concurrent worker 1 inserting and completing the record while worker 2 attempts save
    let firstCall = true;
    mockProcessedEventRepo.save = async () => {
      if (firstCall) {
        firstCall = false;
        // Pre-fill store as if another worker completed it concurrently
        processedEventStore.set('evt-concurrent-1', {
          eventId: 'evt-concurrent-1',
          eventType: 'booking.created',
          processingStatus: PROCESSING_STATUS.COMPLETED
        });
        const duplicateKeyError = new Error('Violation of PRIMARY KEY constraint. Cannot insert duplicate key in object dbo.processed_events');
        duplicateKeyError.number = 2627;
        throw duplicateKeyError;
      }
    };

    const consumer = new NotificationConsumer({
      amqpLib: mockAmqp,
      dataSource: mockDataSource,
      notificationService: mockNotificationService
    });
    await consumer.start();

    const concurrentMsg = createMockMsg('booking.created', {
      eventId: 'evt-concurrent-1',
      bookingId: 'bk-concurrent-1',
      userId: 'user-concurrent'
    }, {}, 'evt-concurrent-1');

    await consumer.handleMessage(concurrentMsg);

    // Duplicate message from concurrent worker should be acknowledged safely without crashing or reprocessing
    assert.strictEqual(mockChannel._acked.length, 1, 'Concurrent duplicate delivery must be safely acknowledged');
    assert.strictEqual(processCount, 0, 'Must not duplicate process notification');
  });
});
