// SAFEGUARD 1: Set process.env.DB_NAME before importing any application modules
process.env.DB_NAME = 'ParkEase_BookingDB_Test';

const test = require('node:test');
const assert = require('node:assert');
const { DataSource } = require('typeorm');

const config = require('../src/config/env');
const AppDataSource = require('../src/config/data-source');
const bookingService = require('../src/services/booking.service');
const expirationScheduler = require('../src/services/expiration-scheduler.service');
const eventPublisher = require('../src/events/booking-event.publisher');
const facilityClient = require('../src/integrations/facility.client');
const { BOOKING_STATUS } = require('../src/constants/booking-status');

// Track exact booking IDs created by this test execution for strict cleanup (Safeguard 7)
const createdTestBookingIds = [];

// Track test facilities for facility client mock
const testFacilityMap = new Map();
const originalGetFacilityById = facilityClient.getFacilityById.bind(facilityClient);

// Event spy tracking
let publishedEvents = [];
const originalPublishStatus = eventPublisher.publishBookingStatusChanged.bind(eventPublisher);

function getFutureInterval(hoursOffsetStart, durationHours) {
  const baseTimestamp = Date.now() + 24 * 60 * 60 * 1000;
  const start = new Date(baseTimestamp + hoursOffsetStart * 60 * 60 * 1000);
  start.setMilliseconds(0); // Align to whole seconds matching SQL Server datetime2(0) precision
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  end.setMilliseconds(0);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

test.before(async () => {
  // Mock facility client only for test facility IDs
  facilityClient.getFacilityById = async (facilityId) => {
    if (testFacilityMap.has(facilityId)) {
      return testFacilityMap.get(facilityId);
    }
    return originalGetFacilityById(facilityId);
  };

  // Setup event spy
  eventPublisher.publishBookingStatusChanged = async (booking, previousStatus) => {
    publishedEvents.push({ booking, previousStatus });
    return originalPublishStatus(booking, previousStatus);
  };

  // Step 1: Ensure AppDataSource database option is explicitly ParkEase_BookingDB_Test before initialize (Safeguards 2 & 3)
  AppDataSource.setOptions({
    database: 'ParkEase_BookingDB_Test'
  });

  // Step 2: Initialize TypeORM connection to test database
  await AppDataSource.initialize();

  // Step 3: Verify actual connected database is exactly ParkEase_BookingDB_Test (Safeguard 2)
  const [dbCheck] = await AppDataSource.query('SELECT DB_NAME() AS databaseName');
  if (!dbCheck || dbCheck.databaseName !== 'ParkEase_BookingDB_Test') {
    await AppDataSource.destroy();
    throw new Error(
      `CRITICAL SAFETY ABORT: Connected to database '${dbCheck?.databaseName}' instead of 'ParkEase_BookingDB_Test'. Aborting tests immediately.`
    );
  }
  console.log(`[Safety Verified] Connected database: ${dbCheck.databaseName}`);

  // Step 4: Run migrations to ensure schema exists in ParkEase_BookingDB_Test
  await AppDataSource.runMigrations();

  // Step 5: Pre-flight check: ensure no pre-existing overdue PENDING records exist in test DB (Safeguard 4)
  const preExistingOverdue = await AppDataSource.query(
    `SELECT id, booking_reference AS bookingReference, created_at AS createdAt
     FROM bookings
     WHERE status = '${BOOKING_STATUS.PENDING}'
       AND created_at < DATEADD(minute, -@0, SYSUTCDATETIME());`,
    [config.business.pendingHoldMinutes]
  );

  if (preExistingOverdue.length > 0) {
    const ids = preExistingOverdue.map((r) => r.id).join(', ');
    throw new Error(
      `SAFETY ABORT: Test database contains ${preExistingOverdue.length} pre-existing overdue PENDING booking(s) from a prior run (IDs: ${ids}). Aborting without modifying them.`
    );
  }
});

test.after(async () => {
  // Restore original facility client and event publisher methods
  facilityClient.getFacilityById = originalGetFacilityById;
  eventPublisher.publishBookingStatusChanged = originalPublishStatus;

  // Safeguard 7: Strict cleanup deleting ONLY booking IDs created by this test execution
  try {
    if (AppDataSource.isInitialized && createdTestBookingIds.length > 0) {
      const placeholders = createdTestBookingIds.map((_, i) => `@${i}`).join(',');
      await AppDataSource.query(
        `DELETE FROM bookings WHERE id IN (${placeholders})`,
        createdTestBookingIds
      );
      console.log(`[Strict Cleanup] Deleted exactly ${createdTestBookingIds.length} test booking record(s).`);
    }
  } catch (cleanupErr) {
    console.error('[Cleanup Error]', cleanupErr);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
});

test('Live Database Expiration Scheduler Integration Tests (ParkEase_BookingDB_Test)', async (t) => {
  let overdueBookingId = null;
  let recentBookingId = null;
  let confirmedBookingId = null;

  await t.test('Scenario 1: Overdue PENDING booking expires while recent PENDING and CONFIRMED remain untouched', async () => {
    const facilityId = `FAC-SCHED-LIVE-SC1-${Date.now()}`;
    testFacilityMap.set(facilityId, {
      id: facilityId,
      name: 'Scheduler Test Facility 1',
      totalCapacity: 10,
      hourlyRate: 5.00
    });

    const slot1 = getFutureInterval(2, 2);
    const slot2 = getFutureInterval(5, 2);
    const slot3 = getFutureInterval(8, 2);

    // 1. Create Overdue Booking
    const booking1 = await bookingService.createBooking({
      userId: 'USR-SCHED-01',
      facilityId,
      vehicleRegistrationNumber: 'TEST-OVERDUE',
      startTime: slot1.startTime,
      endTime: slot1.endTime
    });
    overdueBookingId = booking1.id;
    createdTestBookingIds.push(overdueBookingId);

    // Set created_at to 15 minutes ago using SQL Server UTC time
    await AppDataSource.query(
      'UPDATE bookings SET created_at = DATEADD(minute, -15, SYSUTCDATETIME()) WHERE id = @0',
      [overdueBookingId]
    );

    // 2. Create Recent Booking (created seconds ago)
    const booking2 = await bookingService.createBooking({
      userId: 'USR-SCHED-02',
      facilityId,
      vehicleRegistrationNumber: 'TEST-RECENT',
      startTime: slot2.startTime,
      endTime: slot2.endTime
    });
    recentBookingId = booking2.id;
    createdTestBookingIds.push(recentBookingId);

    // 3. Create Confirmed Booking (even if created 15 mins ago, status must remain CONFIRMED)
    const booking3 = await bookingService.createBooking({
      userId: 'USR-SCHED-03',
      facilityId,
      vehicleRegistrationNumber: 'TEST-CONFIRMED',
      startTime: slot3.startTime,
      endTime: slot3.endTime
    });
    confirmedBookingId = booking3.id;
    createdTestBookingIds.push(confirmedBookingId);

    await AppDataSource.query(
      `UPDATE bookings 
       SET status = '${BOOKING_STATUS.CONFIRMED}', 
           created_at = DATEADD(minute, -15, SYSUTCDATETIME()) 
       WHERE id = @0`,
      [confirmedBookingId]
    );

    // Reset published events before sweep
    publishedEvents = [];

    // Trigger scheduler sweep on live database
    const expiredCount = await expirationScheduler.sweep();

    assert.strictEqual(expiredCount, 1, 'Exactly 1 overdue booking must be expired by the scheduler');

    // Verify database state for all 3 bookings
    const [row1] = await AppDataSource.query('SELECT status FROM bookings WHERE id = @0', [overdueBookingId]);
    assert.strictEqual(row1.status, BOOKING_STATUS.EXPIRED, 'Overdue booking must be transitioned to EXPIRED');

    const [row2] = await AppDataSource.query('SELECT status FROM bookings WHERE id = @0', [recentBookingId]);
    assert.strictEqual(row2.status, BOOKING_STATUS.PENDING, 'Recent booking must remain PENDING');

    const [row3] = await AppDataSource.query('SELECT status FROM bookings WHERE id = @0', [confirmedBookingId]);
    assert.strictEqual(row3.status, BOOKING_STATUS.CONFIRMED, 'CONFIRMED booking must remain CONFIRMED');

    // Verify event publication
    assert.strictEqual(publishedEvents.length, 1, 'Exactly one expiration event must be published');
    assert.strictEqual(publishedEvents[0].booking.id, overdueBookingId);
    assert.strictEqual(publishedEvents[0].previousStatus, BOOKING_STATUS.PENDING);
    assert.strictEqual(publishedEvents[0].booking.status, BOOKING_STATUS.EXPIRED);
  });

  await t.test('Scenario 2: Repeated sweep on same database state does not emit duplicate events', async () => {
    // Reset event tracker
    publishedEvents = [];

    // Trigger second sweep immediately
    const expiredCount = await expirationScheduler.sweep();

    assert.strictEqual(expiredCount, 0, 'Second sweep must find 0 overdue bookings to expire');
    assert.strictEqual(publishedEvents.length, 0, 'No duplicate events should be published on repeated sweep');
  });

  await t.test('Scenario 3: Interaction with lazy expiration prevents duplicate events', async () => {
    const facilityId = `FAC-SCHED-LIVE-SC3-${Date.now()}`;
    testFacilityMap.set(facilityId, {
      id: facilityId,
      name: 'Scheduler Test Facility 3',
      totalCapacity: 5,
      hourlyRate: 5.00
    });

    const slot = getFutureInterval(12, 2);

    // Create a new overdue booking
    const booking4 = await bookingService.createBooking({
      userId: 'USR-SCHED-04',
      facilityId,
      vehicleRegistrationNumber: 'TEST-LAZY',
      startTime: slot.startTime,
      endTime: slot.endTime
    });
    const lazyBookingId = booking4.id;
    createdTestBookingIds.push(lazyBookingId);

    // Set created_at to 15 minutes ago
    await AppDataSource.query(
      'UPDATE bookings SET created_at = DATEADD(minute, -15, SYSUTCDATETIME()) WHERE id = @0',
      [lazyBookingId]
    );

    // Reset event tracker
    publishedEvents = [];

    // Step A: Invoke getBookingById (simulating an API request inspecting the booking, which fetches from DB and applies lazy expiration)
    const lazyResult = await bookingService.getBookingById(lazyBookingId);
    assert.strictEqual(lazyResult.status, BOOKING_STATUS.EXPIRED, 'Lazy check must transition booking to EXPIRED');
    assert.strictEqual(publishedEvents.length, 1, 'Lazy expiration must emit exactly 1 event');

    // Step B: Now run the scheduler sweep
    const sweepCount = await expirationScheduler.sweep();

    assert.strictEqual(sweepCount, 0, 'Scheduler sweep must skip the booking already expired by lazy evaluation');
    assert.strictEqual(publishedEvents.length, 1, 'Total events must remain 1 (no duplicate event emitted)');
  });

  await t.test('Scenario 4: Scheduler start and stop lifecycle controls', async () => {
    assert.strictEqual(expirationScheduler.isRunning, false, 'Scheduler should not be running initially');

    expirationScheduler.start(60000);
    assert.strictEqual(expirationScheduler.isRunning, true, 'Scheduler must be running after start()');

    expirationScheduler.stop();
    assert.strictEqual(expirationScheduler.isRunning, false, 'Scheduler must not be running after stop()');

    // Idempotent stop check
    expirationScheduler.stop();
    assert.strictEqual(expirationScheduler.isRunning, false, 'Calling stop() again must remain false and safe');
  });
});
