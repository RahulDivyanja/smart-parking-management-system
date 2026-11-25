import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Invoice, Payment, PaymentStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { IntegrationService } from '../integration/integration.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly integrationService: IntegrationService,
  ) {}

  async create(dto: CreatePaymentDto) {
    // Prevent duplicate active/completed payments for the same reservation
    const existingActive = await this.prisma.payment.findFirst({
      where: {
        reservationId: dto.reservationId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.SUCCESS] },
      },
    });

    if (existingActive) {
      throw new ConflictException(
        `A ${existingActive.status} payment already exists for reservation "${dto.reservationId}"`,
      );
    }

    // Optionally validate reservation details with Reservation & Parking Service
    const reservation = await this.integrationService.getReservation(
      dto.reservationId,
    );
    if (reservation) {
      if (reservation.userId && reservation.userId !== dto.userId) {
        throw new BadRequestException(
          'Reservation does not belong to the specified user',
        );
      }
      if (
        typeof reservation.totalAmount === 'number' &&
        Math.abs(reservation.totalAmount - dto.amount) > 0.01
      ) {
        throw new BadRequestException(
          `Payment amount (${dto.amount}) does not match reservation fee (${reservation.totalAmount})`,
        );
      }
    }

    const currency = (dto.currency ?? 'USD').toUpperCase();
    const transactionReference = this.buildTransactionReference();
    const isSimulatedFailure = dto.simulateOutcome === 'FAILED';
    const finalStatus = isSimulatedFailure
      ? PaymentStatus.FAILED
      : PaymentStatus.SUCCESS;

    const payment = await this.prisma.payment.create({
      data: {
        reservationId: dto.reservationId,
        userId: dto.userId,
        amount: new Prisma.Decimal(dto.amount.toFixed(2)),
        currency,
        paymentMethod: dto.paymentMethod,
        status: finalStatus,
        transactionReference,
        failureReason: isSimulatedFailure
          ? 'Simulated payment gateway decline'
          : null,
      },
    });

    let invoice: Invoice | null = null;
    if (payment.status === PaymentStatus.SUCCESS) {
      invoice = await this.invoicesService.generateForPayment(payment.id);
    }

    // Notify sibling services (best-effort; non-blocking if offline)
    await Promise.all([
      this.integrationService.notifyReservationPaymentStatus(
        payment.reservationId,
        payment.status,
        payment.id,
      ),
      this.integrationService.sendPaymentNotification({
        userId: payment.userId,
        reservationId: payment.reservationId,
        paymentId: payment.id,
        status: payment.status,
        amount: Number(payment.amount),
        currency: payment.currency,
      }),
    ]);

    return { ...payment, invoice };
  }

  async findOne(id: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { invoice: true },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID "${id}" not found`);
    }

    return payment;
  }

  async findByReservation(reservationId: string): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { reservationId },
      include: { invoice: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByUser(userId: string): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { userId },
      include: { invoice: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(
    id: string,
    dto: UpdatePaymentStatusDto,
  ): Promise<Payment> {
    const existing = await this.findOne(id);

    if (
      existing.status === PaymentStatus.REFUNDED &&
      dto.status !== PaymentStatus.REFUNDED
    ) {
      throw new BadRequestException(
        'Cannot change status of a refunded payment',
      );
    }

    const updated = await this.prisma.payment.update({
      where: { id },
      data: {
        status: dto.status,
        failureReason:
          dto.status === PaymentStatus.FAILED
            ? (dto.failureReason ?? 'Payment marked as failed')
            : null,
      },
      include: { invoice: true },
    });

    if (dto.status === PaymentStatus.SUCCESS && !updated.invoice) {
      const invoice = await this.invoicesService.generateForPayment(updated.id);
      return { ...updated, invoice } as Payment;
    }

    await this.integrationService.notifyReservationPaymentStatus(
      updated.reservationId,
      updated.status,
      updated.id,
    );

    return updated;
  }

  async refund(id: string, dto: RefundPaymentDto): Promise<Payment> {
    const existing = await this.findOne(id);

    if (existing.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException(
        `Only SUCCESS payments can be refunded (current status: ${existing.status})`,
      );
    }

    const refunded = await this.prisma.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.REFUNDED,
        failureReason: dto.reason ?? null,
      },
      include: { invoice: true },
    });

    await Promise.all([
      this.integrationService.notifyReservationPaymentStatus(
        refunded.reservationId,
        refunded.status,
        refunded.id,
      ),
      this.integrationService.sendPaymentNotification({
        userId: refunded.userId,
        reservationId: refunded.reservationId,
        paymentId: refunded.id,
        status: refunded.status,
        amount: Number(refunded.amount),
        currency: refunded.currency,
      }),
    ]);

    return refunded;
  }

  async getReceipt(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { invoice: true },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID "${id}" not found`);
    }

    return {
      receiptId: `RCPT-${payment.transactionReference}`,
      paymentId: payment.id,
      reservationId: payment.reservationId,
      userId: payment.userId,
      transactionReference: payment.transactionReference,
      paymentMethod: payment.paymentMethod,
      status: payment.status,
      currency: payment.currency,
      amountPaid: payment.amount,
      invoice: payment.invoice
        ? {
            invoiceId: payment.invoice.id,
            invoiceNumber: payment.invoice.invoiceNumber,
            subtotal: payment.invoice.subtotal,
            tax: payment.invoice.tax,
            totalAmount: payment.invoice.totalAmount,
            issuedAt: payment.invoice.issuedAt,
          }
        : null,
      paidAt: payment.createdAt,
    };
  }

  private buildTransactionReference(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomPart = randomBytes(4).toString('hex').toUpperCase();
    return `TXN-${timestamp}-${randomPart}`;
  }
}
