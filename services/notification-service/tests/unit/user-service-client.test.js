const { describe, it } = require('node:test');
const assert = require('node:assert');

const { UserServiceClient } = require('../../src/clients/user-service.client');

describe('User Service Client Unit Tests', () => {
  it('should validate missing or empty userId', async () => {
    const client = new UserServiceClient();

    const noId = await client.getUserById('');
    assert.strictEqual(noId.success, false);
    assert.ok(noId.error.includes('userId'));

    const nullId = await client.getUserById(null);
    assert.strictEqual(nullId.success, false);
  });

  it('should successfully lookup user, extract email, and construct customerName', async () => {
    const mockHttpClient = {
      get: async (url) => {
        assert.ok(url.includes('user-123'));
        return {
          status: 200,
          data: {
            success: true,
            data: {
              id: 'user-123',
              email: 'Alice.Smith@example.com',
              firstName: 'Alice',
              lastName: 'Smith'
            }
          }
        };
      }
    };

    const client = new UserServiceClient({ httpClient: mockHttpClient });
    const result = await client.getUserById('user-123');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.userId, 'user-123');
    assert.strictEqual(result.data.email, 'alice.smith@example.com');
    assert.strictEqual(result.data.customerName, 'Alice Smith');
  });

  it('should support customerName with only firstName or only lastName', async () => {
    const mockHttpClient = {
      get: async () => ({
        status: 200,
        data: {
          success: true,
          data: {
            id: 'user-456',
            email: 'bob@example.com',
            firstName: 'Bob'
          }
        }
      })
    };

    const client = new UserServiceClient({ httpClient: mockHttpClient });
    const result = await client.getUserById('user-456');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.customerName, 'Bob');
  });

  it('should return undefined customerName when both names are absent without inventing identity', async () => {
    const mockHttpClient = {
      get: async () => ({
        status: 200,
        data: {
          success: true,
          data: {
            id: 'user-789',
            email: 'nameless@example.com'
          }
        }
      })
    };

    const client = new UserServiceClient({ httpClient: mockHttpClient });
    const result = await client.getUserById('user-789');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.customerName, undefined);
  });

  it('should reject invalid or missing email address in User Service response', async () => {
    const mockHttpClient = {
      get: async () => ({
        status: 200,
        data: {
          success: true,
          data: {
            id: 'user-invalid',
            email: 'not-an-email'
          }
        }
      })
    };

    const client = new UserServiceClient({ httpClient: mockHttpClient });
    const result = await client.getUserById('user-invalid');

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('invalid or missing email'));
  });

  it('should handle HTTP 404 as non-retryable user not found condition', async () => {
    const mockHttpClient = {
      get: async () => {
        const error = new Error('Request failed with status code 404');
        error.response = { status: 404, data: { message: 'User not found' } };
        throw error;
      }
    };

    const client = new UserServiceClient({ httpClient: mockHttpClient });
    const result = await client.getUserById('missing-user-999');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.notFound, true);
    assert.strictEqual(result.retryable, false);
    assert.ok(result.error.includes('User not found'));
  });

  it('should handle HTTP 500 as retryable server error', async () => {
    const mockHttpClient = {
      get: async () => {
        const error = new Error('Request failed with status code 500');
        error.response = { status: 500, data: { message: 'Database connection failed' } };
        throw error;
      }
    };

    const client = new UserServiceClient({ httpClient: mockHttpClient });
    const result = await client.getUserById('user-500');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.notFound, false);
    assert.strictEqual(result.retryable, true);
    assert.ok(result.error.includes('500'));
  });

  it('should handle network timeout as retryable failure', async () => {
    const mockHttpClient = {
      get: async () => {
        const error = new Error('timeout of 5000ms exceeded');
        error.code = 'ECONNABORTED';
        throw error;
      }
    };

    const client = new UserServiceClient({ httpClient: mockHttpClient });
    const result = await client.getUserById('user-timeout');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.retryable, true);
    assert.ok(result.error.includes('NETWORK_ERROR'));
  });
});
