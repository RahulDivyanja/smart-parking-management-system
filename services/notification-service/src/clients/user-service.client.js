const axios = require('axios');
const config = require('../config/env');

/**
 * User Service REST API Client
 * 
 * PROVISIONAL CONTRACT DISCLAIMER:
 * The actual User Service (Microservice 01) is not present in this workspace.
 * This client communicates based on a provisional API agreement:
 * 
 * Method: GET
 * URL: ${USER_SERVICE_URL}${USER_SERVICE_USER_ENDPOINT} (default: http://localhost:3001/api/v1/users/:userId)
 * Timeout: ${USER_SERVICE_TIMEOUT} (default: 5000ms)
 * 
 * Assumed Successful Response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "user-uuid",
 *     "email": "customer@example.com",
 *     "firstName": "John",
 *     "lastName": "Doe"
 *   }
 * }
 * 
 * This provisional contract must be re-verified once the official User Service
 * OpenAPI specification is released.
 */
class UserServiceClient {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] - User Service base URL
   * @param {string} [options.endpointTemplate] - URL path template with :userId placeholder
   * @param {number} [options.timeout] - Request timeout in ms
   * @param {import('axios').AxiosInstance} [options.httpClient] - Injected Axios client (for mocking/tests)
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || config.services.userServiceUrl;
    this.endpointTemplate = options.endpointTemplate || config.services.userServiceEndpoint;
    this.timeout = options.timeout || config.services.userServiceTimeout;

    this.httpClient = options.httpClient || axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Accept': 'application/json',
        'X-Service-Name': 'parkease-notification-service'
      }
    });
  }

  /**
   * Basic RFC 5322 compliant email validator regex
   * @param {string} email
   * @returns {boolean}
   */
  isValidEmail(email) {
    if (typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Looks up user profile by userId
   * @param {string} userId - Target user identifier
   * @returns {Promise<{
   *   success: boolean,
   *   data?: { userId: string, email: string, customerName?: string },
   *   notFound?: boolean,
   *   retryable?: boolean,
   *   error?: string
   * }>}
   */
  async getUserById(userId) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return {
        success: false,
        notFound: false,
        retryable: false,
        error: 'Invalid or missing userId parameter'
      };
    }

    const trimmedUserId = userId.trim();
    const endpoint = this.endpointTemplate.replace(':userId', encodeURIComponent(trimmedUserId));

    try {
      const response = await this.httpClient.get(endpoint);

      if (!response.data || !response.data.data) {
        return {
          success: false,
          notFound: false,
          retryable: false,
          error: 'User Service returned invalid response format: missing data property'
        };
      }

      const userData = response.data.data;
      const rawEmail = userData.email;

      if (!rawEmail || !this.isValidEmail(rawEmail)) {
        return {
          success: false,
          notFound: false,
          retryable: false,
          error: `User Service returned invalid or missing email address for userId: ${trimmedUserId}`
        };
      }

      // Build customerName from firstName and lastName without inventing data
      const nameParts = [userData.firstName, userData.lastName]
        .map(part => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean);
      const customerName = nameParts.length > 0 ? nameParts.join(' ') : undefined;

      return {
        success: true,
        data: {
          userId: userData.id || trimmedUserId,
          email: rawEmail.trim().toLowerCase(),
          customerName
        }
      };
    } catch (error) {
      const status = error.response ? error.response.status : null;

      // HTTP 404: Definitive "User Not Found" - Non-retryable
      if (status === 404) {
        return {
          success: false,
          notFound: true,
          retryable: false,
          error: `User not found in User Service for userId: ${trimmedUserId}`
        };
      }

      // HTTP 5xx, 429, Network timeouts, Connection Refusal: Retryable transient errors
      const isRetryable = !status || status >= 500 || status === 429;
      const message = error.response?.data?.message || error.message || 'Failed to communicate with User Service';

      return {
        success: false,
        notFound: false,
        retryable: isRetryable,
        error: `User Service error (${status || 'NETWORK_ERROR'}): ${message}`,
        status
      };
    }
  }
}

const defaultUserServiceClient = new UserServiceClient();
defaultUserServiceClient.UserServiceClient = UserServiceClient;

module.exports = defaultUserServiceClient;
