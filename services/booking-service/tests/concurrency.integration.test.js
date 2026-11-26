const test = require('node:test');
const assert = require('node:assert');
const AppDataSource = require('../src/config/data-source');
const bookingService = require('../src/services/booking.service');
const facilityClient = require('../src/integrations/facility.client');
const { BOOKING_STATUS } = require('../src/constants/booking-status');

// Save original facility client method to restore after testing
const originalGetFacilityById = facilityClient.getFacilityById.bind(facilityClient);

// Map to provide controlled test capacities for mock facilities
const testFacilityMap = new Map();

// Helper to generate dynamic future dates to prevent "cannot book in past" errors
function getFutureInterval(hoursOffsetStart, durationHours) {
  // Start tomorrow to ensure safe future window
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
  // Mock only the Facility Service to return controlled capacities for test facility IDs
  facilityClient.getFacilityById = async (facilityId) => {
    if (testFacilityMap.has(facilityId)) {
      return testFacilityMap.get(facilityId);
    }
    return originalGetFacilityById(facilityId);
  };

  // Initialize real SQL Server database connection if not already active
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
});

test.after(async () => {
  // Restore original facility client method
  facilityClient.getFacilityById = originalGetFacilityById;

  // Destroy database connection cleanly
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

test('SQL Server Concurrency Protection with sp_getapplock', async (t) => {
  await t.test('Scenario 1: Exact-slot overbooking prevents capacity overflow', async () => {
    const facilityId = `FAC-CONCUR-SC1-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const capacity = 3;

    testFacilityMap.set(facilityId, {
      id: facilityId,
      name: 'Scenario 1 Test Facility',
      totalCapacity: capacity,
      hourlyRate: 5.00
    });

    const { startTime, endTime } = getFutureInterval(1, 2); // 2 hours window tomorrow

    // 5 simultaneous requests competing for 3 spots in the exact same interval
    const requestPayloads = Array.from({ length: 5 }, (_, i) => ({
      userId: `USR-SC1-${i + 1}`,
      facilityId,
      vehicleRegistrationNumber: `CAB-SC1-${i + 1}`,
      startTime,
      endTime
    }));

    try {
      // Dispatch 5 simultaneous requests via Promise.allSettled
      const results = await Promise.allSettled(
        requestPayloads.map((payload) => bookingService.createBooking(payload))
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Assertions on responses
      assert.strictEqual(fulfilled.length, capacity, `Exactly ${capacity} requests must succeed`);
      assert.strictEqual(rejected.length, 2, 'Exactly 2 requests must be rejected');

      // Assert that all rejected requests received 409 Conflict
      for (const rej of rejected) {
        assert.strictEqual(rej.reason.statusCode, 409, 'Rejection status code must be 409');
        assert.match(
          rej.reason.message,
          /Parking facility is fully booked/i,
          'Rejection message must indicate facility capacity exceeded'
        );
      }

      // Query real SQL Server database to verify physical row count
      const dbRows = await AppDataSource.query(
        'SELECT id, booking_reference AS bookingReference, status FROM bookings WHERE facility_id = @0',
        [facilityId]
      );

      assert.strictEqual(dbRows.length, capacity, `Database must contain exactly ${capacity} rows`);

      // Verify that all created booking references are distinct (no duplicate references)
      const references = new Set(dbRows.map((r) => r.bookingReference));
      assert.strictEqual(references.size, capacity, 'All created booking references must be unique');

      for (const row of dbRows) {
        assert.strictEqual(row.status, BOOKING_STATUS.PENDING);
      }
    } finally {
      // Clean up ONLY records belonging to this test facility ID
      await AppDataSource.query('DELETE FROM bookings WHERE facility_id = @0', [facilityId]);

      // Verify cleanup succeeded
      const checkCleanup = await AppDataSource.query(
        'SELECT COUNT(*) AS remaining FROM bookings WHERE facility_id = @0',
        [facilityId]
      );
      assert.strictEqual(checkCleanup[0].remaining, 0, 'Test facility records must be completely deleted');
    }
  });

  await t.test('Scenario 2: Facility lock independence allows concurrent bookings on different facilities', async () => {
    const facilityA = `FAC-CONCUR-SC2A-${Date.now()}`;
    const facilityB = `FAC-CONCUR-SC2B-${Date.now()}`;

    testFacilityMap.set(facilityA, { id: facilityA, name: 'Facility A', totalCapacity: 1, hourlyRate: 4.00 });
    testFacilityMap.set(facilityB, { id: facilityB, name: 'Facility B', totalCapacity: 1, hourlyRate: 4.00 });

    const { startTime, endTime } = getFutureInterval(3, 2);

    const payloadA = {
      userId: 'USR-SC2-A',
      facilityId: facilityA,
      vehicleRegistrationNumber: 'CAB-2A',
      startTime,
      endTime
    };

    const payloadB = {
      userId: 'USR-SC2-B',
      facilityId: facilityB,
      vehicleRegistrationNumber: 'CAB-2B',
      startTime,
      endTime
    };

    try {
      // Fire requests for different facilities concurrently
      const results = await Promise.allSettled([
        bookingService.createBooking(payloadA),
        bookingService.createBooking(payloadB)
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      assert.strictEqual(fulfilled.length, 2, 'Both concurrent requests on distinct facilities must succeed');

      // Verify database row counts
      const countA = await AppDataSource.query('SELECT COUNT(*) AS count FROM bookings WHERE facility_id = @0', [facilityA]);
      const countB = await AppDataSource.query('SELECT COUNT(*) AS count FROM bookings WHERE facility_id = @0', [facilityB]);

      assert.strictEqual(countA[0].count, 1, 'Facility A must have 1 booking');
      assert.strictEqual(countB[0].count, 1, 'Facility B must have 1 booking');
    } finally {
      await AppDataSource.query('DELETE FROM bookings WHERE facility_id = @0', [facilityA]);
      await AppDataSource.query('DELETE FROM bookings WHERE facility_id = @0', [facilityB]);
    }
  });

  await t.test('Scenario 3: Sequential non-overlapping bookings succeed concurrently without false rejection', async () => {
    const facilityId = `FAC-CONCUR-SC3-${Date.now()}`;
    const capacity = 1;

    testFacilityMap.set(facilityId, {
      id: facilityId,
      name: 'Scenario 3 Test Facility',
      totalCapacity: capacity,
      hourlyRate: 5.00
    });

    // 3 back-to-back non-overlapping intervals: 10-12, 12-14, 14-16
    const slot1 = getFutureInterval(5, 2);
    const slot2 = getFutureInterval(7, 2);
    const slot3 = getFutureInterval(9, 2);

    const requests = [
      { userId: 'USR-SC3-1', facilityId, vehicleRegistrationNumber: 'CAB-3A', startTime: slot1.startTime, endTime: slot1.endTime },
      { userId: 'USR-SC3-2', facilityId, vehicleRegistrationNumber: 'CAB-3B', startTime: slot2.startTime, endTime: slot2.endTime },
      { userId: 'USR-SC3-3', facilityId, vehicleRegistrationNumber: 'CAB-3C', startTime: slot3.startTime, endTime: slot3.endTime }
    ];

    try {
      // Even though fired concurrently and serialized by sp_getapplock,
      // sweep-line recognizes they do NOT overlap each other, so all 3 must fit within capacity 1!
      const results = await Promise.allSettled(
        requests.map((req) => bookingService.createBooking(req))
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.strictEqual(fulfilled.length, 3, 'All 3 sequential non-overlapping bookings must succeed');
      assert.strictEqual(rejected.length, 0, 'No requests should be rejected');

      const count = await AppDataSource.query('SELECT COUNT(*) AS count FROM bookings WHERE facility_id = @0', [facilityId]);
      assert.strictEqual(count[0].count, 3, 'Database must contain all 3 sequential bookings');
    } finally {
      await AppDataSource.query('DELETE FROM bookings WHERE facility_id = @0', [facilityId]);
    }
  });

  await t.test('Scenario 4: Staggered partial overlap under concurrency approves exactly two and rejects one', async () => {
    const facilityId = `FAC-CONCUR-SC4-${Date.now()}`;
    const capacity = 2;

    testFacilityMap.set(facilityId, {
      id: facilityId,
      name: 'Scenario 4 Test Facility',
      totalCapacity: capacity,
      hourlyRate: 5.00
    });

    // 3 staggered overlapping intervals:
    // Window 1: 10:00 - 14:00 (4h)
    // Window 2: 12:00 - 16:00 (4h, overlaps Window 1 between 12:00-14:00 -> occupancy = 2)
    // Window 3: 13:00 - 15:00 (2h, overlaps BOTH Window 1 & Window 2 between 13:00-14:00 -> peak occupancy becomes 3 > 2!)
    const w1 = getFutureInterval(12, 4);
    const w2 = getFutureInterval(14, 4);
    const w3 = getFutureInterval(15, 2);

    const requests = [
      { userId: 'USR-SC4-1', facilityId, vehicleRegistrationNumber: 'CAB-4A', startTime: w1.startTime, endTime: w1.endTime },
      { userId: 'USR-SC4-2', facilityId, vehicleRegistrationNumber: 'CAB-4B', startTime: w2.startTime, endTime: w2.endTime },
      { userId: 'USR-SC4-3', facilityId, vehicleRegistrationNumber: 'CAB-4C', startTime: w3.startTime, endTime: w3.endTime }
    ];

    try {
      const results = await Promise.allSettled(
        requests.map((req) => bookingService.createBooking(req))
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Requirement: Exactly two requests succeed and one receives HTTP 409
      // (Do not assume which specific request succeeds, as execution order is not guaranteed)
      assert.strictEqual(fulfilled.length, 2, 'Exactly two requests must succeed');
      assert.strictEqual(rejected.length, 1, 'Exactly one request must be rejected');

      assert.strictEqual(rejected[0].reason.statusCode, 409, 'Rejected request must have HTTP 409 status code');
      assert.match(
        rejected[0].reason.message,
        /Parking facility is fully booked/i,
        'Rejected request must report facility capacity exceeded'
      );

      const dbRows = await AppDataSource.query(
        'SELECT COUNT(*) AS count FROM bookings WHERE facility_id = @0',
        [facilityId]
      );
      assert.strictEqual(dbRows[0].count, 2, 'Database must contain exactly 2 bookings');
    } finally {
      await AppDataSource.query('DELETE FROM bookings WHERE facility_id = @0', [facilityId]);

      const checkCleanup = await AppDataSource.query(
        'SELECT COUNT(*) AS remaining FROM bookings WHERE facility_id = @0',
        [facilityId]
      );
      assert.strictEqual(checkCleanup[0].remaining, 0, 'Scenario 4 records must be cleanly removed');
    }
  });
});
