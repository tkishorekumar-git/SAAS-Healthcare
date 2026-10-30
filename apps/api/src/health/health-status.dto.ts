import type { HealthStatus } from '@kenisha/shared';
import { ApiProperty } from '@nestjs/swagger';

/** Swagger representation of the shared HealthStatus contract. */
export class HealthStatusDto implements HealthStatus {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 'kenisha-api' })
  service!: string;

  @ApiProperty({ example: '0.1.0' })
  version!: string;

  @ApiProperty({ example: 'development' })
  environment!: string;

  @ApiProperty({ example: '2026-10-30T09:00:00.000Z', format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ example: 42 })
  uptimeSeconds!: number;
}
