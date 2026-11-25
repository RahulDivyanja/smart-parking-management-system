import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({ example: 'Reservation cancelled by user' })
  @IsOptional()
  @IsString()
  reason?: string;
}
