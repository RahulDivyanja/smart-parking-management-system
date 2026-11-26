const { AppError } = require('../utils/api-response');

/**
 * Request validation middlewares
 */
class Validator {
  /**
   * Validate reservation creation payload
   */
  static validateCreateBooking(req, res, next) {
    const { userId, facilityId, vehicleRegistrationNumber, startTime, endTime } = req.body;
    const errors = [];

    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      errors.push('userId is required and must be a non-empty string.');
    }

    if (!facilityId || typeof facilityId !== 'string' || facilityId.trim() === '') {
      errors.push('facilityId is required and must be a non-empty string.');
    }

    if (!vehicleRegistrationNumber || typeof vehicleRegistrationNumber !== 'string' || vehicleRegistrationNumber.trim() === '') {
      errors.push('vehicleRegistrationNumber is required and must be a non-empty string.');
    }

    if (!startTime) {
      errors.push('startTime is required (ISO 8601 string).');
    } else if (isNaN(new Date(startTime).getTime())) {
      errors.push('startTime must be a valid ISO 8601 date.');
    }

    if (!endTime) {
      errors.push('endTime is required (ISO 8601 string).');
    } else if (isNaN(new Date(endTime).getTime())) {
      errors.push('endTime must be a valid ISO 8601 date.');
    }

    if (errors.length > 0) {
      return next(new AppError(400, 'Validation failed', errors));
    }

    next();
  }

  /**
   * Validate availability check query params
   */
  static validateAvailabilityQuery(req, res, next) {
    const { facilityId, startTime, endTime } = req.query;
    const errors = [];

    if (!facilityId || typeof facilityId !== 'string' || facilityId.trim() === '') {
      errors.push('Query parameter facilityId is required.');
    }

    if (!startTime || isNaN(new Date(startTime).getTime())) {
      errors.push('Query parameter startTime must be a valid ISO 8601 date.');
    }

    if (!endTime || isNaN(new Date(endTime).getTime())) {
      errors.push('Query parameter endTime must be a valid ISO 8601 date.');
    }

    if (errors.length > 0) {
      return next(new AppError(400, 'Validation failed', errors));
    }

    next();
  }

  /**
   * Validate status update payload
   */
  static validateStatusUpdate(req, res, next) {
    const { status } = req.body;
    if (!status || typeof status !== 'string' || status.trim() === '') {
      return next(new AppError(400, 'status field is required in request body.'));
    }
    next();
  }
}

module.exports = Validator;
