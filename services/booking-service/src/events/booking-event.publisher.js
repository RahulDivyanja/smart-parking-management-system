/**
 * Asynchronous Event Publisher
 *
 * Implements the Publish/Subscribe pattern for inter-microservice messaging.
 * Currently logs events in structured JSON format.
 * Designed so RabbitMQ AMQP client logic can be plugged in without modifying
 * any domain business logic in the service layer.
 */
class BookingEventPublisher {
  constructor() {
    this.isRabbitMQEnabled = false; // Future flag when RabbitMQ is provisioned
  }

  /**
   * Publish BOOKING_CREATED event
   * @param {object} booking
   */
  async publishBookingCreated(booking) {
    const event = {
      eventType: 'BOOKING_CREATED',
      timestamp: new Date().toISOString(),
      payload: {
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        userId: booking.userId,
        facilityId: booking.facilityId,
        vehicleRegistrationNumber: booking.vehicleRegistrationNumber,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalAmount: booking.totalAmount,
        status: booking.status
      }
    };

    this._dispatch(event);
  }

  /**
   * Publish BOOKING_CANCELLED event
   * @param {object} booking
   * @param {string} reason
   */
  async publishBookingCancelled(booking, reason = '') {
    const event = {
      eventType: 'BOOKING_CANCELLED',
      timestamp: new Date().toISOString(),
      payload: {
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        userId: booking.userId,
        facilityId: booking.facilityId,
        status: booking.status,
        cancellationReason: reason
      }
    };

    this._dispatch(event);
  }

  /**
   * Publish BOOKING_STATUS_CHANGED event
   * @param {object} booking
   * @param {string} previousStatus
   */
  async publishBookingStatusChanged(booking, previousStatus) {
    const event = {
      eventType: 'BOOKING_STATUS_CHANGED',
      timestamp: new Date().toISOString(),
      payload: {
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        userId: booking.userId,
        facilityId: booking.facilityId,
        previousStatus,
        currentStatus: booking.status
      }
    };

    this._dispatch(event);
  }

  /**
   * Internal dispatcher - outputs structured log and forwards to queue if enabled
   * @private
   */
  _dispatch(event) {
    console.log(`[EVENT_PUBLISHER] ${event.eventType} ->`, JSON.stringify(event));
    if (this.isRabbitMQEnabled) {
      // Future: channel.publish('parkease.exchange', event.eventType, Buffer.from(JSON.stringify(event)));
    }
  }
}

module.exports = new BookingEventPublisher();
