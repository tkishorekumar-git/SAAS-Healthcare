import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { HealthStatusDto } from './health-status.dto';
import { HealthService } from './health.service';
import { ReadinessStatusDto } from './readiness-status.dto';

@ApiTags('health')
@SkipThrottle()
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: HealthStatusDto })
  getHealth(): HealthStatusDto {
    return this.healthService.getStatus();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — database reachable and safely configured' })
  @ApiOkResponse({ type: ReadinessStatusDto })
  @ApiServiceUnavailableResponse({ type: ReadinessStatusDto })
  async getReadiness(): Promise<ReadinessStatusDto> {
    const readiness = await this.healthService.getReadiness();
    if (readiness.status !== 'ok') {
      throw new ServiceUnavailableException(readiness);
    }
    return readiness;
  }
}
