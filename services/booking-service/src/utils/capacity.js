/**
 * Sweep-Line (Discrete Event) Algorithm for Parking Capacity
 *
 * Calculates the peak simultaneous occupancy among overlapping bookings
 * within the requested time interval [reqStartTime, reqEndTime].
 *
 * Ensures that sequential/back-to-back bookings that do not overlap each other
 * are NOT falsely accumulated.
 *
 * @param {Array<{startTime: Date|string, endTime: Date|string}>} overlappingBookings
 * @param {Date|string} reqStartTime
 * @param {Date|string} reqEndTime
 * @returns {number} The maximum number of vehicles simultaneously parked at any point in the interval
 */
function calculatePeakOccupancy(overlappingBookings, reqStartTime, reqEndTime) {
  if (!overlappingBookings || overlappingBookings.length === 0) {
    return 0;
  }

  const windowStart = new Date(reqStartTime).getTime();
  const windowEnd = new Date(reqEndTime).getTime();

  const events = [];

  for (const booking of overlappingBookings) {
    const bookingStart = new Date(booking.startTime || booking.start_time).getTime();
    const bookingEnd = new Date(booking.endTime || booking.end_time).getTime();

    // Clamp the event timestamps within the requested window
    const effectiveStart = Math.max(bookingStart, windowStart);
    const effectiveEnd = Math.min(bookingEnd, windowEnd);

    // Only record events if duration within the window is greater than zero
    if (effectiveStart < effectiveEnd) {
      // Delta: +1 vehicle arriving
      events.push({ time: effectiveStart, delta: 1 });
      // Delta: -1 vehicle departing
      events.push({ time: effectiveEnd, delta: -1 });
    }
  }

  if (events.length === 0) {
    return 0;
  }

  // Sort events chronologically.
  // CRITICAL TIE-BREAKER: If two events happen at the exact same timestamp (e.g. 12:00:00),
  // departures (delta = -1) MUST be processed before arrivals (delta = +1).
  // This correctly ensures a car leaving at 12:00 frees its space for a car arriving at 12:00.
  events.sort((a, b) => {
    if (a.time !== b.time) {
      return a.time - b.time;
    }
    return a.delta - b.delta; // -1 comes before +1
  });

  let currentOccupancy = 0;
  let peakOccupancy = 0;

  for (const event of events) {
    currentOccupancy += event.delta;
    if (currentOccupancy > peakOccupancy) {
      peakOccupancy = currentOccupancy;
    }
  }

  return peakOccupancy;
}

module.exports = {
  calculatePeakOccupancy
};
