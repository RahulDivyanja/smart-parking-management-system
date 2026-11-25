import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Review, ReviewStatus } from '@prisma/client';
import { IntegrationService } from '../integration/integration.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationService: IntegrationService,
  ) {}

  async create(dto: CreateReviewDto): Promise<Review> {
    const existing = await this.prisma.review.findUnique({
      where: { reservationId: dto.reservationId },
    });

    if (existing) {
      throw new ConflictException(
        `A review already exists for reservation "${dto.reservationId}"`,
      );
    }

    // Optionally verify reservation ownership & completion with Reservation Service
    const reservation = await this.integrationService.getReservation(
      dto.reservationId,
    );
    if (reservation) {
      if (reservation.userId && reservation.userId !== dto.userId) {
        throw new BadRequestException(
          'Users can only review their own reservations',
        );
      }
      if (
        reservation.status &&
        reservation.status.toUpperCase() !== 'COMPLETED'
      ) {
        throw new BadRequestException(
          `Reviews can only be submitted after completing a reservation (current status: ${reservation.status})`,
        );
      }
    }

    return this.prisma.review.create({
      data: {
        userId: dto.userId,
        facilityId: dto.facilityId,
        reservationId: dto.reservationId,
        rating: dto.rating,
        comment: dto.comment ?? null,
        status: ReviewStatus.ACTIVE,
      },
    });
  }

  async findOne(id: string): Promise<Review> {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException(`Review with ID "${id}" not found`);
    }
    return review;
  }

  async findByFacility(facilityId: string): Promise<Review[]> {
    return this.prisma.review.findMany({
      where: { facilityId, status: ReviewStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByUser(userId: string): Promise<Review[]> {
    return this.prisma.review.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdateReviewDto): Promise<Review> {
    await this.findOne(id);
    return this.prisma.review.update({
      where: { id },
      data: {
        ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  async remove(id: string): Promise<{ deleted: boolean; id: string }> {
    await this.findOne(id);
    await this.prisma.review.delete({ where: { id } });
    return { deleted: true, id };
  }

  async getFacilityRating(facilityId: string) {
    const aggregate = await this.prisma.review.aggregate({
      where: { facilityId, status: ReviewStatus.ACTIVE },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const totalReviews = aggregate._count.rating;
    const averageRating =
      totalReviews > 0 && aggregate._avg.rating !== null
        ? Number(aggregate._avg.rating.toFixed(2))
        : 0;

    return {
      facilityId,
      averageRating,
      totalReviews,
    };
  }

  async getFacilitySummary(facilityId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { facilityId, status: ReviewStatus.ACTIVE },
      select: { rating: true },
    });

    const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };

    let sum = 0;
    for (const review of reviews) {
      sum += review.rating;
      if (review.rating >= 1 && review.rating <= 5) {
        const key = review.rating as 1 | 2 | 3 | 4 | 5;
        breakdown[key] += 1;
      }
    }

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0 ? Number((sum / totalReviews).toFixed(2)) : 0;

    return {
      facilityId,
      averageRating,
      totalReviews,
      ratingBreakdown: breakdown,
    };
  }
}
