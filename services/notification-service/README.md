# ParkEase – Notification Service (Microservice 05)

## Overview
The **ParkEase Notification Service** is an autonomous microservice responsible for handling event-driven notifications (primarily Email via SMTP/Nodemailer) and reservation reminder scheduling across the ParkEase Smart Parking Reservation and Management System.

It consumes domain events emitted by the **Booking Service** (`BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_STATUS_CHANGED`) and upcoming microservices (Payment, User), resolves recipient details safely via the User Service, ensures strict idempotency against duplicate delivery, and autonomously manages parking arrival and departure reminders.

---

## Architectural Principles
- **Autonomous Microservice**: Independent lifecycle, configuration, and dedicated database (`ParkEase_NotificationDB`).
- **At-Least-Once Delivery with Deduplication**: Two-state machine architecture separating event consumption idempotency (`processed_events`) from external SMTP delivery status (`notifications`).
- **Autonomous Reminder Scheduling**: Captures reservation timings in `booking_reminder_schedules` to autonomously trigger arrival (30 minutes prior) and departure (15 minutes prior) reminders without cross-database queries.
- **Resilient RabbitMQ Topology**: Dead-letter exchange (`parkease.events.dlx`) and bounded retries to prevent infinite message loops.
- **Strict Data Integrity**: Atomic SQL Server conditional claims ensure multiple instances cannot dispatch the same reminder simultaneously.

---

## Technology Stack
- **Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **Module System**: CommonJS
- **Database**: Microsoft SQL Server
- **ORM**: TypeORM with `EntitySchema` (Code First)
- **Message Broker**: RabbitMQ (`amqplib`)
- **Email Delivery**: Nodemailer (SMTP)
- **Templating**: Handlebars (`handlebars`)
- **API Documentation**: Swagger / OpenAPI 3.0 (`swagger-ui-express`, `swagger-jsdoc`)
- **Testing**: Node.js built-in test runner (`node:test`)

---

## Service Port
- Default Port: `3005`

---

## Getting Started

### 1. Installation
```bash
cd notification-service
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env` and fill in your local credentials:
```bash
cp .env.example .env
```

### 3. Running the Service
```bash
# Production mode
npm start

# Development mode (with live reload)
npm run dev
```

---

## RabbitMQ Topology & Event Architecture

The Notification Service integrates with RabbitMQ 4 to consume booking domain events with guaranteed at-least-once delivery, delayed non-blocking retries, and dead-letter queueing:

```
[Booking Events]
       │
       ▼
[parkease.events (Topic Exchange)]
       │
       ├───────────────────────────────────────────────┐
       │ (routing keys: booking.*)                     │ (dead-letter return after TTL)
       ▼                                               │
[parkease.notifications.queue]                         │
       │                                               │
       ▼ (consumes messages)                           │
NotificationConsumer                                   │
       │                                               │
       ├─── Success / Ignore / Duplicate               │
       │       └──> ACK                                │
       │                                               │
       ├─── Transient Error (retryCount < 3)           │
       │       ├──> Publish to retry exchange ─────────┤
       │       ├──> Wait for Publisher Confirm         │
       │       └──> ACK original message               │
       │                                               ▼
       │                          [parkease.events.retry (Topic)]
       │                                               │
       │                                               ▼
       │                          [parkease.notifications.retry.queue]
       │                          (x-message-ttl: 5000ms)
       │                          (x-dead-letter-exchange: parkease.events)
       │
       └─── Poison / Max Retries Exhausted (>= 3)
               └──> Reject (requeue=false)
                       │
                       ▼ (broker dead-letters to)
               [parkease.events.dlx (Direct DLX)]
                       │
                       ▼ (routing key: dead)
               [parkease.notifications.dlq]
```

### Exchanges and Queues

| Component | Name | Type / Arguments | Purpose |
| :--- | :--- | :--- | :--- |
| **Main Exchange** | `parkease.events` | Topic, durable | Receives original domain events and expired retried messages. |
| **Main Queue** | `parkease.notifications.queue` | Durable, `x-dead-letter-exchange: parkease.events.dlx`, `x-dead-letter-routing-key: dead` | Consumed by Notification Service workers. |
| **Retry Exchange** | `parkease.events.retry` | Topic, durable | Receives transient failure retry messages. |
| **Retry Queue** | `parkease.notifications.retry.queue` | Durable, `x-message-ttl: 5000` (configurable), `x-dead-letter-exchange: parkease.events` | Holds retrying messages for the TTL period before routing back to main exchange. |
| **DLX** | `parkease.events.dlx` | Direct, durable | Routes poisoned or exhausted messages. |
| **DLQ** | `parkease.notifications.dlq` | Durable, bound to DLX with key `dead` | Stores failed messages for inspection and dead-letter monitoring. |

---

## Idempotency & Lifecycle Rules

1. **Consumer Deduplication (`processed_events`)**:
   - Every incoming event is tracked using a stable event ID (`messageId`, `eventId`, or composite key).
   - If `processingStatus === COMPLETED`, the message is immediately acknowledged without reprocessing.
   - Concurrent duplicate deliveries are guarded by a unique database constraint on `event_id`. Conflicts are caught gracefully and acknowledged without crashing.
2. **Notification Lifecycle (`notifications`)**:
   - `SENT`: Finalized. Duplicate deliveries for the same `idempotencyKey` return duplicate/delivered without sending another email.
   - `RETRYING`: Transiently failed (e.g., User Service temporarily unavailable). Reuses the existing notification record, updates its status, re-resolves the recipient, and records a new attempt in `notification_delivery_logs`.
   - `FAILED`: Permanent non-retryable failures (e.g., User 404 Not Found, invalid recipient) are recorded and acknowledged without triggering infinite retry loops.
3. **Publisher Confirmations**:
   - Retry publishing uses an `amqplib` `ConfirmChannel`.
   - The consumer awaits broker confirmation before ACKing the original message. If confirmation fails, the message is NACKed with `requeue=true` to guarantee zero message loss.
4. **Email Safety**:
   - Default configuration sets `EMAIL_DELIVERY_ENABLED=false`.
   - In safe mode, email dispatch is simulated (`<simulated-disabled-mode@parkease.local>`) and logged as `provider: 'SIMULATED'`, ensuring no external SMTP calls occur during development or testing.

---

## Commands & Scripts

```bash
# Run unit tests
npm test

# Start the RabbitMQ consumer
npm run consumer:start

# Publish a test event to RabbitMQ (options: created | cancelled | confirmed | expired)
npm run event:publish -- created
npm run event:publish -- confirmed
```

---

## Implementation Status
- [x] **Phase 1**: Project Scaffolding & Configuration
- [x] **Phase 2**: Database Entities & Migrations (`ParkEase_NotificationDB`)
- [x] **Phase 3**: Email Engine & Branded HTML Templates
- [x] **Phase 4**: User Service REST Client & Contact Resolution
- [x] **Phase 5**: RabbitMQ Consumer, Delayed Retries (TTL), & DLQ Topology
- [ ] **Phase 6**: Autonomous Reminder Sweeper Service
- [ ] **Phase 7**: REST API, Health Endpoints & Swagger Documentation
