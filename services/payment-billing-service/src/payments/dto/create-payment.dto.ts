import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({
    example: 'res-1001',
    description: 'Related parking reservation ID',
  })
  @IsString()
  @IsNotEmpty()
  reservationId: string;

  @ApiProperty({ example: 'user-501', description: 'User making the payment' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: 15.5, description: 'Payment amount (> 0)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CARD })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({
    enum: ['SUCCESS', 'FAILED'],
    default: 'SUCCESS',
    description: 'Simulated gateway outcome for academic demo & testing',
  })
  @IsOptional()
  @IsIn(['SUCCESS', 'FAILED'])
  simulateOutcome?: 'SUCCESS' | 'FAILED';
}
