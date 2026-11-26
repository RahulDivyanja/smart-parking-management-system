const test = require('node:test');
const assert = require('node:assert');
const { calculatePeakOccupancy } = require('../src/utils/capacity');
const { generateBookingReference } = require('../src/utils/reference-generator');
const { BOOKING_STATUS, isValidTransition } = require('../src/constants/booking-status');

test('Sweep-Line Capacity Algorithm', async (t) => {
  await t.test('returns 0 when there are no existing bookings', () => {
    const peak = calculatePeakOccupancy([], '2026-11-20T10:00:00.000Z', '2026-11-20T18:00:00.000Z');
    assert.strictEqual(peak, 0);
  });

  await t.test('does NOT accumulate sequential back-to-back bookings', () => {
    // 3 sequential bookings, none overlap each other
    const bookings = [
      { startTime: '2026-11-20T10:00:00.000Z', endTime: '2026-11-20T12:00:00.000Z' },
      { startTime: '2026-11-20T12:00:00.000Z', endTime: '2026-11-20T14:00:00.000Z' },
      { startTime: '2026-11-20T14:00:00.000Z', endTime: '2026-11-20T16:00:00.000Z' }
    ];

    // Over the entire window 10:00 to 16:00, peak simultaneous occupancy is strictly 1
    const peak = calculatePeakOccupancy(bookings, '2026-11-20T10:00:00.000Z', '2026-11-20T16:00:00.000Z');
    assert.strictEqual(peak, 1, 'Sequential bookings should result in peak simultaneous occupancy of 1');
  });

  await t.test('accurately calculates peak simultaneous overlapping bookings', () => {
    const bookings = [
      // Booking A: 10:00 - 14:00
      { startTime: '2026-11-20T10:00:00.000Z', endTime: '2026-11-20T14:00:00.000Z' },
      // Booking B: 12:00 - 16:00 (overlaps with A between 12:00 and 14:00 -> occupancy = 2)
      { startTime: '2026-11-20T12:00:00.000Z', endTime: '2026-11-20T16:00:00.000Z' },
      // Booking C: 13:00 - 15:00 (overlaps with A & B between 13:00 and 14:00 -> occupancy = 3)
      { startTime: '2026-11-20T13:00:00.000Z', endTime: '2026-11-20T15:00:00.000Z' }
    ];

    const peak = calculatePeakOccupancy(bookings, '2026-11-20T10:00:00.000Z', '2026-11-20T18:00:00.000Z');
    assert.strictEqual(peak, 3, 'Peak simultaneous occupancy should be 3 between 13:00 and 14:00');
  });

  await t.test('clamps bookings extending outside requested interval', () => {
    const bookings = [
      // Booking starts earlier and ends later than query window
      { startTime: '2026-11-20T08:00:00.000Z', endTime: '2026-11-20T22:00:00.000Z' }
    ];

    const peak = calculatePeakOccupancy(bookings, '2026-11-20T12:00:00.000Z', '2026-11-20T14:00:00.000Z');
    assert.strictEqual(peak, 1);
  });
});

test('Booking Reference Generator', async (t) => {
  await t.test('generates valid format BK-YYYYMMDD-XXXX', () => {
    const ref = generateBookingReference();
    const regex = /^BK-\d{8}-[A-F0-9]{4}$/;
    assert.match(ref, regex, `Reference '${ref}' should match BK-YYYYMMDD-XXXX pattern`);
  });

  await t.test('generates unique references across multiple calls', () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) {
      const ref = generateBookingReference();
      assert.strictEqual(set.has(ref), false, `Reference ${ref} should be unique`);
      set.add(ref);
    }
  });
});

test('Booking Status Transitions State Machine', async (t) => {
  await t.test('allows valid transitions from PENDING', () => {
    assert.strictEqual(isValidTransition(BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED), true);
    assert.strictEqual(isValidTransition(BOOKING_STATUS.PENDING, BOOKING_STATUS.CANCELLED), true);
    assert.strictEqual(isValidTransition(BOOKING_STATUS.PENDING, BOOKING_STATUS.EXPIRED), true);
  });

  await t.test('disallows invalid transitions from PENDING', () => {
    assert.strictEqual(isValidTransition(BOOKING_STATUS.PENDING, BOOKING_STATUS.COMPLETED), false);
  });

  await t.test('allows valid transitions from CONFIRMED', () => {
    assert.strictEqual(isValidTransition(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED), true);
    assert.strictEqual(isValidTransition(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED), true);
  });

  await t.test('disallows invalid transitions from CONFIRMED', () => {
    assert.strictEqual(isValidTransition(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.PENDING), false);
    assert.strictEqual(isValidTransition(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.EXPIRED), false);
  });

  await t.test('terminal states disallow all transitions', () => {
    for (const terminal of [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.COMPLETED, BOOKING_STATUS.EXPIRED]) {
      for (const target of Object.values(BOOKING_STATUS)) {
        assert.strictEqual(
          isValidTransition(terminal, target),
          false,
          `No transitions allowed from terminal state ${terminal}`
        );
      }
    }
  });
});
