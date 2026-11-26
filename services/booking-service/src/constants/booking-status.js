/**
 * Booking Status Constants and State Transition Rules
 */
const BOOKING_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED'
});

/**
 * Valid state transitions table:
 * Current Status -> Set of allowed Next Statuses
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [BOOKING_STATUS.PENDING]: new Set([
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.EXPIRED
  ]),
  [BOOKING_STATUS.CONFIRMED]: new Set([
    BOOKING_STATUS.COMPLETED,
    BOOKING_STATUS.CANCELLED
  ]),
  // Terminal states - no transitions allowed
  [BOOKING_STATUS.CANCELLED]: new Set(),
  [BOOKING_STATUS.COMPLETED]: new Set(),
  [BOOKING_STATUS.EXPIRED]: new Set()
});

/**
 * Check if a state transition is valid
 * @param {string} currentStatus
 * @param {string} nextStatus
 * @returns {boolean}
 */
function isValidTransition(currentStatus, nextStatus) {
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.has(nextStatus);
}

module.exports = {
  BOOKING_STATUS,
  ALLOWED_TRANSITIONS,
  isValidTransition
};
