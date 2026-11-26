# ParkEase - Microservice 03: Booking Service

Part of the **ParkEase Smart Parking Reservation and Management System**.

---

## 1. Overview & Responsibilities

The Booking Service is an autonomous, independent microservice responsible for:
1. **Creating parking reservations**: Validates reservation timeframes, coordinates capacity checks, computes pricing based on duration and hourly rates, and generates booking records in `PENDING` status.
2. **Checking parking facility availability**: Calculates real-time remaining capacity over requested time windows using an interval sweep-line algorithm.
3. **Preventing double bookings & overbooking**: Guarantees concurrency safety using Microsoft SQL Server application locks (`sp_getapplock`) inside TypeORM database transactions.
4. **Generating unique booking reference codes**: Generates cryptographically secure, customer-friendly references (`BK-YYYYMMDD-XXXX`).
5. **Managing booking lifecycle and status transitions**: Enforces a strict finite state machine across `PENDING`, `CONFIRMED`, `CANCELLED`, `COMPLETED`, and `EXPIRED` states.
6. **Enforcing a 10-minute pending hold**:
   - **Dynamic Query Filtering**: Unconfirmed `PENDING` bookings older than 10 minutes (`PENDING_HOLD_MINUTES`) are automatically excluded from capacity calculations, immediately freeing spaces for new customers.
   - **Lazy Expiration**: When an overdue booking is accessed or modified via the API, it is automatically transitioned to `EXPIRED`.
   - **Automatic Background Sweeper**: An in-process background scheduler periodically scans for abandoned `PENDING` bookings and transitions them to `EXPIRED` in SQL Server.
7. **Viewing reservation history**: Retrieves bookings by internal UUID, customer reference code, or user ID.
8. **Decoupled inter-service communication**:
   - Synchronous HTTP client to query facility capacity and rates from the Parking Facility Service.
   - Extensible event publisher abstraction structured for future asynchronous notification messaging.

---

## 2. Technology Stack

- **Runtime**: Node.js (v18+)
- **Framework**: Express.js (v4.21+)
- **Module System**: JavaScript (CommonJS)
- **Database**: Microsoft SQL Server (2019/2022/2025)
- **ORM / Data Access**: TypeORM (v0.3+) using `EntitySchema` (Code First approach)
- **Database Driver**: `mssql` (v11+) using `tedious` (configured with `useUTC: true`)
- **Schema Migrations**: TypeORM Migrations
- **API Documentation**: Swagger / OpenAPI 3.0 (`swagger-ui-express`, `swagger-jsdoc`)

---

## 3. Project Directory Structure

```text
ParkEase/
├── .env.example                               # Environment variable template
├── .env                                       # Local environment configuration (git-ignored)
├── .gitignore                                 # Git ignore specifications
├── package.json                               # Dependencies, metadata, and npm scripts
├── README.md                                  # Service documentation
├── src/
│   ├── app.js                                 # Express application setup, middlewares & routes mounting
│   ├── server.js                              # Server entry point, DB bootstrap, scheduler lifecycle & graceful shutdown
│   ├── config/
│   │   ├── data-source.js                     # TypeORM MSSQL DataSource configuration (with useUTC: true)
│   │   ├── env.js                             # Centralized environment variable loader and validator
│   │   └── swagger.js                         # OpenAPI 3.0 specification definition and JSDoc options
│   ├── constants/
│   │   └── booking-status.js                  # Status enums (PENDING, CONFIRMED, etc.) and transition rules
│   ├── entities/
│   │   └── booking.entity.js                  # Booking TypeORM EntitySchema mapping to MSSQL bookings table
│   ├── migrations/
│   │   └── 1700000000000-CreateBookingsTable.js # Initial TypeORM migration for bookings table and indexes
│   ├── controllers/
│   │   └── booking.controller.js              # HTTP request parsing, status codes, and response envelopes
│   ├── services/
│   │   ├── booking.service.js                 # Core business logic: capacity, transactions, references, lifecycle
│   │   └── expiration-scheduler.service.js    # Native background sweeper for expiring overdue PENDING holds
│   ├── integrations/
│   │   └── facility.client.js                 # HTTP REST client communicating with Parking Facility Service
│   ├── events/
│   │   └── booking-event.publisher.js         # Event publisher interface (structured event logger)
│   ├── routes/
│   │   └── booking.routes.js                  # REST endpoints with OpenAPI JSDoc annotations
│   ├── middlewares/
│   │   ├── error-handler.js                   # Centralized global error handler
│   │   ├── not-found.js                       # 404 Route Not Found middleware
│   │   └── validator.js                       # Request payload and query parameter validators
│   └── utils/
│       ├── api-response.js                    # Standardized API response format and AppError class
│       ├── capacity.js                        # Sweep-line discrete-event peak simultaneous occupancy algorithm
│       └── reference-generator.js             # Unique booking reference generator (BK-YYYYMMDD-XXXX)
└── tests/
    ├── unit.test.js                           # Unit tests: sweep-line capacity, reference generator, state transitions
    ├── scheduler.test.js                      # Unit tests: expiration scheduler logic, deduplication, error handling
    ├── concurrency.integration.test.js        # Live MSSQL concurrency tests verifying sp_getapplock transactions
    └── scheduler.integration.test.js          # Live MSSQL integration tests verifying background sweeper on test DB
```

---

## 4. Setup and Environment Configuration

### 1. Configure Environment Variables
Copy `.env.example` to create a local `.env` file:
```bash
cp .env.example .env
```

Configure your local Microsoft SQL Server credentials in `.env`:
```properties
# Server Configuration
PORT=3003
NODE_ENV=development

# Database Configuration (Microsoft SQL Server)
DB_HOST=127.0.0.1
DB_PORT=1433
DB_USER=YourSqlUser
DB_PASSWORD=YourSecurePassword
DB_NAME=ParkEase_BookingDB
DB_TRUST_SERVER_CERTIFICATE=true
DB_SYNCHRONIZE=false
DB_LOGGING=true

# Business Logic Configuration
PENDING_HOLD_MINUTES=10

# External Microservice URLs
FACILITY_SERVICE_URL=http://localhost:3002
USER_SERVICE_URL=http://localhost:3001
```

> **Note**: For local development, prefer using IPv4 `127.0.0.1` instead of `localhost` to avoid IPv6 lookup delays on Windows.

### 2. Database Preparation
Ensure the primary database exists in Microsoft SQL Server before running the service:
```sql
CREATE DATABASE [ParkEase_BookingDB];
```

### 3. Run TypeORM Migrations
Execute the initial migration to create the `bookings` table, constraints, and nonclustered indexes:
```bash
# Apply pending migrations
npm run migration:run

# Revert last applied migration (if needed)
npm run migration:revert

# Generate a new migration from entity schema changes
npm run migration:generate -- src/migrations/YourMigrationName
```

### 4. Start the Service
```bash
# Production mode
npm start

# Development mode (with live reload via nodemon)
npm run dev
```

---

## 5. API Endpoints & Documentation

When the service is running, interactive API documentation and health endpoints are accessible:
- **Interactive Swagger UI**: `http://localhost:3003/api-docs`
- **Raw OpenAPI 3.0 JSON Spec**: `http://localhost:3003/api-docs.json`
- **Service Health Check**: `http://localhost:3003/health`

### Summary of REST Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/bookings` | Create a reservation in `PENDING` status with concurrency locking and capacity check |
| `GET` | `/api/v1/bookings/availability` | Check remaining facility capacity across a specified time interval |
| `GET` | `/api/v1/bookings/reference/:reference` | Retrieve booking details by unique reference code (e.g. `BK-20261123-A7F9`) |
| `GET` | `/api/v1/bookings/user/:userId` | Retrieve reservation history for a user (optional `?status=` filter) |
| `GET` | `/api/v1/bookings/:id` | Retrieve booking details by internal UUID |
| `PATCH` | `/api/v1/bookings/:id/cancel` | Cancel a reservation (validates finite state machine transition) |
| `PATCH` | `/api/v1/bookings/:id/status` | Update booking status (`CONFIRMED`, `COMPLETED`, `EXPIRED`) |
| `GET` | `/health` | Health check reporting service status and database connectivity |

---

## 6. Architecture & Concurrency Guarantees

### Peak Simultaneous Occupancy (Sweep-Line Algorithm)
A naive `COUNT(*)` of overlapping bookings incorrectly rejects sequential back-to-back reservations (e.g. 10:00–12:00 and 12:00–14:00 do not overlap each other).

The Booking Service implements a **discrete-event sweep-line algorithm** ([src/utils/capacity.js](src/utils/capacity.js)):
- Clamps overlapping booking intervals to the query window $[T_{\text{start}}, T_{\text{end}}]$.
- Emits $+1$ (arrival) at start times and $-1$ (departure) at end times.
- **Tie-Breaker Rule**: Departures ($-1$) are sorted *before* arrivals ($+1$) for identical timestamps, ensuring a vehicle departing at 12:00 immediately frees capacity for a vehicle arriving at 12:00.
- Calculates peak simultaneous occupancy in $O(N \log N)$ time.
- Approves the reservation only if $(\text{peakOccupancy} + 1) \le \text{totalCapacity}$.

### Concurrency Protection via SQL Server `sp_getapplock`
To prevent race conditions and overbooking when multiple concurrent requests target the same facility:
- [src/services/booking.service.js](src/services/booking.service.js) begins a TypeORM database transaction.
- Acquires an exclusive application lock:
  ```sql
  EXEC sp_getapplock 
    @Resource = 'FacilityLock_<facilityId>', 
    @LockMode = 'Exclusive', 
    @LockOwner = 'Transaction', 
    @LockTimeout = 5000;
  ```
- **Fine-Grained Scope**: Locks are partitioned by facility ID. Requests for different facilities execute concurrently without blocking each other.
- **Transaction-Scoped**: When committed or rolled back, SQL Server automatically releases the lock.
- **Zero Phantom Reads**: Capacity validation and record insertion occur atomically inside the locked transaction.

### Pending Hold & Expiration Lifecycle
- Reservations are initially created with `status = 'PENDING'`.
- **Hold Duration**: Configured via `PENDING_HOLD_MINUTES` (default: 10 minutes).
- **Dynamic Capacity Release**: Capacity queries filter `created_at >= DATEADD(minute, -@holdMinutes, SYSUTCDATETIME())`. Expired pending reservations immediately stop consuming capacity even before their database status is updated.
- **Lazy Expiration**: Any API access (`GET /:id`, `PATCH /:id/cancel`, `PATCH /:id/status`) checks the elapsed time and atomically updates the status to `EXPIRED`.
- **Background Sweeper**: [src/services/expiration-scheduler.service.js](src/services/expiration-scheduler.service.js) executes every 60 seconds using an atomic SQL query:
  ```sql
  UPDATE bookings
  SET status = 'EXPIRED', updated_at = SYSUTCDATETIME()
  OUTPUT inserted.id, inserted.booking_reference AS bookingReference, inserted.user_id AS userId, inserted.facility_id AS facilityId, inserted.status
  WHERE status = 'PENDING'
    AND created_at < DATEADD(minute, -@0, SYSUTCDATETIME());
  ```
- **Duplicate Event Protection**: Both lazy evaluation and the background sweeper use atomic conditional updates (`WHERE id = @id AND status = 'PENDING'`), ensuring status transition events are emitted exactly once.

---

## 7. Testing

The test suite separates fast unit tests from live database integration tests:

### Test Commands

```bash
# 1. Run Unit Tests (Fast, in-memory stubs, zero database required)
npm test

# 2. Run Concurrency Integration Tests (Live MSSQL transactions & sp_getapplock)
npm run test:concurrency

# 3. Run Expiration Scheduler Integration Tests (Live MSSQL test database)
npm run test:scheduler:live
```

### Test Scope & Latest Verified Results

| Test Suite | Command | Scope | Latest Verified Results |
| :--- | :--- | :--- | :--- |
| **Unit Tests** | `npm test` | Sweep-line interval calculations, booking reference generation, state machine transitions, and scheduler logic using stubs. | **21 passed, 0 failed** |
| **Concurrency Integration** | `npm run test:concurrency` | Live SQL Server transaction testing with `Promise.allSettled()`: exact-slot overbooking prevention, lock independence, back-to-back sequential slots, and staggered partial overlaps. | **5 passed, 0 failed** |
| **Live Scheduler Integration** | `npm run test:scheduler:live` | Live SQL Server testing of the background sweeper against `ParkEase_BookingDB_Test`: verifies overdue expiration, recent booking preservation, duplicate prevention, and lifecycle controls. | **5 passed, 0 failed** |

> **Disclaimer**: The test counts above reflect the latest verified execution results on the current implementation and do not guarantee passing status for future unverified code modifications.

### Integration Test Databases
- `npm run test:concurrency` runs against the configured database (`ParkEase_BookingDB`), using unique facility IDs (`FAC-CONCUR-SC*`) and cleaning up only its generated test records in `try/finally` blocks.
- `npm run test:scheduler:live` runs exclusively against a dedicated test database (`ParkEase_BookingDB_Test`), verifying database identity via `SELECT DB_NAME()` before execution. It tracks exact UUIDs and cleans up only the records created during the test run.

---

## 8. Known Integration Limitations

1. **Facility Service REST Client**:
   [src/integrations/facility.client.js](src/integrations/facility.client.js) communicates with the Parking Facility Service via HTTP (`GET /api/v1/facilities/:facilityId`). In standalone development mode, it provides fallback responses when the external service is offline. Full end-to-end communication requires live integration verification once Microservice 02 (Facility Service) is deployed.
2. **Notification Service Event Publishing**:
   [src/events/booking-event.publisher.js](src/events/booking-event.publisher.js) currently logs structured JSON events (`BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_STATUS_CHANGED`) to stdout. Asynchronous messaging via a message broker (such as RabbitMQ) is planned as a future enhancement and is not yet operational.
