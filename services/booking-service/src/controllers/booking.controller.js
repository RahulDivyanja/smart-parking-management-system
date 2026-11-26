const bookingService = require('../services/booking.service');
const { ApiResponse } = require('../utils/api-response');

class BookingController {
  /**
   * Create a new parking reservation
   * POST /api/v1/bookings
   */
  async createBooking(req, res, next) {
    try {
      const booking = await bookingService.createBooking(req.body);
      return ApiResponse.success(res, 201, 'Booking reservation created successfully in PENDING status.', booking);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Check parking facility availability for a time interval
   * GET /api/v1/bookings/availability
   */
  async checkAvailability(req, res, next) {
    try {
      const { facilityId, startTime, endTime } = req.query;
      const availability = await bookingService.checkAvailability(facilityId, startTime, endTime);
      return ApiResponse.success(res, 200, 'Availability checked successfully.', availability);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get booking details by ID (UUID)
   * GET /api/v1/bookings/:id
   */
  async getBookingById(req, res, next) {
    try {
      const booking = await bookingService.getBookingById(req.params.id);
      return ApiResponse.success(res, 200, 'Booking retrieved successfully.', booking);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get booking details by unique reference code
   * GET /api/v1/bookings/reference/:reference
   */
  async getBookingByReference(req, res, next) {
    try {
      const booking = await bookingService.getBookingByReference(req.params.reference);
      return ApiResponse.success(res, 200, 'Booking retrieved successfully.', booking);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get user booking history
   * GET /api/v1/bookings/user/:userId
   */
  async getUserBookings(req, res, next) {
    try {
      const { userId } = req.params;
      const { status } = req.query;
      const bookings = await bookingService.getUserBookings(userId, status);
      return ApiResponse.success(res, 200, `Retrieved ${bookings.length} bookings for user.`, bookings);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Cancel an existing booking
   * PATCH /api/v1/bookings/:id/cancel
   */
  async cancelBooking(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};
      const booking = await bookingService.cancelBooking(id, reason);
      return ApiResponse.success(res, 200, 'Booking reservation cancelled successfully.', booking);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update booking status (e.g., CONFIRMED, COMPLETED, EXPIRED)
   * PATCH /api/v1/bookings/:id/status
   */
  async updateBookingStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const booking = await bookingService.updateBookingStatus(id, status);
      return ApiResponse.success(res, 200, `Booking status updated to '${booking.status}'.`, booking);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new BookingController();
