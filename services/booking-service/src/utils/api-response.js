/**
 * Standard API Response envelope
 */
class ApiResponse {
  /**
   * Success response
   * @param {object} res Express response object
   * @param {number} statusCode HTTP Status code
   * @param {string} message Human readable message
   * @param {any} data Response payload
   */
  static success(res, statusCode = 200, message = 'Success', data = null) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Error response
   * @param {object} res Express response object
   * @param {number} statusCode HTTP Status code
   * @param {string} message Error message
   * @param {any} errors Specific validation or error details
   */
  static error(res, statusCode = 500, message = 'Internal Server Error', errors = null) {
    return res.status(statusCode).json({
      success: false,
      message,
      errors,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Custom application error with HTTP status code
 */
class AppError extends Error {
  constructor(statusCode, message, errors = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = {
  ApiResponse,
  AppError
};
