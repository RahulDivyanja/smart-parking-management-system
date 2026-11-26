const axios = require('axios');
const config = require('../config/env');

/**
 * HTTP Client to communicate with Parking Facility Service
 * Strictly respects microservice boundaries: communicates via HTTP REST APIs only.
 */
class FacilityClient {
  constructor() {
    this.baseUrl = config.services.facilityServiceUrl;
    this.timeout = 5000;
  }

  /**
   * Fetch facility information (capacity and hourly rate) by facilityId
   * @param {string} facilityId
   * @returns {Promise<{id: string, name: string, totalCapacity: number, hourlyRate: number}>}
   */
  async getFacilityById(facilityId) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/facilities/${encodeURIComponent(facilityId)}`, {
        timeout: this.timeout
      });

      if (response.data && response.data.data) {
        const facility = response.data.data;
        return {
          id: facility.id || facilityId,
          name: facility.name || `Facility ${facilityId}`,
          totalCapacity: parseInt(facility.totalCapacity || facility.capacity, 10),
          hourlyRate: parseFloat(facility.hourlyRate || facility.ratePerHour || 0)
        };
      }

      throw new Error('Invalid response structure from Facility Service');
    } catch (error) {
      // In development or when the other microservice is not yet running,
      // provide a sensible default mock facility to allow independent testing
      if (config.isDevelopment && (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.response?.status === 404)) {
        console.warn(`[FacilityClient] Facility Service unavailable at ${this.baseUrl}. Using standalone fallback configuration for facilityId: ${facilityId}`);
        return {
          id: facilityId,
          name: `Parking Facility ${facilityId}`,
          totalCapacity: 50, // Default 50 spaces for local development/testing
          hourlyRate: 5.00   // Default $5.00/hour
        };
      }

      const status = error.response ? error.response.status : 503;
      const message = error.response?.data?.message || 'Failed to reach Parking Facility Service';
      const err = new Error(`Facility Service Error (${status}): ${message}`);
      err.statusCode = status === 404 ? 404 : 503;
      throw err;
    }
  }
}

module.exports = new FacilityClient();
