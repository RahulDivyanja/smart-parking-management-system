const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3003,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: (process.env.NODE_ENV || 'development') === 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    username: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'YourStrongPassword123!',
    database: process.env.DB_NAME || 'ParkEase_BookingDB',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true'
  },

  business: {
    pendingHoldMinutes: parseInt(process.env.PENDING_HOLD_MINUTES, 10) || 10
  },

  services: {
    facilityServiceUrl: process.env.FACILITY_SERVICE_URL || 'http://localhost:3002',
    userServiceUrl: process.env.USER_SERVICE_URL || 'http://localhost:3001'
  }
};
