const { describe, it } = require('node:test');
const assert = require('node:assert');

const { NotificationService } = require('../../src/services/notification.service');
const { DELIVERY_STATUS } = require('../../src/constants/delivery-status');

describe('Notification Processing Service Unit Tests', () => {
  // Helper to construct in-memory mock repository
  const createMockRepo = () => {
    const store = new Map();
    let idCounter = 1;

    return {
      create: (entity) => ({ id: `uuid-${idCounter++}`, ...entity }),
      save: async (entity) => {
        const id = entity.id || `uuid-${idCounter++}`;
        const record = { ...entity, id };
        store.set(id, record);
        return record;
      },
      findOneBy: async (criteria) => {
        for (const item of store.values()) {
          let match = true;
          for (const key of Object.keys(criteria)) {
            if (item[key] !== criteria[key]) match = false;
          }
          if (match) return item;
        }
        return null;
      },
      countBy: async (criteria) => {
        let count = 0;
        for (const item of store.values()) {
          let match = true;
          for (const key of Object.keys(criteria)) {
            if (item[key] !== criteria[key]) match = false;
          }
          if (match) count++;
        }
        return count;
      },
      findBy: async (criteria) => {
        const results = [];
        for (const item of store.values()) {
          let match = true;
          for (const key of Object.keys(criteria)) {
            if (item[key] !== criteria[key]) match = false;
          }
          if (match) results.push(item);
        }
        return results;
      },
      _store: store
    };
  };

  it('should create notification, render template, send SMTP, and record success log', async () => {
    const notificationRepo = createMockRepo();
    const deliveryLogRepo = createMockRepo();

    const mockDataSource = {
      getRepository: (entityName) => {
        if (entityName === 'Notification') return notificationRepo;
        if (entityName === 'NotificationDeliveryLog') return deliveryLogRepo;
        throw new Error(`Unknown entity: ${entityName}`);
      }
    };

    const mockEmailService = {
      sendEmail: async () => ({
        success: true,
        messageId: '<test-message-id-123@gmail.com>',
        response: '250 2.0.0 OK'
      })
    };

    const mockTemplateService = {
      render: () => '<html><body>Rendered Confirmed Email</body></html>'
    };

    const service = new NotificationService({
      dataSource: mockDataSource,
      emailService: mockEmailService,
      templateService: mockTemplateService
    });

    const result = await service.processNotification({
      eventId: 'evt-111',
      idempotencyKey: 'IDEMP-BOOKING-CONF-1',
      userId: 'user-001',
      recipientEmail: 'client@example.com',
      notificationType: 'BOOKING_CONFIRMED',
      subject: 'Booking Confirmed',
      templateName: 'booking-confirmed',
      templateData: { bookingReference: 'BK-100' }
    });

    assert.strictEqual(result.delivered, true);
    assert.strictEqual(result.notification.deliveryStatus, DELIVERY_STATUS.SENT);
    assert.ok(result.notification.sentAt);

    // Verify delivery log recorded
    assert.strictEqual(result.deliveryLog.deliveryStatus, DELIVERY_STATUS.SENT);
    assert.strictEqual(result.deliveryLog.providerMessageId, '<test-message-id-123@gmail.com>');
    assert.strictEqual(result.deliveryLog.attemptNumber, 1);
  });

  it('should safely handle SMTP failure without losing the notification record', async () => {
    const notificationRepo = createMockRepo();
    const deliveryLogRepo = createMockRepo();

    const mockDataSource = {
      getRepository: (entityName) => {
        if (entityName === 'Notification') return notificationRepo;
        if (entityName === 'NotificationDeliveryLog') return deliveryLogRepo;
        throw new Error(`Unknown entity: ${entityName}`);
      }
    };

    const mockEmailService = {
      sendEmail: async () => ({
        success: false,
        error: '550 Recipient rejected',
        code: 'EENVELOPE'
      })
    };

    const mockTemplateService = {
      render: () => '<html><body>Rendered Email</body></html>'
    };

    const service = new NotificationService({
      dataSource: mockDataSource,
      emailService: mockEmailService,
      templateService: mockTemplateService
    });

    const result = await service.processNotification({
      recipientEmail: 'bad-email@example.com',
      notificationType: 'BOOKING_CREATED',
      subject: 'Reservation Created',
      templateName: 'booking-created'
    });

    assert.strictEqual(result.delivered, false);
    assert.strictEqual(result.notification.deliveryStatus, DELIVERY_STATUS.FAILED);
    assert.strictEqual(result.notification.sentAt, undefined);

    // Verify delivery log recorded failure details
    assert.strictEqual(result.deliveryLog.deliveryStatus, DELIVERY_STATUS.FAILED);
    assert.ok(result.deliveryLog.errorMessage.includes('550 Recipient rejected'));

    // Notification record is preserved in the database
    const savedInDb = await notificationRepo.findOneBy({ id: result.notification.id });
    assert.ok(savedInDb);
    assert.strictEqual(savedInDb.deliveryStatus, DELIVERY_STATUS.FAILED);
  });

  it('should prevent duplicate processing when idempotencyKey already exists', async () => {
    const notificationRepo = createMockRepo();
    const deliveryLogRepo = createMockRepo();

    // Pre-populate with existing sent notification
    await notificationRepo.save({
      id: 'existing-uuid',
      idempotencyKey: 'IDEMP-EXISTS',
      recipientEmail: 'driver@example.com',
      notificationType: 'BOOKING_CREATED',
      deliveryStatus: DELIVERY_STATUS.SENT
    });

    const mockDataSource = {
      getRepository: (entityName) => {
        if (entityName === 'Notification') return notificationRepo;
        if (entityName === 'NotificationDeliveryLog') return deliveryLogRepo;
      }
    };

    let emailSentCount = 0;
    const mockEmailService = {
      sendEmail: async () => {
        emailSentCount++;
        return { success: true };
      }
    };

    const service = new NotificationService({
      dataSource: mockDataSource,
      emailService: mockEmailService
    });

    const result = await service.processNotification({
      idempotencyKey: 'IDEMP-EXISTS',
      recipientEmail: 'driver@example.com',
      notificationType: 'BOOKING_CREATED',
      subject: 'Duplicate Test',
      templateName: 'booking-created'
    });

    assert.strictEqual(result.isDuplicate, true);
    assert.strictEqual(result.delivered, true);
    assert.strictEqual(emailSentCount, 0, 'No email should be dispatched for duplicate key');
  });

  it('should resolve recipient via User Service when recipientEmail is not in payload and dispatch email', async () => {
    const notificationRepo = createMockRepo();
    const deliveryLogRepo = createMockRepo();

    const mockDataSource = {
      getRepository: (entityName) => {
        if (entityName === 'Notification') return notificationRepo;
        if (entityName === 'NotificationDeliveryLog') return deliveryLogRepo;
      }
    };

    let sentToEmail = null;
    const mockEmailService = {
      sendEmail: async ({ to }) => {
        sentToEmail = to;
        return { success: true, messageId: '<resolved-msg-1@gmail.com>' };
      }
    };

    const mockRecipientResolver = {
      resolveRecipient: async ({ userId }) => ({
        resolved: true,
        email: 'resolved-user@example.com',
        customerName: 'Resolved Driver',
        source: 'USER_SERVICE'
      })
    };

    const service = new NotificationService({
      dataSource: mockDataSource,
      emailService: mockEmailService,
      recipientResolver: mockRecipientResolver
    });

    const result = await service.processNotification({
      userId: 'user-lookup-1',
      // recipientEmail is intentionally omitted
      notificationType: 'BOOKING_CREATED',
      subject: 'Reservation Created',
      templateName: 'booking-created',
      templateData: { bookingReference: 'BK-RESOLVED' }
    });

    assert.strictEqual(result.delivered, true);
    assert.strictEqual(sentToEmail, 'resolved-user@example.com');
    assert.strictEqual(result.notification.recipientEmail, 'resolved-user@example.com');
    assert.strictEqual(result.notification.deliveryStatus, DELIVERY_STATUS.SENT);
  });

  it('should safely abort and mark FAILED without SMTP dispatch when User is not found (404)', async () => {
    const notificationRepo = createMockRepo();
    const deliveryLogRepo = createMockRepo();

    const mockDataSource = {
      getRepository: (entityName) => {
        if (entityName === 'Notification') return notificationRepo;
        if (entityName === 'NotificationDeliveryLog') return deliveryLogRepo;
      }
    };

    let emailAttemptMade = false;
    const mockEmailService = {
      sendEmail: async () => {
        emailAttemptMade = true;
        return { success: true };
      }
    };

    const mockRecipientResolver = {
      resolveRecipient: async () => ({
        resolved: false,
        notFound: true,
        retryable: false,
        error: 'User not found in User Service for userId: user-not-found'
      })
    };

    const service = new NotificationService({
      dataSource: mockDataSource,
      emailService: mockEmailService,
      recipientResolver: mockRecipientResolver
    });

    const result = await service.processNotification({
      userId: 'user-not-found',
      notificationType: 'BOOKING_CREATED',
      subject: 'Reservation Created',
      templateName: 'booking-created'
    });

    assert.strictEqual(result.delivered, false);
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(emailAttemptMade, false, 'SMTP send must NOT be called when recipient is not found');
    assert.strictEqual(result.notification.deliveryStatus, DELIVERY_STATUS.FAILED);
    assert.strictEqual(result.notification.recipientEmail, 'UNRESOLVED');
    assert.strictEqual(result.deliveryLog.provider, 'USER_SERVICE');
    assert.strictEqual(result.deliveryLog.deliveryStatus, DELIVERY_STATUS.FAILED);
  });

  it('should mark RETRYING without SMTP dispatch when User Service is down (5xx / network error)', async () => {
    const notificationRepo = createMockRepo();
    const deliveryLogRepo = createMockRepo();

    const mockDataSource = {
      getRepository: (entityName) => {
        if (entityName === 'Notification') return notificationRepo;
        if (entityName === 'NotificationDeliveryLog') return deliveryLogRepo;
      }
    };

    let emailAttemptMade = false;
    const mockEmailService = {
      sendEmail: async () => {
        emailAttemptMade = true;
        return { success: true };
      }
    };

    const mockRecipientResolver = {
      resolveRecipient: async () => ({
        resolved: false,
        notFound: false,
        retryable: true,
        error: 'User Service error (503): Service Unavailable'
      })
    };

    const service = new NotificationService({
      dataSource: mockDataSource,
      emailService: mockEmailService,
      recipientResolver: mockRecipientResolver
    });

    const result = await service.processNotification({
      userId: 'user-service-down',
      notificationType: 'BOOKING_CREATED',
      subject: 'Reservation Created',
      templateName: 'booking-created'
    });

    assert.strictEqual(result.delivered, false);
    assert.strictEqual(result.retryable, true);
    assert.strictEqual(emailAttemptMade, false, 'SMTP send must NOT be called when User Service is down');
    assert.strictEqual(result.notification.deliveryStatus, DELIVERY_STATUS.RETRYING);
    assert.strictEqual(result.deliveryLog.provider, 'USER_SERVICE');
    assert.strictEqual(result.deliveryLog.deliveryStatus, DELIVERY_STATUS.RETRYING);
  });

  it('should reprocess an existing RETRYING notification record, update status to SENT, and increment delivery attemptNumber', async () => {
    const notificationRepo = createMockRepo();
    const deliveryLogRepo = createMockRepo();

    // Pre-populate with existing RETRYING record from a previous failed attempt
    const existingNotification = await notificationRepo.save({
      id: 'existing-retrying-uuid',
      idempotencyKey: 'IDEMP-RETRY-SUCCESS',
      userId: 'user-retry-ok',
      recipientEmail: 'UNRESOLVED',
      notificationType: 'BOOKING_CREATED',
      subject: 'Reservation Created',
      templateName: 'booking-created',
      deliveryStatus: DELIVERY_STATUS.RETRYING,
      errorMessage: 'User Service 503 Unavailable'
    });

    await deliveryLogRepo.save({
      notificationId: existingNotification.id,
      attemptNumber: 1,
      provider: 'USER_SERVICE',
      deliveryStatus: DELIVERY_STATUS.RETRYING,
      errorMessage: 'User Service 503 Unavailable'
    });

    const mockDataSource = {
      getRepository: (entityName) => {
        if (entityName === 'Notification') return notificationRepo;
        if (entityName === 'NotificationDeliveryLog') return deliveryLogRepo;
      }
    };

    const mockEmailService = {
      sendEmail: async () => ({
        success: true,
        messageId: '<retry-success-msg@parkease.local>'
      })
    };

    const mockRecipientResolver = {
      resolveRecipient: async () => ({
        resolved: true,
        email: 'recovered-driver@example.com',
        customerName: 'Recovered Driver'
      })
    };

    const service = new NotificationService({
      dataSource: mockDataSource,
      emailService: mockEmailService,
      recipientResolver: mockRecipientResolver
    });

    const result = await service.processNotification({
      idempotencyKey: 'IDEMP-RETRY-SUCCESS',
      userId: 'user-retry-ok',
      notificationType: 'BOOKING_CREATED',
      subject: 'Reservation Created',
      templateName: 'booking-created',
      templateData: { bookingReference: 'BK-RETRY-OK' }
    });

    // Verification: existing record was reused and updated
    assert.strictEqual(result.delivered, true);
    assert.strictEqual(result.notification.id, 'existing-retrying-uuid', 'Must reuse existing notification record');
    assert.strictEqual(result.notification.deliveryStatus, DELIVERY_STATUS.SENT);
    assert.strictEqual(result.notification.recipientEmail, 'recovered-driver@example.com');
    assert.strictEqual(result.deliveryLog.attemptNumber, 2, 'Attempt number must increment to 2');
    assert.strictEqual(result.deliveryLog.deliveryStatus, DELIVERY_STATUS.SENT);

    // Total notifications in DB should still be 1 (no duplicate record created)
    assert.strictEqual(notificationRepo._store.size, 1);
  });

  it('should not reprocess a permanent FAILED notification record', async () => {
    const notificationRepo = createMockRepo();
    const deliveryLogRepo = createMockRepo();

    await notificationRepo.save({
      id: 'existing-failed-uuid',
      idempotencyKey: 'IDEMP-PERM-FAIL',
      userId: 'user-404',
      recipientEmail: 'UNRESOLVED',
      notificationType: 'BOOKING_CREATED',
      deliveryStatus: DELIVERY_STATUS.FAILED,
      errorMessage: 'User 404 Not Found'
    });

    const mockDataSource = {
      getRepository: (entityName) => {
        if (entityName === 'Notification') return notificationRepo;
        if (entityName === 'NotificationDeliveryLog') return deliveryLogRepo;
      }
    };

    let emailSent = false;
    const mockEmailService = {
      sendEmail: async () => { emailSent = true; return { success: true }; }
    };

    const service = new NotificationService({
      dataSource: mockDataSource,
      emailService: mockEmailService
    });

    const result = await service.processNotification({
      idempotencyKey: 'IDEMP-PERM-FAIL',
      userId: 'user-404',
      notificationType: 'BOOKING_CREATED',
      subject: 'Permanent Fail Test',
      templateName: 'booking-created'
    });

    assert.strictEqual(result.isDuplicate, true);
    assert.strictEqual(result.delivered, false);
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(emailSent, false, 'Permanent failure must not trigger email dispatch');
  });

  it('should distinguish simulated delivery from real SMTP in delivery log when email delivery is disabled', async () => {
    const notificationRepo = createMockRepo();
    const deliveryLogRepo = createMockRepo();

    const mockDataSource = {
      getRepository: (entityName) => {
        if (entityName === 'Notification') return notificationRepo;
        if (entityName === 'NotificationDeliveryLog') return deliveryLogRepo;
      }
    };

    const mockEmailService = {
      sendEmail: async () => ({
        success: true,
        simulated: true,
        messageId: '<simulated-disabled-mode@parkease.local>',
        response: '250 Simulated OK (delivery disabled)'
      })
    };

    const service = new NotificationService({
      dataSource: mockDataSource,
      emailService: mockEmailService
    });

    const result = await service.processNotification({
      recipientEmail: 'simulated@example.com',
      notificationType: 'BOOKING_CREATED',
      subject: 'Simulated Email Test',
      templateName: 'booking-created'
    });

    assert.strictEqual(result.delivered, true);
    assert.strictEqual(result.deliveryLog.provider, 'SIMULATED', 'Provider must be SIMULATED when delivery is disabled');
    assert.strictEqual(result.deliveryLog.providerMessageId, '<simulated-disabled-mode@parkease.local>');
  });
});
