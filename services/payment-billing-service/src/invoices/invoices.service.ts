import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invoice, PaymentStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvoicesService {
  private readonly taxRate: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const rawRate = this.configService.get<string>('TAX_RATE');
    const parsed = rawRate ? Number(rawRate) : 0.1;
    this.taxRate = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.1;
  }

  async generateForPayment(paymentId: string): Promise<Invoice> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: true },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID "${paymentId}" not found`);
    }

    if (payment.invoice) {
      return payment.invoice;
    }

    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException(
        `Cannot generate invoice for payment with status ${payment.status}`,
      );
    }

    const subtotalNum = Number(payment.amount);
    const taxNum = Number((subtotalNum * this.taxRate).toFixed(2));
    const totalNum = Number((subtotalNum + taxNum).toFixed(2));

    return this.prisma.invoice.create({
      data: {
        paymentId: payment.id,
        invoiceNumber: this.buildInvoiceNumber(),
        subtotal: new Prisma.Decimal(subtotalNum.toFixed(2)),
        tax: new Prisma.Decimal(taxNum.toFixed(2)),
        totalAmount: new Prisma.Decimal(totalNum.toFixed(2)),
      },
    });
  }

  async findOne(id: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { payment: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID "${id}" not found`);
    }

    return invoice;
  }

  async findByPaymentId(paymentId: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { paymentId },
      include: { payment: true },
    });

    if (!invoice) {
      throw new NotFoundException(
        `Invoice for payment ID "${paymentId}" not found`,
      );
    }

    return invoice;
  }

  private buildInvoiceNumber(): string {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = randomBytes(3).toString('hex').toUpperCase();
    return `INV-${datePart}-${randomPart}`;
  }
}
