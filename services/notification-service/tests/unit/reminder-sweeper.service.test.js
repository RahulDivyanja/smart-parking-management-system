const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ReminderSweeperService, formatColomboDate, formatColomboTime } = require('../../src/services/reminder-sweeper.service');
const { REMINDER_STATUS } = require('../../src/constants/reminder-status');
const { REMINDER_TYPE } = require('../../src/constants/reminder-type');

describe('Reminder Sweeper Service - Unit Tests', () => {
  let remindersDb;
  let mockDataSource;
  let mockNotificationService;
  let mockRecipientResolver;
  let dispatchedNotifications;

  beforeEach(() => {
    remindersDb = new Map();
    dispatchedNotifications = [];

    mockNotificationService = {
      processNotification: async (params) => {
        dispatchedNotifications.push(params);
        return { delivered: true, messageId: `msg-${Date.now()}` };
      }
    };

    mockRecipientResolver = {
      resolveRecipient: async ({ userId }) => {
        if (userId === 'user-not-found') {
          return { resolved: false, notFound: true, retryable: false, error: 'User not found in User Service' };
        }
        if (userId === 'user-network-down') {
          return { resolved: false, retryable: true, error: 'User service timed out' };
        }
        return {
          resolved: true,
          email: `${userId}@parkease.com`,
          customerName: 'Alice Johnson'
        };
      }
    };

    mockDataSource = {
      query: async (sql, params = []) => {
        const lower = sql.toLowerCase();

        // 1. Sweeper CTE Claim Query
        if (lower.includes('with cte as') && lower.includes('update cte')) {
          const nowUtc = params[0] || new Date();
          const workerId = params[1] || 'worker-test';
          const claimed = [];

          for (const rem of remindersDb.values()) {
            if (!rem.isActive) continue;

            const isPendingDue =
              rem.reminderStatus === REMINDER_STATUS.PENDING &&
              ((rem.retryCount === 0 && new Date(rem.scheduledAt) <= nowUtc) ||
                (rem.retryCount > 0 && rem.nextAttemptAt && new Date(rem.nextAttemptAt) <= nowUtc));

            const isStaleLease =
              rem.reminderStatus === REMINDER_STATUS.PROCESSING &&
              rem.claimExpiresAt &&
              new Date(rem.claimExpiresAt) < nowUtc;

            if (isPendingDue || isStaleLease) {
              rem.reminderStatus = REMINDER_STATUS.PROCESSING;
              rem.claimOwner = workerId;
              rem.claimExpiresAt = new Date(nowUtc.getTime() + 60000);
              rem.claimVersion = (rem.claimVersion || 0) + 1;
              claimed.push({ ...rem });
            }
          }
          return claimed;
        }

        // 2. Finalize Status Update
        if (lower.includes('set') && lower.includes('reminder_status = @1') && lower.includes('claim_version = @6')) {
          const [id, targetStatus, isActive, sentAt, lastError, workerId, claimedVersion] = params;
          const rem = remindersDb.get(id);
          if (
            rem &&
            rem.claimOwner === workerId &&
            rem.claimVersion === claimedVersion &&
            rem.reminderStatus === REMINDER_STATUS.PROCESSING
          ) {
            rem.reminderStatus = targetStatus;
            rem.isActive = Boolean(isActive);
            rem.sentAt = sentAt;
            rem.lastError = lastError;
            rem.claimOwner = null;
            rem.claimExpiresAt = null;
            return [{ affected: 1 }];
          }
          return [{ affected: 0 }]; // Pre-empted!
        }

        // 3. Transient Failure / Retry Update
        if (lower.includes('set') && lower.includes('reminder_status =') && lower.includes('retry_count = @1')) {
          const [id, nextRetryCount, nextAttemptAtOrLastError, errOrWorker, workerOrVersion, version] = params;
          const rem = remindersDb.get(id);
          if (rem) {
            rem.retryCount = nextRetryCount;
            if (lower.includes('failed')) {
              rem.reminderStatus = REMINDER_STATUS.FAILED;
              rem.isActive = false;
              rem.lastError = nextAttemptAtOrLastError;
            } else {
              rem.reminderStatus = REMINDER_STATUS.PENDING;
              rem.nextAttemptAt = nextAttemptAtOrLastError;
              rem.lastError = errOrWorker;
            }
            rem.claimOwner = null;
            rem.claimExpiresAt = null;
            return [{ affected: 1 }];
          }
          return [{ affected: 0 }];
        }

        // 4. Update recipient_email
        if (lower.includes('update reminders set recipient_email = @1')) {
          const [id, email] = params;
          const rem = remindersDb.get(id);
          if (rem) rem.recipientEmail = email;
          return [{ affected: 1 }];
        }

        return [];
      }
    };
  });

  describe('Timezone Formatting in Asia/Colombo', () => {
    it('should format UTC timestamp to Asia/Colombo date and time', () => {
      // 14:30:00 UTC on Nov 23, 2026 is 20:00:00 (+05:30) in Colombo
      const utcDate = new Date('2026-11-23T14:30:00.000Z');
      const formattedDate = formatColomboDate(utcDate);
      const formattedTime = formatColomboTime(utcDate);

      assert.strictEqual(formattedDate, '23 Nov 2026');
      assert.strictEqual(formattedTime, '08:00 pm (Asia/Colombo)');
    });
  });

  describe('Due Selection and Schedule Immutability', () => {
    it('should select initial reminder (retryCount=0) when scheduledAt <= now', async () => {
      const sweeper = new ReminderSweeperService({
        dataSource: mockDataSource,
        notificationService: mockNotificationService,
        recipientResolver: mockRecipientResolver
      });

      const initialScheduledTime = new Date(Date.now() - 5000); // 5 seconds ago
      remindersDb.set('rem-1', {
        id: 'rem-1',
        bookingId: 'bk-1',
        userId: 'usr-1',
        recipientEmail: 'UNRESOLVED',
        reminderType: REMINDER_TYPE.ARRIVAL,
        scheduledAt: initialScheduledTime,
        nextAttemptAt: null,
        reminderStatus: REMINDER_STATUS.PENDING,
        retryCount: 0,
        isActive: true,
        claimVersion: 0,
        payload: JSON.stringify({ bookingReference: 'BK-100', facilityId: 'FAC-01' })
      });

      const stats = await sweeper.sweep();
      assert.strictEqual(stats.claimed, 1);
      assert.strictEqual(stats.sent, 1);

      const rem = remindersDb.get('rem-1');
      assert.strictEqual(rem.reminderStatus, REMINDER_STATUS.SENT);
      assert.strictEqual(rem.isActive, false);
      assert.strictEqual(rem.recipientEmail, 'usr-1@parkease.com'); // Resolved!
      // scheduledAt must remain immutable!
      assert.strictEqual(rem.scheduledAt, initialScheduledTime);
    });

    it('should NOT select retried reminder if nextAttemptAt is in the future, even if scheduledAt is past', async () => {
      const sweeper = new ReminderSweeperService({
        dataSource: mockDataSource,
        notificationService: mockNotificationService,
        recipientResolver: mockRecipientResolver
      });

      remindersDb.set('rem-retrying-future', {
        id: 'rem-retrying-future',
        bookingId: 'bk-2',
        userId: 'usr-2',
        recipientEmail: 'usr-2@parkease.com',
        reminderType: REMINDER_TYPE.ARRIVAL,
        scheduledAt: new Date(Date.now() - 60000), // Past
        nextAttemptAt: new Date(Date.now() + 60000), // In the future!
        reminderStatus: REMINDER_STATUS.PENDING,
        retryCount: 1,
        isActive: true,
        claimVersion: 1
      });

      const stats = await sweeper.sweep();
      assert.strictEqual(stats.claimed, 0);
      assert.strictEqual(stats.sent, 0);
    });
  });

  describe('Retry Limit Semantics (SWEEPER_MAX_ATTEMPTS = 3)', () => {
    it('should execute exactly 3 total attempts (1 initial + 2 retries) before transitioning to FAILED', async () => {
      // Mock notification service to always simulate transient failure
      let attemptCount = 0;
      const failingNotificationService = {
        processNotification: async () => {
          attemptCount++;
          return { delivered: false, retryable: true, error: 'SMTP connection timeout' };
        }
      };

      const sweeper = new ReminderSweeperService({
        dataSource: mockDataSource,
        notificationService: failingNotificationService,
        recipientResolver: mockRecipientResolver,
        config: { maxAttempts: 3, initialRetryDelayMs: 1000, batchSize: 10 }
      });

      const originalScheduledAt = new Date(Date.now() - 5000);
      remindersDb.set('rem-retry-limit', {
        id: 'rem-retry-limit',
        bookingId: 'bk-limit',
        userId: 'usr-limit',
        recipientEmail: 'usr-limit@parkease.com',
        reminderType: REMINDER_TYPE.ARRIVAL,
        scheduledAt: originalScheduledAt,
        nextAttemptAt: null,
        reminderStatus: REMINDER_STATUS.PENDING,
        retryCount: 0,
        isActive: true,
        claimVersion: 0
      });

      // --- Attempt 1 (Initial: retryCount = 0) ---
      let stats = await sweeper.sweep();
      assert.strictEqual(stats.claimed, 1);
      assert.strictEqual(attemptCount, 1);

      let rem = remindersDb.get('rem-retry-limit');
      assert.strictEqual(rem.reminderStatus, REMINDER_STATUS.PENDING);
      assert.strictEqual(rem.retryCount, 1);
      assert.ok(rem.nextAttemptAt);
      assert.strictEqual(rem.scheduledAt, originalScheduledAt); // Immutability preserved

      // Fast-forward nextAttemptAt into the past for Retry 1
      rem.nextAttemptAt = new Date(Date.now() - 1000);

      // --- Attempt 2 (Retry 1: retryCount = 1) ---
      stats = await sweeper.sweep();
      assert.strictEqual(stats.claimed, 1);
      assert.strictEqual(attemptCount, 2);

      rem = remindersDb.get('rem-retry-limit');
      assert.strictEqual(rem.reminderStatus, REMINDER_STATUS.PENDING);
      assert.strictEqual(rem.retryCount, 2);
      assert.strictEqual(rem.scheduledAt, originalScheduledAt);

      // Fast-forward nextAttemptAt into the past for Retry 2
      rem.nextAttemptAt = new Date(Date.now() - 1000);

      // --- Attempt 3 (Retry 2 / Final: retryCount = 2) ---
      stats = await sweeper.sweep();
      assert.strictEqual(stats.claimed, 1);
      assert.strictEqual(stats.failed, 1);
      assert.strictEqual(attemptCount, 3); // Exactly 3 attempts!

      rem = remindersDb.get('rem-retry-limit');
      assert.strictEqual(rem.reminderStatus, REMINDER_STATUS.FAILED);
      assert.strictEqual(rem.retryCount, 3);
      assert.strictEqual(rem.isActive, false); // Inactive
      assert.match(rem.lastError, /Exhausted maximum execution attempts \(3\)/);
      assert.strictEqual(rem.scheduledAt, originalScheduledAt);

      // --- Further Sweeps: No 4th Attempt Must Occur! ---
      stats = await sweeper.sweep();
      assert.strictEqual(stats.claimed, 0);
      assert.strictEqual(attemptCount, 3); // Unchanged!
    });
  });

  describe('Overdue Grace Period (30 Minutes)', () => {
    it('should evaluate 30m grace period on original scheduledAt even during retry', async () => {
      const sweeper = new ReminderSweeperService({
        dataSource: mockDataSource,
        notificationService: mockNotificationService,
        recipientResolver: mockRecipientResolver
      });

      // Scheduled 35 minutes ago, but retry scheduled for right now
      const overdueScheduledAt = new Date(Date.now() - 35 * 60 * 1000);
      remindersDb.set('rem-overdue-retry', {
        id: 'rem-overdue-retry',
        bookingId: 'bk-overdue',
        userId: 'usr-overdue',
        recipientEmail: 'usr-overdue@parkease.com',
        reminderType: REMINDER_TYPE.ARRIVAL,
        scheduledAt: overdueScheduledAt,
        nextAttemptAt: new Date(Date.now() - 1000), // Due now
        reminderStatus: REMINDER_STATUS.PENDING,
        retryCount: 1,
        isActive: true,
        claimVersion: 1
      });

      const stats = await sweeper.sweep();
      assert.strictEqual(stats.claimed, 1);
      assert.strictEqual(stats.skipped, 1);
      assert.strictEqual(dispatchedNotifications.length, 0); // No email sent!

      const rem = remindersDb.get('rem-overdue-retry');
      assert.strictEqual(rem.reminderStatus, REMINDER_STATUS.SKIPPED);
      assert.strictEqual(rem.isActive, false);
      assert.match(rem.lastError, /exceeded 30-minute grace period/);
    });
  });

  describe('Recipient Resolution on Unresolved Sentinel', () => {
    it('should transition reminder to SKIPPED when user is not found (404)', async () => {
      const sweeper = new ReminderSweeperService({
        dataSource: mockDataSource,
        notificationService: mockNotificationService,
        recipientResolver: mockRecipientResolver
      });

      remindersDb.set('rem-user-404', {
        id: 'rem-user-404',
        bookingId: 'bk-404',
        userId: 'user-not-found', // Triggers 404
        recipientEmail: 'UNRESOLVED',
        reminderType: REMINDER_TYPE.ARRIVAL,
        scheduledAt: new Date(Date.now() - 1000),
        reminderStatus: REMINDER_STATUS.PENDING,
        retryCount: 0,
        isActive: true,
        claimVersion: 0
      });

      const stats = await sweeper.sweep();
      assert.strictEqual(stats.claimed, 1);
      assert.strictEqual(stats.skipped, 1);

      const rem = remindersDb.get('rem-user-404');
      assert.strictEqual(rem.reminderStatus, REMINDER_STATUS.SKIPPED);
      assert.strictEqual(rem.isActive, false);
      assert.match(rem.lastError, /User not found in User Service/);
    });
  });

  describe('Active Claim Invalidation (Fencing Tokens)', () => {
    it('should discard finalization write when claimVersion was bumped by cancellation', async () => {
      const sweeper = new ReminderSweeperService({
        dataSource: mockDataSource,
        notificationService: mockNotificationService,
        recipientResolver: mockRecipientResolver,
        workerId: 'worker-preempt-test'
      });

      remindersDb.set('rem-preempt', {
        id: 'rem-preempt',
        bookingId: 'bk-preempt',
        userId: 'usr-preempt',
        recipientEmail: 'usr-preempt@parkease.com',
        reminderType: REMINDER_TYPE.ARRIVAL,
        scheduledAt: new Date(Date.now() - 1000),
        reminderStatus: REMINDER_STATUS.PENDING,
        retryCount: 0,
        isActive: true,
        claimVersion: 0
      });

      // Intercept notificationService to simulate cancellation occurring DURING email sending
      mockNotificationService.processNotification = async () => {
        // While worker is in-flight, a CANCELLED event arrives:
        const rem = remindersDb.get('rem-preempt');
        rem.reminderStatus = REMINDER_STATUS.CANCELLED;
        rem.isActive = false;
        rem.claimVersion = rem.claimVersion + 1; // Bumped version to 2!
        rem.claimOwner = null;
        return { delivered: true, messageId: 'msg-preempt' };
      };

      const stats = await sweeper.sweep();
      assert.strictEqual(stats.claimed, 1);

      // Verify the reminder record was NOT overwritten back to SENT!
      const rem = remindersDb.get('rem-preempt');
      assert.strictEqual(rem.reminderStatus, REMINDER_STATUS.CANCELLED);
      assert.strictEqual(rem.isActive, false);
    });
  });
});
