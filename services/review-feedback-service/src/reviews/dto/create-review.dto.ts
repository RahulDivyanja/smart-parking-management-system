import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({
    example: 'user-501',
    description: 'User submitting the review',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    example: 'facility-101',
    description: 'Parking facility being reviewed',
  })
  @IsString()
  @IsNotEmpty()
  facilityId: string;

  @ApiProperty({
    example: 'res-1001',
    description: 'Completed parking reservation ID',
  })
  @IsString()
  @IsNotEmpty()
  reservationId: string;

  @ApiProperty({
    example: 5,
    minimum: 1,
    maximum: 5,
    description: 'Star rating (1-5)',
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    example: 'Clean parking lot, easy entry and exit.',
    description: 'Optional written feedback',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
