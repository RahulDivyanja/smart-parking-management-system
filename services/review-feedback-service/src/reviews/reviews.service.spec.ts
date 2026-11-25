import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ReviewStatus } from '@prisma/client';
import { IntegrationService } from '../integration/integration.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  let service: ReviewsService;

  const mockPrisma = {
    review: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  const mockIntegrationService = {
    getReservation: jest.fn().mockResolvedValue(null),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIntegrationService.getReservation.mockResolvedValue(null);
    service = new ReviewsService(
      mockPrisma as unknown as PrismaService,
      mockIntegrationService as unknown as IntegrationService,
    );
  });

  it('creates a valid review', async () => {
    mockPrisma.review.findUnique.mockResolvedValue(null);
    mockPrisma.review.create.mockResolvedValue({
      id: 'rev-1',
      userId: 'user-1',
      facilityId: 'fac-1',
      reservationId: 'res-1',
      rating: 5,
      comment: 'Great parking',
      status: ReviewStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create({
      userId: 'user-1',
      facilityId: 'fac-1',
      reservationId: 'res-1',
      rating: 5,
      comment: 'Great parking',
    });

    expect(result.rating).toBe(5);
    expect(result.status).toBe(ReviewStatus.ACTIVE);
  });

  it('prevents duplicate review for the same reservation', async () => {
    mockPrisma.review.findUnique.mockResolvedValue({ id: 'rev-1' });

    await expect(
      service.create({
        userId: 'user-1',
        facilityId: 'fac-1',
        reservationId: 'res-1',
        rating: 4,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects review when reservation is not completed', async () => {
    mockPrisma.review.findUnique.mockResolvedValue(null);
    mockIntegrationService.getReservation.mockResolvedValue({
      id: 'res-2',
      userId: 'user-1',
      status: 'PENDING',
    });

    await expect(
      service.create({
        userId: 'user-1',
        facilityId: 'fac-1',
        reservationId: 'res-2',
        rating: 4,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('calculates average rating and breakdown summary', async () => {
    mockPrisma.review.findMany.mockResolvedValue([
      { rating: 5 },
      { rating: 4 },
      { rating: 5 },
    ]);

    const summary = await service.getFacilitySummary('fac-1');
    expect(summary.totalReviews).toBe(3);
    expect(summary.averageRating).toBe(4.67);
    expect(summary.ratingBreakdown).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 });
  });

  it('throws NotFoundException when review does not exist', async () => {
    mockPrisma.review.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});
