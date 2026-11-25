import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Initiate and process a simulated parking payment' })
  @ApiResponse({ status: 201, description: 'Payment processed' })
  @ApiResponse({ status: 409, description: 'Duplicate payment for reservation' })
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Get('reservation/:reservationId')
  @ApiOperation({ summary: 'Retrieve payments for a reservation' })
  findByReservation(@Param('reservationId') reservationId: string) {
    return this.paymentsService.findByReservation(reservationId);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Retrieve payment history for a user' })
  findByUser(@Param('userId') userId: string) {
    return this.paymentsService.findByUser(userId);
  }

  @Get(':id/receipt')
  @ApiOperation({ summary: 'Retrieve payment receipt' })
  getReceipt(@Param('id') id: string) {
    return this.paymentsService.getReceipt(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve payment details by ID' })
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update payment status' })
  updateStatus(
    @Param('id') id: string,
    @Body() updatePaymentStatusDto: UpdatePaymentStatusDto,
  ) {
    return this.paymentsService.updateStatus(id, updatePaymentStatusDto);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund a successful payment' })
  refund(@Param('id') id: string, @Body() refundPaymentDto: RefundPaymentDto) {
    return this.paymentsService.refund(id, refundPaymentDto);
  }
}
