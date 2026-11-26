const defaultUserServiceClient = require('../clients/user-service.client');

/**
 * Recipient Resolution Service
 * Determines the target email address and customer name.
 * 
 * Rules:
 * 1. If trusted recipientEmail is already provided in the event payload, use it directly.
 * 2. If recipientEmail is absent, query UserServiceClient using userId.
 * 3. Never invent placeholder or fake fallback emails (e.g. userId@parkease.local).
 * 4. Distinguish between permanent 404 (user not found) and transient network/5xx failures.
 */
class RecipientResolverService {
  /**
   * @param {object} [options]
   * @param {object} [options.userServiceClient] - Injected UserServiceClient
   */
  constructor(options = {}) {
    this.userServiceClient = options.userServiceClient || defaultUserServiceClient;
  }

  /**
   * Validates email format strictly
   * @param {string} email
   * @returns {boolean}
   */
  isValidEmail(email) {
    if (typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Resolves recipient email address and customer name
   * @param {object} params
   * @param {string} [params.recipientEmail] - Direct email if already present in payload
   * @param {string} [params.customerName] - Direct customer name if present in payload
   * @param {string} [params.userId] - User UUID to lookup if email not supplied
   * @returns {Promise<{
   *   resolved: boolean,
   *   email?: string,
   *   customerName?: string,
   *   source?: 'PAYLOAD' | 'USER_SERVICE',
   *   notFound?: boolean,
   *   retryable?: boolean,
   *   error?: string
   * }>}
   */
  async resolveRecipient({ recipientEmail, customerName, userId }) {
    // 1. Direct recipientEmail supplied in trusted payload
    if (recipientEmail && this.isValidEmail(recipientEmail)) {
      return {
        resolved: true,
        email: recipientEmail.trim().toLowerCase(),
        customerName: customerName ? customerName.trim() : undefined,
        source: 'PAYLOAD'
      };
    }

    // 2. No recipientEmail provided: Must resolve via userId
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return {
        resolved: false,
        notFound: false,
        retryable: false,
        error: 'Cannot resolve recipient: neither valid recipientEmail nor userId was provided'
      };
    }

    // 3. Query User Service
    const lookupResult = await this.userServiceClient.getUserById(userId);

    if (lookupResult.success && lookupResult.data) {
      return {
        resolved: true,
        email: lookupResult.data.email,
        customerName: customerName || lookupResult.data.customerName,
        source: 'USER_SERVICE'
      };
    }

    // 4. Resolution Failure - User Not Found (Permanent error, do not retry)
    if (lookupResult.notFound) {
      return {
        resolved: false,
        notFound: true,
        retryable: false,
        error: lookupResult.error || `User not found for userId: ${userId}`
      };
    }

    // 5. Resolution Failure - Transient / Network / 5xx error (Retryable)
    return {
      resolved: false,
      notFound: false,
      retryable: lookupResult.retryable !== false,
      error: lookupResult.error || 'User Service lookup failed'
    };
  }
}

const defaultRecipientResolver = new RecipientResolverService();
defaultRecipientResolver.RecipientResolverService = RecipientResolverService;

module.exports = defaultRecipientResolver;
