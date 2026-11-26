const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/booking.controller');
const Validator = require('../middlewares/validator');

/**
 * @openapi
 * /api/v1/bookings:
 *   post:
 *     summary: Create a new parking reservation
 *     description: Reserves parking capacity within the facility for a designated time window. Prevents overbooking using SQL Server sp_getapplock transactions and sweep-line simultaneous occupancy validation. Creates booking in PENDING status with a 10-minute hold window.
 *     tags:
 *       - Bookings
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBookingRequest'
 *     responses:
 *       201:
 *         description: Booking successfully reserved in PENDING status.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardSuccessResponse'
 *       400:
 *         description: Validation error or invalid time parameters.
 *       409:
 *         description: Capacity exceeded or lock acquisition timeout.
 */
router.post(
  '/',
  Validator.validateCreateBooking,
  bookingController.createBooking.bind(bookingController)
);

/**
 * @openapi
 * /api/v1/bookings/availability:
 *   get:
 *     summary: Check facility parking availability
 *     description: Computes peak simultaneous occupancy across the requested interval using the discrete event sweep-line algorithm and returns remaining capacity.
 *     tags:
 *       - Availability
 *     parameters:
 *       - in: query
 *         name: facilityId
 *         required: true
 *         schema:
 *           type: string
 *         example: FAC-WEST-01
 *       - in: query
 *         name: startTime
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         example: '2026-11-20T17:00:00.000Z'
 *       - in: query
 *         name: endTime
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         example: '2026-11-20T20:00:00.000Z'
 *     responses:
 *       200:
 *         description: Facility availability details returned.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AvailabilityResponse'
 *       400:
 *         description: Invalid query parameters.
 */
router.get(
  '/availability',
  Validator.validateAvailabilityQuery,
  bookingController.checkAvailability.bind(bookingController)
);

/**
 * @openapi
 * /api/v1/bookings/reference/{reference}:
 *   get:
 *     summary: Retrieve booking by unique reference code
 *     tags:
 *       - Bookings
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         example: BK-20261120-7A9B
 *     responses:
 *       200:
 *         description: Booking details retrieved.
 *       404:
 *         description: Booking reference not found.
 */
router.get(
  '/reference/:reference',
  bookingController.getBookingByReference.bind(bookingController)
);

/**
 * @openapi
 * /api/v1/bookings/user/{userId}:
 *   get:
 *     summary: Get reservation history for a specific user
 *     tags:
 *       - Bookings
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         example: USR-1001
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [PENDING, CONFIRMED, CANCELLED, COMPLETED, EXPIRED]
 *     responses:
 *       200:
 *         description: List of user reservations.
 */
router.get(
  '/user/:userId',
  bookingController.getUserBookings.bind(bookingController)
);

/**
 * @openapi
 * /api/v1/bookings/{id}:
 *   get:
 *     summary: Get booking by internal UUID
 *     tags:
 *       - Bookings
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Booking retrieved successfully.
 *       404:
 *         description: Booking not found.
 */
router.get(
  '/:id',
  bookingController.getBookingById.bind(bookingController)
);

/**
 * @openapi
 * /api/v1/bookings/{id}/cancel:
 *   patch:
 *     summary: Cancel a reservation
 *     description: Transitions booking to CANCELLED state and dispatches cancellation event. Validates that current state permits cancellation.
 *     tags:
 *       - Bookings
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CancelBookingRequest'
 *     responses:
 *       200:
 *         description: Reservation cancelled.
 *       400:
 *         description: State transition not allowed.
 *       404:
 *         description: Booking not found.
 */
router.patch(
  '/:id/cancel',
  bookingController.cancelBooking.bind(bookingController)
);

/**
 * @openapi
 * /api/v1/bookings/{id}/status:
 *   patch:
 *     summary: Update booking status
 *     description: Advances booking lifecycle (e.g., CONFIRMED upon payment, COMPLETED after checkout, EXPIRED). Validates finite state machine rules and 10-minute hold limits.
 *     tags:
 *       - Bookings
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateStatusRequest'
 *     responses:
 *       200:
 *         description: Status updated.
 *       400:
 *         description: Invalid status or illegal transition.
 *       404:
 *         description: Booking not found.
 */
router.patch(
  '/:id/status',
  Validator.validateStatusUpdate,
  bookingController.updateBookingStatus.bind(bookingController)
);

module.exports = router;
