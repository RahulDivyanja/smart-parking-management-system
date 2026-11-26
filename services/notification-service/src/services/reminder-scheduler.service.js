const defaultDataSource = require('../config/data-source');
const { REMINDER_STATUS } = require('../constants/reminder-status');
const { REMINDER_TYPE } = require('../constants/reminder-type');

// Strict ISO 8601 with explicit timezone (Z or valid offset [+-]HH:mm with HH: 00-14, mm: 00-59)
const STRICT_ISO8601_TIMEZONE_REGEX = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-](0[0-9]|1[0-4]):?[0-5][0-9])$/i;

/**
 * Validates that an incoming boundary timestamp is a string formatted as ISO 8601 with explicit timezone.
 * Rejects timezone-naive strings, non-strings, malformed dates, and invalid offsets.
 * 
 * @param {any} rawValue - Boundary input
 * @param {string} fieldName - Field name for diagnostics ('startTime' | 'endTime')
 * @param {string} bookingId - Booking ID for structured logging
 * @returns {Date} Normalized UTC Date instance
 */
function validateBoundaryTimestamp(rawValue, fieldName, bookingId) {
  if (rawValue === undefined || rawValue === null || typeof rawValue !== 'string') {
    const errorMsg = `Field '${fieldName}' must be an ISO 8601 string, received ${typeof rawValue}`;
    console.error(JSON.stringify({
      event: 'TIMESTAMP_VALIDATION_FAILED',
      bookingId: bookingId || 'UNKNOWN',
      fieldName,
      value: rawValue,
      error: errorMsg
    }));
    throw new Error(errorMsg);
  }

  const trimmed = rawValue.trim();

  if (!STRICT_ISO8601_TIMEZONE_REGEX.test(trimmed)) {
    const errorMsg = `Ambiguous or invalid timezone in '${fieldName}': '${trimmed}'. Must be ISO 8601 with 'Z' or valid offset (e.g. '+05:30'). Timezone-naive strings are strictly rejected.`;
    console.error(JSON.stringify({
      event: 'TIMESTAMP_VALIDATION_FAILED',
      bookingId: bookingId || 'UNKNOWN',
      fieldName,
      value: trimmed,
      error: errorMsg
    }));
    throw new Error(errorMsg);
  }

  const parsedDate = new Date(trimmed);
  if (isNaN(parsedDate.getTime())) {
    const errorMsg = `Field '${fieldName}' contains unparseable date: '${trimmed}'`;
    console.error(JSON.stringify({
      event: 'TIMESTAMP_VALIDATION_FAILED',
      bookingId: bookingId || 'UNKNOWN',
      fieldName,
      value: trimmed,
      error: errorMsg
    }));
    throw new Error(errorMsg);
  }

  return parsedDate;
}

/**
 * Check if an error is a duplicate key violation (SQL Server 2601 or 2627)
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
    msg.includes('violation of primary key') ||
    msg.includes('violation of unique key')
  );
}

/**
 * ReminderSchedulerService
 * Manages booking lifecycle event sequencing, out-of-order handling,
 * and reminder generation.
 */
class ReminderSchedulerService {
  /**
   * @param {object} [options]
   * @param {import('typeorm').DataSource} [options.dataSource]
   */
  constructor(options = {}) {
    this.dataSource = options.dataSource || defaultDataSource;
  }

  /**
   * Handles BOOKING_CREATED domain event
   * Creates ARRIVAL and DEPARTURE reminders and tracks booking event state.
   * 
   * @param {object} payload
   * @returns {Promise<{ scheduled: boolean, reason?: string, error?: string }>}
   */
  async handleBookingCreated(payload) {
    const { bookingId, bookingReference, userId, facilityId, startTime, endTime } = payload;

    if (!bookingId || !userId) {
      return { scheduled: false, reason: 'MISSING_REQUIRED_IDENTIFIERS' };
    }

    // 1. Strict Boundary Timestamp Validation
    let startUtc, endUtc;
    try {
      startUtc = validateBoundaryTimestamp(startTime, 'startTime', bookingId);
      endUtc = validateBoundaryTimestamp(endTime, 'endTime', bookingId);
    } catch (valErr) {
      // Structured error already logged by validateBoundaryTimestamp
      return {
        scheduled: false,
        reason: 'TIMESTAMP_VALIDATION_FAILED',
        error: valErr.message
      };
    }

    if (startUtc >= endUtc) {
      console.error(JSON.stringify({
        event: 'TIMESTAMP_VALIDATION_FAILED',
        bookingId,
        fieldName: 'startTime/endTime',
        value: { startTime, endTime },
        error: 'startTime must be strictly before endTime'
      }));
      return { scheduled: false, reason: 'INVALID_TIME_RANGE' };
    }

    // 2. Concurrency-Safe Transaction with Retry
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Lock and check current state in booking_event_states
        const stateRows = await queryRunner.query(
          `SELECT booking_id AS bookingId, current_status AS currentStatus, has_created_event AS hasCreatedEvent
           FROM booking_event_states WITH (UPDLOCK, HOLDLOCK)
           WHERE booking_id = @0`,
          [bookingId]
        );

        let finalStatus = 'PENDING';

        if (!stateRows || stateRows.length === 0) {
          // First time this booking is seen: insert new state
          await queryRunner.query(
            `INSERT INTO booking_event_states (
              booking_id, booking_reference, user_id, facility_id, current_status,
              has_created_event, start_time, end_time, status_updated_at, created_at, updated_at
            ) VALUES (
              @0, @1, @2, @3, 'PENDING', 1, @4, @5, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME()
            )`,
            [bookingId, bookingReference || null, userId, facilityId || null, startUtc, endUtc]
          );
        } else {
          // Out-of-order scenario: BOOKING_STATUS_CHANGED already arrived before BOOKING_CREATED
          const existingState = stateRows[0];
          finalStatus = existingState.currentStatus;

          await queryRunner.query(
            `UPDATE booking_event_states
             SET 
               booking_reference = COALESCE(@1, booking_reference),
               facility_id = COALESCE(@2, facility_id),
               has_created_event = 1,
               start_time = @3,
               end_time = @4,
               updated_at = SYSUTCDATETIME()
             WHERE booking_id = @0`,
            [bookingId, bookingReference || null, facilityId || null, startUtc, endUtc]
          );
        }

        // 3. Determine initial reminder status based on booking lifecycle state
        let reminderStatus = REMINDER_STATUS.INACTIVE;
        let isActive = false;
        let activatedAt = null;

        if (finalStatus === 'CONFIRMED') {
          // Booking was already confirmed before creation event arrived
          reminderStatus = REMINDER_STATUS.PENDING;
          isActive = true;
          activatedAt = new Date();
        } else if (finalStatus === 'CANCELLED' || finalStatus === 'EXPIRED') {
          // Booking was already cancelled or expired before creation event arrived
          reminderStatus = REMINDER_STATUS.CANCELLED;
          isActive = false;
        }

        // 4. Calculate Scheduled Times
        // ARRIVAL: 30 minutes before startTime
        const arrivalScheduledAt = new Date(startUtc.getTime() - 30 * 60 * 1000);
        // DEPARTURE: 15 minutes before endTime
        const departureScheduledAt = new Date(endUtc.getTime() - 15 * 60 * 1000);

        const payloadSnapshot = JSON.stringify({
          bookingReference: bookingReference || null,
          facilityId: facilityId || null,
          startTime: startUtc.toISOString(),
          endTime: endUtc.toISOString()
        });

        // 5. Insert ARRIVAL reminder (Sentinel recipient_email: 'UNRESOLVED')
        await this._insertReminderIfNotExists(queryRunner, {
          bookingId,
          userId,
          reminderType: REMINDER_TYPE.ARRIVAL,
          scheduledAt: arrivalScheduledAt,
          reminderStatus,
          isActive,
          activatedAt,
          payload: payloadSnapshot,
          idempotencyKey: `REMINDER-${bookingId}-${REMINDER_TYPE.ARRIVAL}`
        });

        // 6. Insert DEPARTURE reminder (Sentinel recipient_email: 'UNRESOLVED')
        await this._insertReminderIfNotExists(queryRunner, {
          bookingId,
          userId,
          reminderType: REMINDER_TYPE.DEPARTURE,
          scheduledAt: departureScheduledAt,
          reminderStatus,
          isActive,
          activatedAt,
          payload: payloadSnapshot,
          idempotencyKey: `REMINDER-${bookingId}-${REMINDER_TYPE.DEPARTURE}`
        });

        await queryRunner.commitTransaction();
        await queryRunner.release();

        return { scheduled: true, reminderStatus };
      } catch (err) {
        await queryRunner.rollbackTransaction();
        await queryRunner.release();

        if (isDuplicateKeyError(err) && attempt < maxRetries) {
          // Retry on concurrent key conflict
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          continue;
        }

        console.error(`[ReminderScheduler Error] Failed to schedule reminders for booking '${bookingId}':`, err.message);
        throw err;
      }
    }
  }

  /**
   * Handles BOOKING_STATUS_CHANGED domain event
   * Activates reminders on CONFIRMED or cancels reminders on CANCELLED/EXPIRED.
   * 
   * @param {object} payload
   * @returns {Promise<{ updated: boolean, currentStatus?: string, ignored?: boolean }>}
   */
  async handleBookingStatusChanged(payload) {
    const { bookingId, bookingReference, userId, facilityId, currentStatus } = payload;

    if (!bookingId || !currentStatus) {
      return { updated: false, ignored: true, reason: 'MISSING_BOOKING_OR_STATUS' };
    }

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const stateRows = await queryRunner.query(
          `SELECT booking_id AS bookingId, current_status AS currentStatus, has_created_event AS hasCreatedEvent
           FROM booking_event_states WITH (UPDLOCK, HOLDLOCK)
           WHERE booking_id = @0`,
          [bookingId]
        );

        if (!stateRows || stateRows.length === 0) {
          // Out-of-order: Status change arrived before BOOKING_CREATED
          await queryRunner.query(
            `INSERT INTO booking_event_states (
              booking_id, booking_reference, user_id, facility_id, current_status,
              has_created_event, status_updated_at, created_at, updated_at
            ) VALUES (
              @0, @1, @2, @3, @4, 0, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME()
            )`,
            [bookingId, bookingReference || null, userId || 'UNKNOWN', facilityId || null, currentStatus]
          );
        } else {
          const existingState = stateRows[0];

          // Terminal State Protection: CANCELLED and EXPIRED cannot transition to any other status
          if (existingState.currentStatus === 'CANCELLED' || existingState.currentStatus === 'EXPIRED') {
            console.log(`[ReminderScheduler] Ignored transition to '${currentStatus}' for booking '${bookingId}': Booking is already in terminal state '${existingState.currentStatus}'.`);
            await queryRunner.commitTransaction();
            await queryRunner.release();
            return { updated: false, ignored: true, currentStatus: existingState.currentStatus };
          }

          // Apply state transition
          await queryRunner.query(
            `UPDATE booking_event_states
             SET 
               current_status = @1,
               status_updated_at = SYSUTCDATETIME(),
               updated_at = SYSUTCDATETIME()
             WHERE booking_id = @0`,
            [bookingId, currentStatus]
          );
        }

        // Apply Reminder Lifecycle Rules
        if (currentStatus === 'CONFIRMED') {
          // Activate inactive reminders
          await queryRunner.query(
            `UPDATE reminders
             SET 
               reminder_status = '${REMINDER_STATUS.PENDING}',
               is_active = 1,
               activated_at = SYSUTCDATETIME(),
               updated_at = SYSUTCDATETIME()
             WHERE booking_id = @0
               AND reminder_status = '${REMINDER_STATUS.INACTIVE}'`,
            [bookingId]
          );
        } else if (currentStatus === 'CANCELLED' || currentStatus === 'EXPIRED') {
          // Invalidate any active sweeper claims by bumping claim_version and cancel reminders
          await queryRunner.query(
            `UPDATE reminders
             SET 
               reminder_status = '${REMINDER_STATUS.CANCELLED}',
               is_active = 0,
               claim_version = claim_version + 1,
               claim_owner = NULL,
               claim_expires_at = NULL,
               updated_at = SYSUTCDATETIME()
             WHERE booking_id = @0
               AND reminder_status IN ('${REMINDER_STATUS.INACTIVE}', '${REMINDER_STATUS.PENDING}', '${REMINDER_STATUS.PROCESSING}')`,
            [bookingId]
          );
        }

        await queryRunner.commitTransaction();
        await queryRunner.release();

        return { updated: true, currentStatus };
      } catch (err) {
        await queryRunner.rollbackTransaction();
        await queryRunner.release();

        if (isDuplicateKeyError(err) && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          continue;
        }

        console.error(`[ReminderScheduler Error] Failed status update for booking '${bookingId}':`, err.message);
        throw err;
      }
    }
  }

  /**
   * Helper to insert a reminder row if not already present
   * @private
   */
  async _insertReminderIfNotExists(queryRunner, params) {
    const {
      bookingId,
      userId,
      reminderType,
      scheduledAt,
      reminderStatus,
      isActive,
      activatedAt,
      payload,
      idempotencyKey
    } = params;

    await queryRunner.query(
      `IF NOT EXISTS (
        SELECT 1 FROM reminders 
        WHERE booking_id = @0 AND reminder_type = @2
      )
      BEGIN
        INSERT INTO reminders (
          booking_id, user_id, recipient_email, reminder_type, scheduled_at,
          reminder_status, idempotency_key, is_active, activated_at, payload,
          retry_count, claim_version, created_at, updated_at
        ) VALUES (
          @0, @1, 'UNRESOLVED', @2, @3,
          @4, @5, @6, @7, @8,
          0, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
        )
      END`,
      [
        bookingId,
        userId,
        reminderType,
        scheduledAt,
        reminderStatus,
        idempotencyKey,
        isActive ? 1 : 0,
        activatedAt || null,
        payload
      ]
    );
  }
}

module.exports = {
  ReminderSchedulerService,
  validateBoundaryTimestamp
};
