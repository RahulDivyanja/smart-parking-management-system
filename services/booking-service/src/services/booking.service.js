const AppDataSource = require('../config/data-source');
const BookingEntity = require('../entities/booking.entity');
const { BOOKING_STATUS, isValidTransition } = require('../constants/booking-status');
const { calculatePeakOccupancy } = require('../utils/capacity');
const { generateBookingReference } = require('../utils/reference-generator');
const { AppError } = require('../utils/api-response');
const facilityClient = require('../integrations/facility.client');
const eventPublisher = require('../events/booking-event.publisher');
const config = require('../config/env');

class BookingService {
  /**
   * Lazy expiration check: if a PENDING booking has exceeded the hold window,
   * automatically update it to EXPIRED in the database.
   * @param {object} booking
   * @returns {Promise<object>}
   */
  async checkAndApplyLazyExpiration(booking) {
    if (!booking || booking.status !== BOOKING_STATUS.PENDING) {
      return booking;
    }

    const holdMs = config.business.pendingHoldMinutes * 60 * 1000;
    const createdAt = new Date(booking.createdAt).getTime();
    const now = Date.now();

    if (now - createdAt > holdMs) {
      const repo = AppDataSource.getRepository(BookingEntity);
      // Atomic status update: only update if status is still PENDING to avoid duplicate events
      const updateResult = await repo.update(
        { id: booking.id, status: BOOKING_STATUS.PENDING },
        { status: BOOKING_STATUS.EXPIRED, updatedAt: new Date() }
      );

      booking.status = BOOKING_STATUS.EXPIRED;

      // Publish event ONLY if this call was the one that actually performed the transition
      if (updateResult && updateResult.affected > 0) {
        await eventPublisher.publishBookingStatusChanged(booking, BOOKING_STATUS.PENDING);
      }
    }

    return booking;
  }

  /**
   * Create a new parking reservation with capacity check and double booking prevention.
   * Utilizes Microsoft SQL Server sp_getapplock inside a TypeORM transaction.
   *
   * @param {object} dto
   * @param {string} dto.userId
   * @param {string} dto.facilityId
   * @param {string} dto.vehicleRegistrationNumber
   * @param {string|Date} dto.startTime
   * @param {string|Date} dto.endTime
   * @returns {Promise<object>} Created booking entity
   */
  async createBooking({ userId, facilityId, vehicleRegistrationNumber, startTime, endTime }) {
    const start = new Date(startTime);
    const end = new Date(endTime);

    // 1. Basic temporal validation
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError(400, 'Invalid startTime or endTime format. ISO 8601 strings required.');
    }

    if (start >= end) {
      throw new AppError(400, 'Reservation startTime must be strictly before endTime.');
    }

    const now = new Date();
    // Allow small clock skew (2 minutes)
    if (start.getTime() < now.getTime() - 2 * 60 * 1000) {
      throw new AppError(400, 'Reservation startTime cannot be in the past.');
    }

    const durationMs = end.getTime() - start.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    if (durationHours < 0.25) { // 15 minutes minimum
      throw new AppError(400, 'Minimum reservation duration is 15 minutes.');
    }

    // 2. Fetch facility capacity and rate from Parking Facility Service
    const facility = await facilityClient.getFacilityById(facilityId);
    if (!facility || !facility.totalCapacity || facility.totalCapacity <= 0) {
      throw new AppError(400, `Facility '${facilityId}' is invalid or has no registered capacity.`);
    }

    const hourlyRate = facility.hourlyRate || 0;
    const totalAmount = parseFloat((durationHours * hourlyRate).toFixed(2));

    // 3. Concurrency-safe reservation using SQL Server sp_getapplock
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const lockKey = `FacilityLock_${facilityId}`;

      // Acquire exclusive application lock on the facility for this transaction
      const lockResult = await queryRunner.query(
        `DECLARE @res INT;
         EXEC @res = sp_getapplock 
           @Resource = @0, 
           @LockMode = 'Exclusive', 
           @LockOwner = 'Transaction', 
           @LockTimeout = 5000;
         SELECT @res AS lockResult;`,
        [lockKey]
      );

      const resultCode = lockResult && lockResult[0] ? lockResult[0].lockResult : -999;
      // SQL Server sp_getapplock returns:
      // 0 = Lock successfully granted synchronously
      // 1 = Lock granted after waiting
      // < 0 = Timeout, deadlock, or failure
      if (resultCode < 0) {
        throw new AppError(409, 'Unable to acquire facility booking lock within timeout. Please retry.');
      }

      // Query active overlapping bookings for this facility within the transaction.
      // Notice: PENDING bookings older than pendingHoldMinutes are excluded.
      const activeBookings = await queryRunner.query(
        `SELECT start_time AS startTime, end_time AS endTime, status, created_at AS createdAt
         FROM bookings
         WHERE facility_id = @0
           AND (
             status = '${BOOKING_STATUS.CONFIRMED}'
             OR (
               status = '${BOOKING_STATUS.PENDING}' 
               AND created_at >= DATEADD(minute, -@1, SYSUTCDATETIME())
             )
           )
           AND start_time < @2
           AND end_time > @3`,
        [facilityId, config.business.pendingHoldMinutes, end, start]
      );

      // Calculate peak simultaneous occupancy using the sweep-line algorithm
      const peakOccupancy = calculatePeakOccupancy(activeBookings, start, end);

      if (peakOccupancy + 1 > facility.totalCapacity) {
        throw new AppError(
          409,
          `Parking facility is fully booked for the requested period. Peak simultaneous occupancy: ${peakOccupancy}/${facility.totalCapacity}.`
        );
      }

      // Generate unique human-readable booking reference
      const bookingReference = generateBookingReference();

      // Create and persist the new booking in PENDING status
      const bookingRepo = queryRunner.manager.getRepository(BookingEntity);
      const newBooking = bookingRepo.create({
        bookingReference,
        userId,
        facilityId,
        vehicleRegistrationNumber: vehicleRegistrationNumber.trim().toUpperCase(),
        startTime: start,
        endTime: end,
        hourlyRate,
        totalAmount,
        status: BOOKING_STATUS.PENDING
      });

      const savedBooking = await bookingRepo.save(newBooking);

      // Commit transaction (automatically releases sp_getapplock)
      await queryRunner.commitTransaction();

      // Publish asynchronous event
      await eventPublisher.publishBookingCreated(savedBooking);

      return savedBooking;
    } catch (err) {
      // Rollback automatically releases sp_getapplock
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Check parking availability for a specific facility over a time interval
   *
   * @param {string} facilityId
   * @param {string|Date} startTime
   * @param {string|Date} endTime
   * @returns {Promise<object>} Availability details
   */
  async checkAvailability(facilityId, startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError(400, 'Invalid startTime or endTime format.');
    }

    if (start >= end) {
      throw new AppError(400, 'startTime must be strictly before endTime.');
    }

    const facility = await facilityClient.getFacilityById(facilityId);
    if (!facility || !facility.totalCapacity) {
      throw new AppError(404, `Facility '${facilityId}' not found or has no capacity defined.`);
    }

    const repo = AppDataSource.getRepository(BookingEntity);
    const activeBookings = await repo.query(
      `SELECT start_time AS startTime, end_time AS endTime, status, created_at AS createdAt
       FROM bookings
       WHERE facility_id = @0
         AND (
           status = '${BOOKING_STATUS.CONFIRMED}'
           OR (
             status = '${BOOKING_STATUS.PENDING}' 
             AND created_at >= DATEADD(minute, -@1, SYSUTCDATETIME())
           )
         )
         AND start_time < @2
         AND end_time > @3`,
      [facilityId, config.business.pendingHoldMinutes, end, start]
    );

    const peakOccupancy = calculatePeakOccupancy(activeBookings, start, end);
    const availableSpaces = Math.max(0, facility.totalCapacity - peakOccupancy);

    return {
      facilityId,
      facilityName: facility.name,
      totalCapacity: facility.totalCapacity,
      peakOccupancy,
      availableSpaces,
      isAvailable: availableSpaces > 0,
      hourlyRate: facility.hourlyRate,
      queryWindow: {
        startTime: start.toISOString(),
        endTime: end.toISOString()
      }
    };
  }

  /**
   * Get booking details by internal UUID
   * @param {string} id
   * @returns {Promise<object>}
   */
  async getBookingById(id) {
    const repo = AppDataSource.getRepository(BookingEntity);
    const booking = await repo.findOne({ where: { id } });
    if (!booking) {
      throw new AppError(404, `Booking with ID '${id}' not found.`);
    }
    return this.checkAndApplyLazyExpiration(booking);
  }

  /**
   * Get booking details by unique human-readable reference code
   * @param {string} reference
   * @returns {Promise<object>}
   */
  async getBookingByReference(reference) {
    const repo = AppDataSource.getRepository(BookingEntity);
    const booking = await repo.findOne({ where: { bookingReference: reference } });
    if (!booking) {
      throw new AppError(404, `Booking with reference '${reference}' not found.`);
    }
    return this.checkAndApplyLazyExpiration(booking);
  }

  /**
   * Get user booking history with optional status filter
   * @param {string} userId
   * @param {string} [status]
   * @returns {Promise<Array<object>>}
   */
  async getUserBookings(userId, status = null) {
    const repo = AppDataSource.getRepository(BookingEntity);
    const whereClause = { userId };
    if (status) {
      whereClause.status = status.toUpperCase();
    }

    const bookings = await repo.find({
      where: whereClause,
      order: { createdAt: 'DESC' }
    });

    // Check lazy expiration on returned bookings
    return Promise.all(bookings.map(b => this.checkAndApplyLazyExpiration(b)));
  }

  /**
   * Cancel an existing reservation
   * @param {string} id
   * @param {string} reason
   * @returns {Promise<object>}
   */
  async cancelBooking(id, reason = '') {
    const repo = AppDataSource.getRepository(BookingEntity);
    let booking = await repo.findOne({ where: { id } });
    if (!booking) {
      throw new AppError(404, `Booking with ID '${id}' not found.`);
    }

    booking = await this.checkAndApplyLazyExpiration(booking);

    if (!isValidTransition(booking.status, BOOKING_STATUS.CANCELLED)) {
      throw new AppError(
        400,
        `Cannot cancel booking: state transition from '${booking.status}' to '${BOOKING_STATUS.CANCELLED}' is not allowed.`
      );
    }

    const previousStatus = booking.status;
    booking.status = BOOKING_STATUS.CANCELLED;
    const savedBooking = await repo.save(booking);

    await eventPublisher.publishBookingCancelled(savedBooking, reason);
    return savedBooking;
  }

  /**
   * Update booking status (e.g., CONFIRMED, COMPLETED, EXPIRED)
   * Enforces finite state machine transition rules and pending hold duration.
   *
   * @param {string} id
   * @param {string} newStatus
   * @returns {Promise<object>}
   */
  async updateBookingStatus(id, newStatus) {
    const normalizedStatus = (newStatus || '').toUpperCase();
    if (!Object.values(BOOKING_STATUS).includes(normalizedStatus)) {
      throw new AppError(
        400,
        `Invalid status '${newStatus}'. Allowed: ${Object.values(BOOKING_STATUS).join(', ')}`
      );
    }

    const repo = AppDataSource.getRepository(BookingEntity);
    let booking = await repo.findOne({ where: { id } });
    if (!booking) {
      throw new AppError(404, `Booking with ID '${id}' not found.`);
    }

    // Handle pending hold expiration check
    if (booking.status === BOOKING_STATUS.PENDING) {
      const holdMs = config.business.pendingHoldMinutes * 60 * 1000;
      const createdAt = new Date(booking.createdAt).getTime();
      if (Date.now() - createdAt > holdMs) {
        const updateResult = await repo.update(
          { id: booking.id, status: BOOKING_STATUS.PENDING },
          { status: BOOKING_STATUS.EXPIRED, updatedAt: new Date() }
        );

        booking.status = BOOKING_STATUS.EXPIRED;

        if (updateResult && updateResult.affected > 0) {
          await eventPublisher.publishBookingStatusChanged(booking, BOOKING_STATUS.PENDING);
        }

        if (normalizedStatus !== BOOKING_STATUS.EXPIRED) {
          throw new AppError(
            400,
            `Pending booking hold of ${config.business.pendingHoldMinutes} minutes has expired. Booking was marked as EXPIRED.`
          );
        }
        return booking;
      }
    }

    if (!isValidTransition(booking.status, normalizedStatus)) {
      throw new AppError(
        400,
        `Cannot transition booking status from '${booking.status}' to '${normalizedStatus}'.`
      );
    }

    const previousStatus = booking.status;
    booking.status = normalizedStatus;
    const savedBooking = await repo.save(booking);

    await eventPublisher.publishBookingStatusChanged(savedBooking, previousStatus);
    return savedBooking;
  }
}

module.exports = new BookingService();
