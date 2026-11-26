const { describe, it } = require('node:test');
const assert = require('node:assert');

const { RecipientResolverService } = require('../../src/services/recipient-resolver.service');

describe('Recipient Resolver Service Unit Tests', () => {
  it('should use directly supplied recipientEmail without calling User Service', async () => {
    let userServiceCalled = false;
    const mockClient = {
      getUserById: async () => {
        userServiceCalled = true;
        return { success: true };
      }
    };

    const resolver = new RecipientResolverService({ userServiceClient: mockClient });
    const result = await resolver.resolveRecipient({
      recipientEmail: 'direct@example.com',
      customerName: 'Direct User',
      userId: 'user-001'
    });

    assert.strictEqual(result.resolved, true);
    assert.strictEqual(result.email, 'direct@example.com');
    assert.strictEqual(result.customerName, 'Direct User');
    assert.strictEqual(result.source, 'PAYLOAD');
    assert.strictEqual(userServiceCalled, false, 'User Service should not be called when payload provides valid email');
  });

  it('should lookup recipient using userId when recipientEmail is omitted', async () => {
    const mockClient = {
      getUserById: async (id) => {
        assert.strictEqual(id, 'user-002');
        return {
          success: true,
          data: {
            userId: 'user-002',
            email: 'lookedup@example.com',
            customerName: 'Lookedup User'
          }
        };
      }
    };

    const resolver = new RecipientResolverService({ userServiceClient: mockClient });
    const result = await resolver.resolveRecipient({
      userId: 'user-002'
    });

    assert.strictEqual(result.resolved, true);
    assert.strictEqual(result.email, 'lookedup@example.com');
    assert.strictEqual(result.customerName, 'Lookedup User');
    assert.strictEqual(result.source, 'USER_SERVICE');
  });

  it('should return non-retryable failure when user is not found (404)', async () => {
    const mockClient = {
      getUserById: async () => ({
        success: false,
        notFound: true,
        retryable: false,
        error: 'User not found in User Service'
      })
    };

    const resolver = new RecipientResolverService({ userServiceClient: mockClient });
    const result = await resolver.resolveRecipient({
      userId: 'missing-user'
    });

    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.notFound, true);
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(result.email, undefined);
  });

  it('should return retryable failure when User Service is down (5xx / network error)', async () => {
    const mockClient = {
      getUserById: async () => ({
        success: false,
        notFound: false,
        retryable: true,
        error: 'Connection refused'
      })
    };

    const resolver = new RecipientResolverService({ userServiceClient: mockClient });
    const result = await resolver.resolveRecipient({
      userId: 'user-network-down'
    });

    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.notFound, false);
    assert.strictEqual(result.retryable, true);
  });

  it('should fail when neither recipientEmail nor userId is provided', async () => {
    const resolver = new RecipientResolverService();
    const result = await resolver.resolveRecipient({});

    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.retryable, false);
    assert.ok(result.error.includes('neither valid recipientEmail nor userId'));
  });
});
