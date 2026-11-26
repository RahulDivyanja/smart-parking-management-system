const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const bookingRoutes = require('./routes/booking.routes');
const errorHandler = require('./middlewares/error-handler');
const notFoundHandler = require('./middlewares/not-found');
const AppDataSource = require('./config/data-source');

const app = express();

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger / OpenAPI documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'ParkEase Booking Service API Documentation',
  customCss: '.swagger-ui .topbar { display: none }'
}));

// Raw Swagger JSON specification endpoint
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Health check endpoint
app.get('/health', (req, res) => {
  const isDbConnected = AppDataSource.isInitialized;
  res.status(isDbConnected ? 200 : 503).json({
    status: isDbConnected ? 'UP' : 'DEGRADED',
    service: 'ParkEase Microservice 03: Booking Service',
    database: isDbConnected ? 'CONNECTED' : 'DISCONNECTED',
    timestamp: new Date().toISOString()
  });
});

// Mount domain routes
app.use('/api/v1/bookings', bookingRoutes);

// 404 Route Not Found
app.use(notFoundHandler);

// Centralized Error Handling
app.use(errorHandler);

module.exports = app;
