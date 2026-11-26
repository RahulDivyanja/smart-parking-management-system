const AppDataSource = require('../config/data-source');
const eventPublisher = require('../events/booking-event.publisher');
const { BOOKING_STATUS } = require('../constants/booking-status');
const config = require('../config/env');

/**
 * Expiration Scheduler Service
 *
 * Background sweeper using native Node.js timers (setInterval)
 * to periodically scan and expire overdue PENDING reservations.
 *
 * Uses SQL Server UTC time (SYSUTCDATETIME()) for atomic database updates
 * and dispatches event notifications only for successfully transitioned records.
 */
class ExpirationSchedulerService {
  constructor(dataSource = null, publisher = null) {
    this.dataSource = dataSource || AppDataSource;
    this.publisher = publisher || eventPublisher;
    this.timer = null;
    this._isProcessing = false;
    this._intervalMs = 60000; // Default 60 seconds
  }

  get isRunning() {
    return this.timer !== null;
  }

  get isProcessing() {
    return this._isProcessing;
  }

  /**
   * Start the background scheduler
   * @param {number} [intervalMs=60000] Interval in milliseconds between sweeps
   */
  start(intervalMs = 60000) {
    if (this.isRunning) {
      console.warn('[ExpirationScheduler] Scheduler is already running.');
      return;
    }

    this._intervalMs = intervalMs;
    console.log(`[ExpirationScheduler] Starting background sweeper (interval: ${this._intervalMs / 1000}s)...`);

    this.timer = setInterval(async () => {
      await this.sweep();
    }, this._intervalMs);

    // Optional: unref timer so it does not prevent Node process termination during tests
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stop the background scheduler cleanly
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[ExpirationScheduler] Scheduler stopped.');
    }
  }

  /**
   * Execute a single sweep cycle with overlap prevention and error handling
   * @returns {Promise<number>} Number of expired bookings updated
   */
  async sweep() {
    // Prevent overlapping executions if previous sweep is still in progress
    if (this._isProcessing) {
      console.warn('[ExpirationScheduler] Previous sweep is still in progress. Skipping this cycle.');
      return 0;
    }

    // Ensure database connection is ready
    if (!this.dataSource || !this.dataSource.isInitialized) {
      return 0;
    }

    this._isProcessing = true;

    try {
      const expiredBookings = await this.expireOverduePendingBookings();
      if (expiredBookings.length > 0) {
        console.log(`[ExpirationScheduler] Successfully transitioned ${expiredBookings.length} overdue booking(s) to EXPIRED.`);
      }
      return expiredBookings.length;
    } catch (error) {
      // Log error safely without crashing the service
      console.error('[ExpirationScheduler Error] Failed to expire overdue pending bookings:', error.message);
      return 0;
    } finally {
      this._isProcessing = false;
    }
  }

  /**
   * Execute atomic SQL Server query to transition overdue PENDING bookings
   * and publish status change events.
   *
   * @param {number} [holdMinutes] Expiration threshold in minutes
   * @returns {Promise<Array<object>>} List of updated bookings
   */
  async expireOverduePendingBookings(holdMinutes = config.business.pendingHoldMinutes) {
    const minutesThreshold = parseInt(holdMinutes, 10) || 10;

    // Atomic SQL Server query using OUTPUT clause to retrieve exactly the rows updated by this query.
    // If another transaction or lazy check already expired a booking, it won't be returned here.
    const query = `
      UPDATE bookings
      SET status = '${BOOKING_STATUS.EXPIRED}',
          updated_at = SYSUTCDATETIME()
      OUTPUT 
        inserted.id,
        inserted.booking_reference AS bookingReference,
        inserted.user_id AS userId,
        inserted.facility_id AS facilityId,
        inserted.status
      WHERE status = '${BOOKING_STATUS.PENDING}'
        AND created_at < DATEADD(minute, -@0, SYSUTCDATETIME());
    `;

    const updatedRows = await this.dataSource.query(query, [minutesThreshold]);
    const expiredList = Array.isArray(updatedRows) ? updatedRows : [];

    // Publish event notifications ONLY for records actually updated in this run
    for (const booking of expiredList) {
      try {
        await this.publisher.publishBookingStatusChanged(booking, BOOKING_STATUS.PENDING);
      } catch (pubError) {
        console.error(`[ExpirationScheduler] Failed to publish event for booking ${booking.id}:`, pubError.message);
      }
    }

    return expiredList;
  }
}

const schedulerInstance = new ExpirationSchedulerService();
schedulerInstance.ExpirationSchedulerService = ExpirationSchedulerService;

module.exports = schedulerInstance;
