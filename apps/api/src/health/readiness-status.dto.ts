import type { DependencyState, ReadinessStatus } from '@kenisha/shared';
import { ApiProperty } from '@nestjs/swagger';

const DEPENDENCY_STATES: DependencyState[] = ['up', 'down', 'misconfigured'];

class ReadinessChecksDto {
  @ApiProperty({ enum: DEPENDENCY_STATES, example: 'up' })
  database!: DependencyState;

  @ApiProperty({ enum: DEPENDENCY_STATES, example: 'up' })
  platformDatabase!: DependencyState;
}

/** Swagger representation of the shared ReadinessStatus contract. */
export class ReadinessStatusDto implements ReadinessStatus {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: 'ok' | 'error';

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;

  @ApiProperty({ example: '2026-10-30T09:00:00.000Z', format: 'date-time' })
  timestamp!: string;
}
