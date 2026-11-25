import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({ summary: 'Service and database health check' })
  async getHealth() {
    let database = 'connected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'disconnected';
    }

    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      service: 'payment-billing-service',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
