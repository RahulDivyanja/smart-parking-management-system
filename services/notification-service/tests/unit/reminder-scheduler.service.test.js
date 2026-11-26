const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ReminderSchedulerService, validateBoundaryTimestamp } = require('../../src/services/reminder-scheduler.service');
const { REMINDER_STATUS } = require('../../src/constants/reminder-status');
const { REMINDER_TYPE } = require('../../src/constants/reminder-type');

describe('Reminder Scheduler Service - Unit Tests', () => {
  let loggedErrors;
  let originalConsoleError;

  beforeEach(() => {
    loggedErrors = [];
    originalConsoleError = console.error;
    console.error = (...args) => {
      try {
        loggedErrors.push(JSON.parse(args[0]));
      } catch {
        loggedErrors.push(args.join(' '));
      }
    };
  });

  function restoreConsole() {
    console.error = originalConsoleError;
  }

  describe('Strict Boundary Timestamp Validation', () => {
    it('should accept valid ISO 8601 timestamp with explicit UTC designator Z', () => {
      const validUtc = '2026-11-23T14:30:00.000Z';
      const parsed = validateBoundaryTimestamp(validUtc, 'startTime', 'BK-TEST-01');
      assert.ok(parsed instanceof Date);
      assert.strictEqual(parsed.toISOString(), '2026-11-23T14:30:00.000Z');
      assert.strictEqual(loggedErrors.length, 0);
      restoreConsole();
    });

    it('should accept valid ISO 8601 timestamp with explicit positive offset (+05:30)', () => {
      const validOffset = '2026-11-23T20:00:00+05:30';
      const parsed = validateBoundaryTimestamp(validOffset, 'startTime', 'BK-TEST-01');
      assert.ok(parsed instanceof Date);
      // 20:00 - 5:30 = 14:30 UTC
      assert.strictEqual(parsed.toISOString(), '2026-11-23T14:30:00.000Z');
      assert.strictEqual(loggedErrors.length, 0);
      restoreConsole();
    });

    it('should accept valid ISO 8601 timestamp with explicit negative offset (-04:00)', () => {
      const validOffset = '2026-11-23T10:30:00-04:00';
      const parsed = validateBoundaryTimestamp(validOffset, 'startTime', 'BK-TEST-01');
      assert.ok(parsed instanceof Date);
      // 10:30 - (-04:00) = 14:30 UTC
      assert.strictEqual(parsed.toISOString(), '2026-11-23T14:30:00.000Z');
      assert.strictEqual(loggedErrors.length, 0);
      restoreConsole();
    });

    it('should strictly reject timezone-naive strings and record structured error', () => {
      const naiveString = '2026-11-23T14:30:00';
      assert.throws(
        () => validateBoundaryTimestamp(naiveString, 'startTime', 'BK-TEST-NAIVE'),
        /Ambiguous or invalid timezone in 'startTime'/
      );

      assert.strictEqual(loggedErrors.length, 1);
      const structuredLog = loggedErrors[0];
      assert.strictEqual(structuredLog.event, 'TIMESTAMP_VALIDATION_FAILED');
      assert.strictEqual(structuredLog.bookingId, 'BK-TEST-NAIVE');
      assert.strictEqual(structuredLog.fieldName, 'startTime');
      assert.strictEqual(structuredLog.value, '2026-11-23T14:30:00');
      assert.match(structuredLog.error, /Timezone-naive strings are strictly rejected/);
      restoreConsole();
    });

    it('should strictly reject timezone-naive space-separated strings', () => {
      const naiveString = '2026-11-23 14:30:00';
      assert.throws(
        () => validateBoundaryTimestamp(naiveString, 'endTime', 'BK-TEST-SPACE'),
        /Ambiguous or invalid timezone in 'endTime'/
      );

      assert.strictEqual(loggedErrors.length, 1);
      const structuredLog = loggedErrors[0];
      assert.strictEqual(structuredLog.event, 'TIMESTAMP_VALIDATION_FAILED');
      assert.strictEqual(structuredLog.bookingId, 'BK-TEST-SPACE');
      assert.strictEqual(structuredLog.fieldName, 'endTime');
      restoreConsole();
    });

    it('should reject non-string inputs (e.g. JavaScript Date object at event boundary)', () => {
      const dateObject = new Date();
      assert.throws(
        () => validateBoundaryTimestamp(dateObject, 'startTime', 'BK-TEST-DATE-OBJ'),
        /Field 'startTime' must be an ISO 8601 string, received object/
      );

      assert.strictEqual(loggedErrors.length, 1);
      const structuredLog = loggedErrors[0];
      assert.strictEqual(structuredLog.event, 'TIMESTAMP_VALIDATION_FAILED');
      assert.strictEqual(structuredLog.bookingId, 'BK-TEST-DATE-OBJ');
      restoreConsole();
    });

    it('should reject invalid timezone offsets (e.g. +25:00 or +05:99)', () => {
      const invalidOffset = '2026-11-23T14:30:00+25:00';
      assert.throws(
        () => validateBoundaryTimestamp(invalidOffset, 'startTime', 'BK-TEST-INV-OFFSET'),
        /Ambiguous or invalid timezone/
      );

      assert.strictEqual(loggedErrors.length, 1);
      restoreConsole();
    });
  });

  describe('Reminder Creation & Out-of-Order Lifecycle Handling', () => {
    let mockStates;
    let mockReminders;
    let mockDataSource;

    beforeEach(() => {
      mockStates = new Map();
      mockReminders = [];

      mockDataSource = {
        createQueryRunner: () => {
          return {
            connect: async () => {},
            startTransaction: async () => {},
            commitTransaction: async () => {},
            rollbackTransaction: async () => {},
            release: async () => {},
            query: async (sql, params = []) => {
              const lower = sql.toLowerCase();

              // SELECT booking_event_states
              if (lower.includes('select booking_id as bookingid') && lower.includes('booking_event_states')) {
                const bookingId = params[0];
                const state = mockStates.get(bookingId);
                return state ? [state] : [];
              }

              // INSERT INTO booking_event_states
              if (lower.includes('insert into booking_event_states')) {
                const [booking_id, booking_reference, user_id, facility_id, current_status, has_created_event] = params;
                const record = {
                  bookingId: booking_id,
                  bookingReference: booking_reference,
                  userId: user_id,
                  facilityId: facility_id,
                  currentStatus: current_status,
                  hasCreatedEvent: has_created_event
                };
                mockStates.set(booking_id, record);
                return [{ affected: 1 }];
              }

              // UPDATE booking_event_states
              if (lower.includes('update booking_event_states')) {
                const bookingId = params[0];
                const state = mockStates.get(bookingId);
                if (state) {
                  if (params.length >= 2 && params[1] !== undefined) {
                    state.currentStatus = params[1];
                  }
                  if (lower.includes('has_created_event = 1')) {
                    state.hasCreatedEvent = 1;
                  }
                }
                return [{ affected: state ? 1 : 0 }];
              }

              // INSERT INTO reminders
              if (lower.includes('insert into reminders')) {
                const [bookingId, userId, reminderType, scheduledAt, reminderStatus, idempotencyKey, isActive, activatedAt, payload] = params;
                mockReminders.push({
                  bookingId,
                  userId,
                  recipientEmail: 'UNRESOLVED',
                  reminderType,
                  scheduledAt,
                  reminderStatus,
                  idempotencyKey,
                  isActive: Boolean(isActive),
                  activatedAt,
                  payload
                });
                return [{ affected: 1 }];
              }

              // UPDATE reminders
              if (lower.includes('update reminders')) {
                const bookingId = params[0];
                let count = 0;
                for (const rem of mockReminders) {
                  if (rem.bookingId === bookingId) {
                    if (lower.includes("reminder_status = 'pending'")) {
                      rem.reminderStatus = REMINDER_STATUS.PENDING;
                      rem.isActive = true;
                      rem.activatedAt = new Date();
                      count++;
                    } else if (lower.includes("reminder_status = 'cancelled'")) {
                      rem.reminderStatus = REMINDER_STATUS.CANCELLED;
                      rem.isActive = false;
                      count++;
                    }
                  }
                }
                return [{ affected: count }];
              }

              return [];
            }
          };
        }
      };
    });

    it('should reject reminder creation if startTime contains an ambiguous timezone', async () => {
      const scheduler = new ReminderSchedulerService({ dataSource: mockDataSource });

      const result = await scheduler.handleBookingCreated({
        bookingId: 'b943-test-1',
        bookingReference: 'BK-001',
        userId: 'usr-123',
        facilityId: 'FAC-1',
        startTime: '2026-11-23 14:00:00', // Naive
        endTime: '2026-11-23T16:00:00.000Z'
      });

      assert.strictEqual(result.scheduled, false);
      assert.strictEqual(result.reason, 'TIMESTAMP_VALIDATION_FAILED');
      assert.strictEqual(mockReminders.length, 0); // No reminders created!
      restoreConsole();
    });

    it('should create INACTIVE reminders in normal booking creation flow', async () => {
      const scheduler = new ReminderSchedulerService({ dataSource: mockDataSource });

      const result = await scheduler.handleBookingCreated({
        bookingId: 'b943-normal-1',
        bookingReference: 'BK-002',
        userId: 'usr-456',
        facilityId: 'FAC-1',
        startTime: '2026-11-23T14:00:00.000Z',
        endTime: '2026-11-23T16:00:00.000Z'
      });

      assert.strictEqual(result.scheduled, true);
      assert.strictEqual(result.reminderStatus, REMINDER_STATUS.INACTIVE);
      assert.strictEqual(mockReminders.length, 2);

      const arrival = mockReminders.find((r) => r.reminderType === REMINDER_TYPE.ARRIVAL);
      const departure = mockReminders.find((r) => r.reminderType === REMINDER_TYPE.DEPARTURE);

      assert.ok(arrival);
      assert.ok(departure);
      assert.strictEqual(arrival.recipientEmail, 'UNRESOLVED');
      assert.strictEqual(arrival.reminderStatus, REMINDER_STATUS.INACTIVE);
      assert.strictEqual(arrival.isActive, false);

      // Arrival scheduled 30m before startTime: 14:00 - 30m = 13:30 UTC
      assert.strictEqual(arrival.scheduledAt.toISOString(), '2026-11-23T13:30:00.000Z');
      // Departure scheduled 15m before endTime: 16:00 - 15m = 15:45 UTC
      assert.strictEqual(departure.scheduledAt.toISOString(), '2026-11-23T15:45:00.000Z');
      restoreConsole();
    });

    it('should handle out-of-order: CONFIRMED arriving before CREATED', async () => {
      const scheduler = new ReminderSchedulerService({ dataSource: mockDataSource });
      const bookingId = 'b943-ooo-confirmed';

      // 1. CONFIRMED arrives first
      const statusRes = await scheduler.handleBookingStatusChanged({
        bookingId,
        currentStatus: 'CONFIRMED'
      });
      assert.strictEqual(statusRes.updated, true);

      // Verify state recorded as CONFIRMED
      const state = mockStates.get(bookingId);
      assert.strictEqual(state.currentStatus, 'CONFIRMED');

      // 2. CREATED arrives second
      const createRes = await scheduler.handleBookingCreated({
        bookingId,
        bookingReference: 'BK-OOO-1',
        userId: 'usr-789',
        facilityId: 'FAC-2',
        startTime: '2026-11-23T14:00:00.000Z',
        endTime: '2026-11-23T16:00:00.000Z'
      });

      assert.strictEqual(createRes.scheduled, true);
      // Because already CONFIRMED, reminders should be created directly in PENDING (isActive = true)
      assert.strictEqual(createRes.reminderStatus, REMINDER_STATUS.PENDING);
      assert.strictEqual(mockReminders.length, 2);
      assert.strictEqual(mockReminders[0].reminderStatus, REMINDER_STATUS.PENDING);
      assert.strictEqual(mockReminders[0].isActive, true);
      assert.ok(mockReminders[0].activatedAt);
      restoreConsole();
    });

    it('should handle out-of-order: CANCELLED arriving before CREATED', async () => {
      const scheduler = new ReminderSchedulerService({ dataSource: mockDataSource });
      const bookingId = 'b943-ooo-cancelled';

      // 1. CANCELLED arrives first
      await scheduler.handleBookingStatusChanged({
        bookingId,
        currentStatus: 'CANCELLED'
      });

      // 2. CREATED arrives second
      const createRes = await scheduler.handleBookingCreated({
        bookingId,
        bookingReference: 'BK-OOO-2',
        userId: 'usr-789',
        facilityId: 'FAC-2',
        startTime: '2026-11-23T14:00:00.000Z',
        endTime: '2026-11-23T16:00:00.000Z'
      });

      assert.strictEqual(createRes.scheduled, true);
      // Reminders created directly in CANCELLED (isActive = false)
      assert.strictEqual(createRes.reminderStatus, REMINDER_STATUS.CANCELLED);
      assert.strictEqual(mockReminders[0].reminderStatus, REMINDER_STATUS.CANCELLED);
      assert.strictEqual(mockReminders[0].isActive, false);
      restoreConsole();
    });

    it('should protect terminal state: delayed CONFIRMED arriving after CANCELLED is ignored', async () => {
      const scheduler = new ReminderSchedulerService({ dataSource: mockDataSource });
      const bookingId = 'b943-terminal-check';

      // 1. Create booking (reminders INACTIVE)
      await scheduler.handleBookingCreated({
        bookingId,
        bookingReference: 'BK-TERM-1',
        userId: 'usr-999',
        facilityId: 'FAC-3',
        startTime: '2026-11-23T14:00:00.000Z',
        endTime: '2026-11-23T16:00:00.000Z'
      });

      // 2. Status changed to CANCELLED
      await scheduler.handleBookingStatusChanged({
        bookingId,
        currentStatus: 'CANCELLED'
      });

      assert.strictEqual(mockReminders[0].reminderStatus, REMINDER_STATUS.CANCELLED);

      // 3. Delayed CONFIRMED arrives
      const delayedResult = await scheduler.handleBookingStatusChanged({
        bookingId,
        currentStatus: 'CONFIRMED'
      });

      assert.strictEqual(delayedResult.ignored, true);
      assert.strictEqual(delayedResult.currentStatus, 'CANCELLED');
      // Reminders MUST remain CANCELLED!
      assert.strictEqual(mockReminders[0].reminderStatus, REMINDER_STATUS.CANCELLED);
      assert.strictEqual(mockReminders[0].isActive, false);
      restoreConsole();
    });
  });
});
