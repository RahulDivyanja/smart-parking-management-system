const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { NotificationConsumer } = require('../../src/consumers/notification.consumer');
const { REMINDER_STATUS } = require('../../src/constants/reminder-status');
const { REMINDER_TYPE } = require('../../src/constants/reminder-type');

describe('Notification Consumer - Phase 6 Reminder Integration Tests', () => {
  let createdBookings;
  let statusChanges;
  let mockScheduler;
  let mockNotificationService;
  let mockChannel;
  let consumer;

  beforeEach(() => {
    createdBookings = [];
    statusChanges = [];

    mockScheduler = {
      handleBookingCreated: async (payload) => {
        createdBookings.push(payload);
        return { scheduled: true, reminderStatus: REMINDER_STATUS.INACTIVE };
      },
      handleBookingStatusChanged: async (payload) => {
        statusChanges.push(payload);
        return { updated: true, currentStatus: payload.currentStatus };
      }
    };

    mockNotificationService = {
      processNotification: async () => ({ delivered: true, messageId: 'msg-notif' })
    };

    mockChannel = {
      ack: () => {},
      nack: () => {},
      reject: () => {},
      assertExchange: async () => {},
      assertQueue: async () => {},
      bindQueue: async () => {},
      prefetch: async () => {},
      consume: async () => ({ consumerTag: 'tag-1' }),
      publish: () => true,
      waitForConfirms: async () => true
    };

    const mockRepo = {
      findOneBy: async () => null,
      save: async () => ({ id: '1' }),
      update: async () => ({ affected: 1 })
    };

    const mockDataSource = {
      getRepository: () => mockRepo
    };

    consumer = new NotificationConsumer({
      notificationService: mockNotificationService,
      dataSource: mockDataSource,
      reminderScheduler: mockScheduler
    });
    consumer.channel = mockChannel;
  });

  it('should trigger reminder scheduler on booking.created event', async () => {
    const event = {
      bookingId: 'bk-integ-1',
      bookingReference: 'BK-INT-001',
      userId: 'usr-integ-1',
      facilityId: 'FAC-INT-1',
      startTime: '2026-11-23T14:00:00.000Z',
      endTime: '2026-11-23T16:00:00.000Z'
    };

    const msg = {
      fields: { routingKey: 'booking.created' },
      properties: { messageId: 'evt-created-1', headers: {} },
      content: Buffer.from(JSON.stringify(event))
    };

    await consumer.handleMessage(msg);

    assert.strictEqual(createdBookings.length, 1);
    assert.strictEqual(createdBookings[0].bookingId, 'bk-integ-1');
  });

  it('should trigger reminder scheduler on booking.status_changed event', async () => {
    const event = {
      bookingId: 'bk-integ-2',
      bookingReference: 'BK-INT-002',
      userId: 'usr-integ-2',
      facilityId: 'FAC-INT-2',
      previousStatus: 'PENDING',
      currentStatus: 'CONFIRMED'
    };

    const msg = {
      fields: { routingKey: 'booking.status_changed' },
      properties: { messageId: 'evt-confirmed-1', headers: {} },
      content: Buffer.from(JSON.stringify(event))
    };

    await consumer.handleMessage(msg);

    assert.strictEqual(statusChanges.length, 1);
    assert.strictEqual(statusChanges[0].bookingId, 'bk-integ-2');
    assert.strictEqual(statusChanges[0].currentStatus, 'CONFIRMED');
  });
});
