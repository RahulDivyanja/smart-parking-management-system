const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');
const config = require('./env');

const swaggerDefinition = {
  openapi: '3.0.3',
  info: {
    title: 'ParkEase - Microservice 03: Booking Service API',
    version: '1.0.0',
    description: `Independent microservice for ParkEase Smart Parking Reservation and Management System.
Handles creating reservations, capacity verification via interval sweep-line analysis, double-booking prevention using SQL Server application locks (sp_getapplock), cancellations, and lifecycle management.`,
    contact: {
      name: 'ParkEase Microservices Engineering Team'
    }
  },
  servers: [
    {
      url: `http://localhost:${config.port}`,
      description: 'Local Development Server'
    }
  ],
  components: {
    schemas: {
      Booking: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: '3fa85f64-5717-4562-b3fc-2c963f66afa6'
          },
          bookingReference: {
            type: 'string',
            example: 'BK-20261120-7A9B'
          },
          userId: {
            type: 'string',
            example: 'USR-1001'
          },
          facilityId: {
            type: 'string',
            example: 'FAC-WEST-01'
          },
          vehicleRegistrationNumber: {
            type: 'string',
            example: 'CAB-1234'
          },
          startTime: {
            type: 'string',
            format: 'date-time',
            example: '2026-11-20T17:00:00.000Z'
          },
          endTime: {
            type: 'string',
            format: 'date-time',
            example: '2026-11-20T20:00:00.000Z'
          },
          hourlyRate: {
            type: 'number',
            format: 'float',
            example: 5.00
          },
          totalAmount: {
            type: 'number',
            format: 'float',
            example: 15.00
          },
          status: {
            type: 'string',
            enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'EXPIRED'],
            example: 'PENDING'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-11-20T16:00:00.000Z'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-11-20T16:00:00.000Z'
          }
        }
      },
      CreateBookingRequest: {
        type: 'object',
        required: [
          'userId',
          'facilityId',
          'vehicleRegistrationNumber',
          'startTime',
          'endTime'
        ],
        properties: {
          userId: {
            type: 'string',
            description: 'External ID referencing the user from User Microservice',
            example: 'USR-1001'
          },
          facilityId: {
            type: 'string',
            description: 'External ID referencing the parking facility',
            example: 'FAC-WEST-01'
          },
          vehicleRegistrationNumber: {
            type: 'string',
            description: 'Vehicle plate number',
            example: 'CAB-1234'
          },
          startTime: {
            type: 'string',
            format: 'date-time',
            description: 'Start of reservation window (ISO 8601)',
            example: '2026-11-20T17:00:00.000Z'
          },
          endTime: {
            type: 'string',
            format: 'date-time',
            description: 'End of reservation window (ISO 8601)',
            example: '2026-11-20T20:00:00.000Z'
          }
        }
      },
      AvailabilityResponse: {
        type: 'object',
        properties: {
          facilityId: { type: 'string', example: 'FAC-WEST-01' },
          facilityName: { type: 'string', example: 'West Gate Facility' },
          totalCapacity: { type: 'integer', example: 50 },
          peakOccupancy: { type: 'integer', example: 12 },
          availableSpaces: { type: 'integer', example: 38 },
          isAvailable: { type: 'boolean', example: true },
          hourlyRate: { type: 'number', example: 5.00 },
          queryWindow: {
            type: 'object',
            properties: {
              startTime: { type: 'string', format: 'date-time' },
              endTime: { type: 'string', format: 'date-time' }
            }
          }
        }
      },
      CancelBookingRequest: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Optional cancellation explanation',
            example: 'Change of travel plans'
          }
        }
      },
      UpdateStatusRequest: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
            example: 'CONFIRMED'
          }
        }
      },
      StandardSuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation completed successfully.' },
          data: { type: 'object' },
          timestamp: { type: 'string', format: 'date-time' }
        }
      },
      StandardErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Error description' },
          errors: { type: 'array', items: { type: 'string' }, nullable: true },
          timestamp: { type: 'string', format: 'date-time' }
        }
      }
    }
  }
};

const options = {
  swaggerDefinition,
  apis: [path.join(__dirname, '../routes/*.js').replace(/\\/g, '/')]
};

module.exports = swaggerJsdoc(options);
