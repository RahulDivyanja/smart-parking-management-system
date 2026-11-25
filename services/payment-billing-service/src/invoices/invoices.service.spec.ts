import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  let service: InvoicesService;

  const mockPrisma = {
    payment: {
      findUnique: jest.fn(),
    },
    invoice: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('0.10'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InvoicesService(
      mockPrisma as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
    );
  });

  it('generates an invoice with tax for a successful payment', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      amount: new Prisma.Decimal('50.00'),
      status: PaymentStatus.SUCCESS,
      invoice: null,
    });
    mockPrisma.invoice.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'inv-1', issuedAt: new Date(), ...data }),
    );

    const invoice = await service.generateForPayment('pay-1');

    expect(Number(invoice.subtotal)).toBe(50);
    expect(Number(invoice.tax)).toBe(5);
    expect(Number(invoice.totalAmount)).toBe(55);
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{8}-[A-F0-9]{6}$/);
  });

  it('rejects invoice generation for non-SUCCESS payment', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue({
      id: 'pay-2',
      amount: new Prisma.Decimal('50.00'),
      status: PaymentStatus.FAILED,
      invoice: null,
    });

    await expect(service.generateForPayment('pay-2')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when payment does not exist', async () => {
    mockPrisma.payment.findUnique.mockResolvedValue(null);
    await expect(service.generateForPayment('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
