import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ReservationInfo {
  id: string;
  userId?: string;
  facilityId?: string;
  status?: string;
}

@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);
  private readonly reservationServiceUrl?: string;

  constructor(private readonly configService: ConfigService) {
    this.reservationServiceUrl = this.configService.get<string>(
      'RESERVATION_SERVICE_URL',
    );
  }

  /**
   * Optionally fetches reservation details from Reservation & Parking Service
   * to verify ownership and completion status. Falls back to null if the
   * service is not configured or unreachable (standalone mode).
   */
  async getReservation(reservationId: string): Promise<ReservationInfo | null> {
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
      return (await response.json()) as ReservationInfo;
    } catch {
      this.logger.warn(
        `Reservation Service unreachable at ${this.reservationServiceUrl}; proceeding in standalone mode`,
      );
      return null;
    }
  }
}
