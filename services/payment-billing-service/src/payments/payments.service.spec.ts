import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { IntegrationService } from '../integration/integration.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const mockPrisma = {
    payment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockInvoicesService = {
    generateForPayment: jest.fn(),
  };

  const mockIntegrationService = {
    getReservation: jest.fn().mockResolvedValue(null),
    notifyReservationPaymentStatus: jest.fn().mockResolvedValue(undefined),
    sendPaymentNotification: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentsService(
      mockPrisma as unknown as PrismaService,
      mockInvoicesService as unknown as InvoicesService,
      mockIntegrationService as unknown as IntegrationService,
    );
  });

  it('creates a successful payment and generates an invoice', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    const createdPayment = {
      id: 'pay-1',
      reservationId: 'res-1',
      userId: 'user-1',
      amount: new Prisma.Decimal('20.00'),
      currency: 'USD',
      paymentMethod: PaymentMethod.CARD,
      status: PaymentStatus.SUCCESS,
      transactionReference: 'TXN-TEST-123',
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.payment.create.mockResolvedValue(createdPayment);
    mockInvoicesService.generateForPayment.mockResolvedValue({
      id: 'inv-1',
      paymentId: 'pay-1',
      invoiceNumber: 'INV-20261125-ABC123',
    });

    const result = await service.create({
      reservationId: 'res-1',
      userId: 'user-1',
      amount: 20,
      paymentMethod: PaymentMethod.CARD,
    });

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.invoice).toBeDefined();
    expect(mockInvoicesService.generateForPayment).toHaveBeenCalledWith('pay-1');
  });

  it('creates a failed payment when simulateOutcome is FAILED', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.payment.create.mockResolvedValue({
      id: 'pay-2',
      reservationId: 'res-2',
      userId: 'user-1',
      amount: new Prisma.Decimal('15.00'),
      currency: 'USD',
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentStatus.FAILED,
      transactionReference: 'TXN-TEST-456',
      failureReason: 'Simulated payment gateway decline',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create({
      reservationId: 'res-2',
      userId: 'user-1',
      amount: 15,
      paymentMethod: PaymentMethod.ONLINE,
      simulateOutcome: 'FAILED',
    });

    expect(result.status).toBe(PaymentStatus.FAILED);
    expect(result.invoice).toBeNull();
    expect(mockInvoicesService.generateForPayment).not.toHaveBeenCalled();
  });

  it('prevents duplicate payments for the same reservation', async () => {
    mockPrisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      status: PaymentStatus.SUCCESS,
    });

    await expect(
      service.create({
        reservationId: 'res-1',
        userId: 'user-1',
        amount: 20,
        paymentMethod: PaymentMethod.CARD,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('refunds a successful payment', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      reservationId: 'res-1',
      userId: 'user-1',
      amount: new Prisma.Decimal('20.00'),
      currency: 'USD',
      status: PaymentStatus.SUCCESS,
    });
    mockPrisma.payment.update.mockResolvedValue({
      id: 'pay-1',
      reservationId: 'res-1',
      userId: 'user-1',
      amount: new Prisma.Decimal('20.00'),
      currency: 'USD',
      status: PaymentStatus.REFUNDED,
    });

    const result = await service.refund('pay-1', { reason: 'User cancelled' });
    expect(result.status).toBe(PaymentStatus.REFUNDED);
  });

  it('rejects refund for non-SUCCESS payment', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'pay-2',
      status: PaymentStatus.FAILED,
    });

    await expect(service.refund('pay-2', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when payment is missing', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing-id')).rejects.toThrow(
      NotFoundException,
    );
  });
});
