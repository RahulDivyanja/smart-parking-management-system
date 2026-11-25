import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new review and rating' })
  @ApiResponse({ status: 201, description: 'Review created' })
  @ApiResponse({
    status: 409,
    description: 'Duplicate review for reservation',
  })
  create(@Body() createReviewDto: CreateReviewDto) {
    return this.reviewsService.create(createReviewDto);
  }

  @Get('facility/:facilityId/rating')
  @ApiOperation({ summary: 'Retrieve average rating for a parking facility' })
  getFacilityRating(@Param('facilityId') facilityId: string) {
    return this.reviewsService.getFacilityRating(facilityId);
  }

  @Get('facility/:facilityId/summary')
  @ApiOperation({
    summary: 'Retrieve rating summary and star breakdown for a facility',
  })
  getFacilitySummary(@Param('facilityId') facilityId: string) {
    return this.reviewsService.getFacilitySummary(facilityId);
  }

  @Get('facility/:facilityId')
  @ApiOperation({ summary: 'Retrieve active reviews for a parking facility' })
  findByFacility(@Param('facilityId') facilityId: string) {
    return this.reviewsService.findByFacility(facilityId);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Retrieve reviews submitted by a user' })
  findByUser(@Param('userId') userId: string) {
    return this.reviewsService.findByUser(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a specific review by ID' })
  findOne(@Param('id') id: string) {
    return this.reviewsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a review' })
  update(@Param('id') id: string, @Body() updateReviewDto: UpdateReviewDto) {
    return this.reviewsService.update(id, updateReviewDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a review' })
  remove(@Param('id') id: string) {
    return this.reviewsService.remove(id);
  }
}
