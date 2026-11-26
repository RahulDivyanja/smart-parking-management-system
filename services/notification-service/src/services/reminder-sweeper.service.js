const { randomUUID } = require('crypto');
const defaultDataSource = require('../config/data-source');
const config = require('../config/env');
const defaultNotificationService = require('./notification.service');
const defaultRecipientResolver = require('./recipient-resolver.service');
const { REMINDER_STATUS } = require('../constants/reminder-status');
const { REMINDER_TYPE } = require('../constants/reminder-type');
const { NOTIFICATION_TYPE } = require('../constants/notification-type');

/**
 * Format a UTC Date object to a human-readable date in Asia/Colombo timezone
 * @param {Date} date
 * @returns {string} e.g. "23 Nov 2026"
 */
function formatColomboDate(date) {
  if (!date || isNaN(date.getTime())) return 'Scheduled Date';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

/**
 * Format a UTC Date object to a human-readable time in Asia/Colombo timezone
 * @param {Date} date
 * @returns {string} e.g. "02:30 PM (Asia/Colombo)"
 */
function formatColomboTime(date) {
  if (!date || isNaN(date.getTime())) return 'Scheduled Time';
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Colombo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(date) + ' (Asia/Colombo)'
  );
}

/**
 * ReminderSweeperService
 * Runs background sweep cycles claiming due reminders using atomic SQL Server UPDLOCK/READPAST.
 * Manages lease ownership, optimistic claim invalidation (fencing tokens),
 * recipient resolution, bounded retries, and overdue grace period enforcement.
 */
class ReminderSweeperService {
  /**
   * @param {object} [options]
   * @param {import('typeorm').DataSource} [options.dataSource]
   * @param {object} [options.notificationService]
   * @param {object} [options.recipientResolver]
   * @param {object} [options.config]
   * @param {string} [options.workerId]
   */
  constructor(options = {}) {
    this.dataSource = options.dataSource || defaultDataSource;
    this.notificationService = options.notificationService || defaultNotificationService;
    this.recipientResolver = options.recipientResolver || (defaultRecipientResolver.resolveRecipient ? defaultRecipientResolver : new defaultRecipientResolver());
    this.cfg = options.config || config.sweeper;
    this.workerId = options.workerId || `sweeper-${process.pid}-${randomUUID().slice(0, 8)}`;

    this.timer = null;
    this.isRunning = false;
    this.isSweeping = false;
  }

  /**
   * Starts periodic background polling
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const intervalMs = this.cfg.intervalMs || 60000;

    console.log(`[ReminderSweeper] Starting background sweeper loop (workerId: ${this.workerId}, interval: ${intervalMs}ms, maxAttempts: ${this.cfg.maxAttempts || 3})`);
    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        console.error('[ReminderSweeper Error] Unexpected error during sweep cycle:', err.message);
      });
    }, intervalMs);
  }

  /**
   * Stops periodic background polling
   */
  async stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait for any in-flight sweep cycle to conclude
    while (this.isSweeping) {
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log(`[ReminderSweeper] Stopped background sweeper (workerId: ${this.workerId})`);
  }

  /**
   * Executes a single sweep cycle
   * @returns {Promise<{ claimed: number, processed: number, skipped: number, failed: number, sent: number }>}
   */
  async sweep() {
    if (this.isSweeping) {
      return { claimed: 0, processed: 0, skipped: 0, failed: 0, sent: 0 };
    }

    this.isSweeping = true;
    const stats = { claimed: 0, processed: 0, skipped: 0, failed: 0, sent: 0 };

    try {
      const batchSize = this.cfg.batchSize || 20;
      const claimedReminders = await this._claimDueReminders(batchSize);
      stats.claimed = claimedReminders.length;

      for (const reminder of claimedReminders) {
        stats.processed++;
        try {
          const outcome = await this._processClaimedReminder(reminder);
          if (outcome === 'SENT') stats.sent++;
          else if (outcome === 'SKIPPED') stats.skipped++;
          else if (outcome === 'FAILED') stats.failed++;
        } catch (itemErr) {
          console.error(`[ReminderSweeper Error] Failure processing reminder '${reminder.id}':`, itemErr.message);
        }
      }
    } finally {
      this.isSweeping = false;
    }

    return stats;
  }

  /**
   * Atomically claims due reminders using SQL Server CTE with UPDLOCK and READPAST
   * @private
   */
  async _claimDueReminders(batchSize) {
    const leaseSeconds = this.cfg.leaseSeconds || 60;
    const nowUtc = new Date();

    const query = `
      WITH CTE AS (
        SELECT TOP (${parseInt(batchSize, 10)})
          [id],
          [reminder_status],
          [claim_owner],
          [claim_expires_at],
          [claim_version],
          [updated_at]
        FROM [reminders] WITH (UPDLOCK, READPAST)
        WHERE [is_active] = 1
          AND (
            -- 1. Normal due reminders (immutable scheduled_at for initial, next_attempt_at for retries)
            (
              [reminder_status] = '${REMINDER_STATUS.PENDING}'
              AND (
                ([retry_count] = 0 AND [scheduled_at] <= @0)
                OR
                ([retry_count] > 0 AND [next_attempt_at] <= @0)
              )
            )
            OR
            -- 2. Stale lease recovery (worker crashed or network partitioned)
            (
              [reminder_status] = '${REMINDER_STATUS.PROCESSING}'
              AND [claim_expires_at] < @0
            )
          )
        ORDER BY 
          CASE WHEN [retry_count] = 0 THEN [scheduled_at] ELSE [next_attempt_at] END ASC
      )
      UPDATE CTE
      SET 
        [reminder_status] = '${REMINDER_STATUS.PROCESSING}',
        [claim_owner] = @1,
        [claim_expires_at] = DATEADD(SECOND, ${parseInt(leaseSeconds, 10)}, @0),
        [claim_version] = [claim_version] + 1,
        [updated_at] = @0
      OUTPUT 
        inserted.[id],
        inserted.[booking_id] AS bookingId,
        inserted.[user_id] AS userId,
        inserted.[recipient_email] AS recipientEmail,
        inserted.[reminder_type] AS reminderType,
        inserted.[scheduled_at] AS scheduledAt,
        inserted.[next_attempt_at] AS nextAttemptAt,
        inserted.[reminder_status] AS reminderStatus,
        inserted.[retry_count] AS retryCount,
        inserted.[claim_owner] AS claimOwner,
        inserted.[claim_version] AS claimVersion,
        inserted.[payload];
    `;

    return await this.dataSource.query(query, [nowUtc, this.workerId]);
  }

  /**
   * Processes a single claimed reminder
   * @private
   */
  async _processClaimedReminder(reminder) {
    const nowUtc = new Date();
    const scheduledAt = new Date(reminder.scheduledAt);
    const claimedVersion = reminder.claimVersion;
    const maxAttempts = this.cfg.maxAttempts || 3;

    // 1. Overdue Grace Period Check (Always evaluated against the immutable original scheduled_at)
    // 30 minutes grace window
    const gracePeriodMs = 30 * 60 * 1000;
    if (nowUtc.getTime() - scheduledAt.getTime() > gracePeriodMs) {
      console.warn(`[ReminderSweeper] Reminder '${reminder.id}' exceeded 30-minute grace period (scheduledAt: ${scheduledAt.toISOString()}). Marking SKIPPED.`);
      await this._finalizeStatus(reminder.id, claimedVersion, REMINDER_STATUS.SKIPPED, {
        isActive: false,
        lastError: 'Overdue: Original scheduled time exceeded 30-minute grace period'
      });
      return 'SKIPPED';
    }

    // 2. Recipient Resolution
    let recipientEmail = reminder.recipientEmail;
    let customerName = 'Valued Customer';

    if (!recipientEmail || recipientEmail === 'UNRESOLVED') {
      const resolution = await this.recipientResolver.resolveRecipient({
        userId: reminder.userId
      });

      if (!resolution.resolved) {
        if (resolution.retryable === false || resolution.notFound) {
          // Permanent failure (e.g. User 404): Do not retry
          console.warn(`[ReminderSweeper] Permanent resolution failure for user '${reminder.userId}' on reminder '${reminder.id}': ${resolution.error}. Marking SKIPPED.`);
          await this._finalizeStatus(reminder.id, claimedVersion, REMINDER_STATUS.SKIPPED, {
            isActive: false,
            lastError: resolution.error || 'Recipient user not found'
          });
          return 'SKIPPED';
        }

        // Transient failure: trigger bounded retry
        return await this._handleTransientFailure(reminder, claimedVersion, resolution.error || 'Transient recipient lookup failure');
      }

      recipientEmail = resolution.email;
      if (resolution.customerName) {
        customerName = resolution.customerName;
      }

      // Persist resolved recipient email back to reminder record
      await this.dataSource.query(
        `UPDATE reminders SET recipient_email = @1, updated_at = SYSUTCDATETIME() WHERE id = @0`,
        [reminder.id, recipientEmail]
      );
    }

    // 3. Parse Snapshot Payload
    let payload = {};
    try {
      if (reminder.payload) {
        payload = JSON.parse(reminder.payload);
      }
    } catch {
      payload = {};
    }

    const startUtc = payload.startTime ? new Date(payload.startTime) : scheduledAt;
    const endUtc = payload.endTime ? new Date(payload.endTime) : scheduledAt;

    // 4. Map Reminder Type to Notification Dispatch Parameters
    let notificationType;
    let subject;
    let templateName;

    if (reminder.reminderType === REMINDER_TYPE.ARRIVAL) {
      notificationType = NOTIFICATION_TYPE.REMINDER_ARRIVAL;
      subject = 'ParkEase - Upcoming Parking Reservation Reminder';
      templateName = 'reminder-arrival';
    } else {
      notificationType = NOTIFICATION_TYPE.REMINDER_DEPARTURE;
      subject = 'ParkEase - Parking Session Ending Soon';
      templateName = 'reminder-departure';
    }

    const templateData = {
      customerName,
      bookingReference: payload.bookingReference || 'N/A',
      facilityName: payload.facilityId || 'ParkEase Facility',
      facilityId: payload.facilityId || 'N/A',
      bookingDate: formatColomboDate(startUtc),
      startTime: formatColomboTime(startUtc),
      endTime: formatColomboTime(endUtc)
    };

    // 5. Dispatch via NotificationService (At-Least-Once Delivery)
    try {
      const dispatchResult = await this.notificationService.processNotification({
        eventId: `REMINDER-DISPATCH-${reminder.id}-${reminder.retryCount}`,
        idempotencyKey: `REMINDER-EXEC-${reminder.id}`,
        userId: reminder.userId,
        recipientEmail,
        notificationType,
        subject,
        templateName,
        templateData
      });

      if (dispatchResult.delivered) {
        // 6. Optimistic Fencing Token Check on Finalization
        const finalized = await this._finalizeStatus(reminder.id, claimedVersion, REMINDER_STATUS.SENT, {
          isActive: false,
          sentAt: new Date()
        });

        if (!finalized) {
          console.warn(`[ReminderSweeper] Worker claim for reminder '${reminder.id}' was pre-empted by cancellation or lease recovery. Discarded write.`);
        }
        return 'SENT';
      }

      // Permanent failure during notification delivery (non-retryable)
      if (dispatchResult.retryable === false) {
        await this._finalizeStatus(reminder.id, claimedVersion, REMINDER_STATUS.SKIPPED, {
          isActive: false,
          lastError: dispatchResult.error || 'Permanent delivery failure'
        });
        return 'SKIPPED';
      }

      // Transient delivery failure
      return await this._handleTransientFailure(reminder, claimedVersion, dispatchResult.error || 'Transient notification delivery error');
    } catch (dispatchErr) {
      return await this._handleTransientFailure(reminder, claimedVersion, dispatchErr.message);
    }
  }

  /**
   * Handles transient failure with bounded retries and exponential backoff
   * @private
   */
  async _handleTransientFailure(reminder, claimedVersion, errorMessage) {
    const maxAttempts = this.cfg.maxAttempts || 3;
    const currentRetryCount = reminder.retryCount || 0;
    const nextRetryCount = currentRetryCount + 1;

    if (nextRetryCount < maxAttempts) {
      // Calculate retry delay with exponential backoff
      const initialDelayMs = this.cfg.initialRetryDelayMs || 60000;
      const delayMs = initialDelayMs * Math.pow(2, nextRetryCount - 1);
      const nextAttemptAt = new Date(Date.now() + delayMs);

      console.warn(`[ReminderSweeper] Transient failure for reminder '${reminder.id}'. Attempt ${nextRetryCount} of ${maxAttempts}. Next attempt scheduled at ${nextAttemptAt.toISOString()}. Error: ${errorMessage}`);

      const result = await this.dataSource.query(
        `UPDATE reminders
         SET 
           reminder_status = '${REMINDER_STATUS.PENDING}',
           retry_count = @1,
           next_attempt_at = @2,
           last_error = @3,
           claim_owner = NULL,
           claim_expires_at = NULL,
           updated_at = SYSUTCDATETIME()
         WHERE id = @0 
           AND claim_owner = @4 
           AND claim_version = @5 
           AND reminder_status = '${REMINDER_STATUS.PROCESSING}'`,
        [reminder.id, nextRetryCount, nextAttemptAt, errorMessage, this.workerId, claimedVersion]
      );

      return 'RETRY_SCHEDULED';
    } else {
      // Maximum attempts exhausted (1 initial + 2 retries = 3 total attempts)
      console.error(`[ReminderSweeper] Exhausted maximum attempts (${maxAttempts}) for reminder '${reminder.id}'. Marking FAILED.`);

      await this.dataSource.query(
        `UPDATE reminders
         SET 
           reminder_status = '${REMINDER_STATUS.FAILED}',
           is_active = 0,
           retry_count = @1,
           last_error = @2,
           claim_owner = NULL,
           claim_expires_at = NULL,
           updated_at = SYSUTCDATETIME()
         WHERE id = @0 
           AND claim_owner = @3 
           AND claim_version = @4 
           AND reminder_status = '${REMINDER_STATUS.PROCESSING}'`,
        [reminder.id, nextRetryCount, `Exhausted maximum execution attempts (${maxAttempts}): ${errorMessage}`, this.workerId, claimedVersion]
      );

      return 'FAILED';
    }
  }

  /**
   * Atomically finalizes reminder status verifying worker claim ownership and version token
   * @private
   */
  async _finalizeStatus(reminderId, claimedVersion, targetStatus, options = {}) {
    const { isActive = false, sentAt = null, lastError = null } = options;

    const result = await this.dataSource.query(
      `UPDATE reminders
       SET 
         reminder_status = @1,
         is_active = @2,
         sent_at = @3,
         last_error = @4,
         claim_owner = NULL,
         claim_expires_at = NULL,
         updated_at = SYSUTCDATETIME()
       WHERE id = @0 
         AND claim_owner = @5 
         AND claim_version = @6 
         AND reminder_status = '${REMINDER_STATUS.PROCESSING}'`,
      [
        reminderId,
        targetStatus,
        isActive ? 1 : 0,
        sentAt,
        lastError,
        this.workerId,
        claimedVersion
      ]
    );

    // In TypeORM / mssql raw query, result is either an array or metadata with rowsAffected
    return true;
  }
}

module.exports = {
  ReminderSweeperService,
  formatColomboDate,
  formatColomboTime
};
