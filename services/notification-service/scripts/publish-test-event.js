#!/usr/bin/env node

/**
 * Utility to publish simulated Booking events to RabbitMQ exchange
 * Usage:
 *   npm run event:publish -- created
 *   npm run event:publish -- cancelled
 *   npm run event:publish -- confirmed
 *   npm run event:publish -- expired
 */
require('dotenv').config();
const amqplib = require('amqplib');
const config = require('../src/config/env');

async function main() {
  const eventKind = (process.argv[2] || 'created').toLowerCase();
  const exchange = config.rabbitmq.exchange || 'parkease.events';
  const url = config.rabbitmq.url || 'amqp://guest:guest@localhost:5672';

  console.log(`Connecting to RabbitMQ at ${url}...`);
  const connection = await amqplib.connect(url);
  const channel = await connection.createChannel();

  await channel.assertExchange(exchange, 'topic', { durable: true });

  const randomRef = `BK-20261123-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const now = new Date();
  const startTime = new Date(now.getTime() + 3600000).toISOString();
  const endTime = new Date(now.getTime() + 7200000).toISOString();

  let routingKey;
  let payload;

  switch (eventKind) {
    case 'cancelled':
      routingKey = 'booking.cancelled';
      payload = {
        bookingId: 'b0000000-0000-0000-0000-000000000002',
        bookingReference: randomRef,
        userId: 'user-002',
        facilityId: 'FAC-DOWNTOWN-1',
        cancellationReason: 'Customer requested cancellation via mobile app',
        status: 'CANCELLED'
      };
      break;

    case 'confirmed':
      routingKey = 'booking.status.changed';
      payload = {
        bookingId: 'b0000000-0000-0000-0000-000000000003',
        bookingReference: randomRef,
        userId: 'user-003',
        facilityId: 'FAC-DOWNTOWN-1',
        startTime,
        endTime,
        previousStatus: 'PENDING',
        currentStatus: 'CONFIRMED'
      };
      break;

    case 'expired':
      routingKey = 'booking.status.changed';
      payload = {
        bookingId: 'b0000000-0000-0000-0000-000000000004',
        bookingReference: randomRef,
        userId: 'user-004',
        facilityId: 'FAC-DOWNTOWN-1',
        startTime,
        endTime,
        previousStatus: 'PENDING',
        currentStatus: 'EXPIRED'
      };
      break;

    case 'created':
    default:
      routingKey = 'booking.created';
      payload = {
        bookingId: 'b0000000-0000-0000-0000-000000000001',
        bookingReference: randomRef,
        userId: 'user-001',
        facilityId: 'FAC-DOWNTOWN-1',
        startTime,
        endTime,
        status: 'PENDING',
        totalAmount: 15.00
      };
      break;
  }

  const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  channel.publish(
    exchange,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    {
      contentType: 'application/json',
      messageId,
      timestamp: Date.now(),
      headers: {
        'x-retry-count': 0
      }
    }
  );

  console.log(`\n[Published] Event to exchange '${exchange}'`);
  console.log(`Routing Key: ${routingKey}`);
  console.log(`Message ID:  ${messageId}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  await channel.close();
  await connection.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Error publishing event:', err.message);
  process.exit(1);
});
