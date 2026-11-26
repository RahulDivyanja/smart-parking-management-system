const crypto = require('crypto');

/**
 * Generate a unique, human-friendly booking reference code
 * Format: BK-YYYYMMDD-XXXX (e.g., BK-20261120-A7F9)
 * @returns {string}
 */
function generateBookingReference() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const dateSegment = `${year}${month}${day}`;

  // 4 cryptographically secure random alphanumeric uppercase characters
  const randomSegment = crypto.randomBytes(3).toString('hex').slice(0, 4).toUpperCase();

  return `BK-${dateSegment}-${randomSegment}`;
}

module.exports = {
  generateBookingReference
};
