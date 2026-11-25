import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';

@ApiTags('Invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post(':paymentId')
  @ApiOperation({ summary: 'Generate an invoice for a successful payment' })
  @ApiResponse({ status: 201, description: 'Invoice generated (or returned if already exists)' })
  generateForPayment(@Param('paymentId') paymentId: string) {
    return this.invoicesService.generateForPayment(paymentId);
  }

  @Get('payment/:paymentId')
  @ApiOperation({ summary: 'Retrieve invoice by payment ID' })
  @ApiResponse({ status: 200, description: 'Invoice found' })
  findByPaymentId(@Param('paymentId') paymentId: string) {
    return this.invoicesService.findByPaymentId(paymentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve invoice details by invoice ID' })
  @ApiResponse({ status: 200, description: 'Invoice found' })
  findOne(@Param('id') id: string) {
    return this.invoicesService.findOne(id);
  }
}
