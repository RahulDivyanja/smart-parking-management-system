const { ApiResponse } = require('../utils/api-response');

/**
 * Global Centralized Error Handling Middleware
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  const errors = err.errors || null;

  if (statusCode >= 500) {
    console.error(`[UnhandledError] ${req.method} ${req.originalUrl}:`, err);
  } else {
    console.warn(`[ClientError ${statusCode}] ${req.method} ${req.originalUrl}: ${message}`);
  }

  return ApiResponse.error(res, statusCode, message, errors);
}

module.exports = errorHandler;
