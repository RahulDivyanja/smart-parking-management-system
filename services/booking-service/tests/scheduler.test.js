const test = require('node:test');
const assert = require('node:assert');
const { ExpirationSchedulerService } = require('../src/services/expiration-scheduler.service');
const { BOOKING_STATUS } = require('../src/constants/booking-status');

/**
 * Helper to build mock publisher
 */
function createMockPublisher() {
  const publishedEvents = [];
  return {
    publishedEvents,
    async publishBookingStatusChanged(booking, previousStatus) {
      publishedEvents.push({
        eventType: 'BOOKING_STATUS_CHANGED',
        payload: {
          bookingId: booking.id,
          bookingReference: booking.bookingReference,
          userId: booking.userId,
          facilityId: booking.facilityId,
          previousStatus,
          currentStatus: booking.status
        }
      });
    }
  };
}

test('ExpirationSchedulerService - Background Expiration Sweeper', async (t) => {
  await t.test('transitions overdue PENDING bookings to EXPIRED and publishes events', async () => {
    let capturedQuery = null;
    let capturedParams = null;

    const mockDataSource = {
      isInitialized: true,
      async query(sql, params) {
        capturedQuery = sql;
        capturedParams = params;
        // Simulate returning 1 overdue pending booking that was updated
        return [
          {
            id: 'uuid-overdue-1',
            bookingReference: 'BK-20261123-OLD1',
            userId: 'USR-100',
            facilityId: 'FAC-01',
            status: BOOKING_STATUS.EXPIRED
          }
        ];
      }
    };

    const mockPublisher = createMockPublisher();
    const scheduler = new ExpirationSchedulerService(mockDataSource, mockPublisher);

    const updated = await scheduler.expireOverduePendingBookings(10);

    // Verify SQL query targets only PENDING records older than hold threshold
    assert.strictEqual(updated.length, 1);
    assert.match(capturedQuery, /WHERE status = 'PENDING'/);
    assert.match(capturedQuery, /AND created_at < DATEADD\(minute, -@0, SYSUTCDATETIME\(\)\)/);
    assert.deepStrictEqual(capturedParams, [10]);

    // Verify published event payload
    assert.strictEqual(mockPublisher.publishedEvents.length, 1);
    const event = mockPublisher.publishedEvents[0];
    assert.strictEqual(event.eventType, 'BOOKING_STATUS_CHANGED');
    assert.strictEqual(event.payload.bookingId, 'uuid-overdue-1');
    assert.strictEqual(event.payload.bookingReference, 'BK-20261123-OLD1');
    assert.strictEqual(event.payload.previousStatus, 'PENDING');
    assert.strictEqual(event.payload.currentStatus, 'EXPIRED');
  });

  await t.test('does not expire recent PENDING bookings or CONFIRMED bookings', async () => {
    const mockDataSource = {
      isInitialized: true,
      async query(sql, params) {
        // When there are no overdue PENDING records, the atomic UPDATE updates 0 rows
        return [];
      }
    };

    const mockPublisher = createMockPublisher();
    const scheduler = new ExpirationSchedulerService(mockDataSource, mockPublisher);

    const updated = await scheduler.expireOverduePendingBookings(10);

    assert.strictEqual(updated.length, 0);
    assert.strictEqual(mockPublisher.publishedEvents.length, 0, 'No events should be published when no records expired');
  });

  await t.test('repeated runs do not publish duplicate expiration events', async () => {
    let callCount = 0;
    const mockDataSource = {
      isInitialized: true,
      async query() {
        callCount++;
        // First run: 1 record expired
        if (callCount === 1) {
          return [
            {
              id: 'uuid-1',
              bookingReference: 'BK-001',
              userId: 'USR-1',
              facilityId: 'FAC-1',
              status: BOOKING_STATUS.EXPIRED
            }
          ];
        }
        // Second run: 0 records updated (already EXPIRED)
        return [];
      }
    };

    const mockPublisher = createMockPublisher();
    const scheduler = new ExpirationSchedulerService(mockDataSource, mockPublisher);

    // First sweep
    const run1 = await scheduler.expireOverduePendingBookings(10);
    assert.strictEqual(run1.length, 1);
    assert.strictEqual(mockPublisher.publishedEvents.length, 1);

    // Second sweep
    const run2 = await scheduler.expireOverduePendingBookings(10);
    assert.strictEqual(run2.length, 0);
    // Events count should STILL be 1 (no duplicates!)
    assert.strictEqual(mockPublisher.publishedEvents.length, 1, 'No duplicate events should be emitted on repeated sweeps');
  });

  await t.test('prevents overlapping scheduler executions', async () => {
    let activeExecutions = 0;
    let maxConcurrent = 0;

    const mockDataSource = {
      isInitialized: true,
      async query() {
        activeExecutions++;
        maxConcurrent = Math.max(maxConcurrent, activeExecutions);
        // Simulate a slow database query
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeExecutions--;
        return [];
      }
    };

    const scheduler = new ExpirationSchedulerService(mockDataSource, createMockPublisher());

    // Trigger two sweeps in parallel
    const promise1 = scheduler.sweep();
    const promise2 = scheduler.sweep(); // Should be skipped due to overlap protection

    await Promise.all([promise1, promise2]);

    assert.strictEqual(maxConcurrent, 1, 'Never run more than 1 sweep concurrently');
  });

  await t.test('scheduler errors do not crash the service', async () => {
    const mockDataSource = {
      isInitialized: true,
      async query() {
        throw new Error('Database connection failed (simulated)');
      }
    };

    const scheduler = new ExpirationSchedulerService(mockDataSource, createMockPublisher());

    // Should catch the error internally and not throw
    let errorThrown = false;
    try {
      const count = await scheduler.sweep();
      assert.strictEqual(count, 0);
    } catch (err) {
      errorThrown = true;
    }

    assert.strictEqual(errorThrown, false, 'sweep() must not rethrow or crash the application');
    assert.strictEqual(scheduler.isProcessing, false, 'isProcessing flag must reset even on error');
  });

  await t.test('start and stop controls timer properly', async () => {
    const mockDataSource = { isInitialized: false };
    const scheduler = new ExpirationSchedulerService(mockDataSource, createMockPublisher());

    assert.strictEqual(scheduler.isRunning, false);

    scheduler.start(100000);
    assert.strictEqual(scheduler.isRunning, true);

    scheduler.stop();
    assert.strictEqual(scheduler.isRunning, false);
  });
});
