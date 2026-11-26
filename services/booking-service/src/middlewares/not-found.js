const { ApiResponse } = require('../utils/api-response');

/**
 * 404 Route Not Found Middleware
 */
function notFoundHandler(req, res) {
  return ApiResponse.error(
    res,
    404,
    `Route not found: ${req.method} ${req.originalUrl}`
  );
}

module.exports = notFoundHandler;
