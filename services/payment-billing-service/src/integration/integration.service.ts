import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ReservationSummary {
  id: string;
  userId?: string;
  status?: string;
  totalAmount?: number;
}

@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);
  private readonly reservationServiceUrl?: string;
  private readonly notificationServiceUrl?: string;

  constructor(private readonly configService: ConfigService) {
    this.reservationServiceUrl = this.configService.get<string>(
      'RESERVATION_SERVICE_URL',
    );
    this.notificationServiceUrl = this.configService.get<string>(
      'NOTIFICATION_SERVICE_URL',
    );
  }

  /**
   * Optionally fetches reservation details from Reservation & Parking Service.
   * Falls back to null if the service is not configured or unreachable so
   * standalone testing and demos continue working.
   */
  async getReservation(
    reservationId: string,
  ): Promise<ReservationSummary | null> {
    if (!this.reservationServiceUrl) return null;

    try {
      const response = await fetch(
        `${this.reservationServiceUrl}/reservations/${reservationId}`,
        { signal: AbortSignal.timeout(2500) },
      );
      if (!response.ok) {
        this.logger.warn(
          `Reservation lookup returned ${response.status} for ${reservationId}`,
        );
        return null;
      }
      return (await response.json()) as ReservationSummary;
    } catch {
      this.logger.warn(
        `Reservation Service unreachable at ${this.reservationServiceUrl}; proceeding in standalone mode`,
      );
      return null;
    }
  }

  /**
   * Notifies Reservation & Parking Service about a payment outcome.
   */
  async notifyReservationPaymentStatus(
    reservationId: string,
    paymentStatus: string,
    paymentId: string,
  ): Promise<void> {
    if (!this.reservationServiceUrl) return;

    try {
      await fetch(
        `${this.reservationServiceUrl}/reservations/${reservationId}/payment-status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId, paymentStatus }),
          signal: AbortSignal.timeout(2500),
        },
      );
    } catch {
      this.logger.warn(
        `Could not notify Reservation Service for reservation ${reservationId}`,
      );
    }
  }

  /**
   * Sends a payment notification event to Notification Service.
   */
  async sendPaymentNotification(payload: {
    userId: string;
    reservationId: string;
    paymentId: string;
    status: string;
    amount: number;
    currency: string;
  }): Promise<void> {
    if (!this.notificationServiceUrl) return;

    try {
      await fetch(`${this.notificationServiceUrl}/notifications/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2500),
      });
    } catch {
      this.logger.warn(
        `Could not send payment notification for payment ${payload.paymentId}`,
      );
    }
  }
}
