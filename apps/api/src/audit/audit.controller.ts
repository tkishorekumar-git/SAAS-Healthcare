import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../auth/decorators';
import { TenantDatabase } from '../database/tenant-database.service';

class AuditEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() action!: string;
  @ApiProperty({ enum: ['SUCCESS', 'FAILURE'] }) outcome!: 'SUCCESS' | 'FAILURE';
  @ApiProperty({ format: 'uuid', nullable: true }) actorUserId!: string | null;
  @ApiProperty({ nullable: true }) targetType!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) targetId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-events')
export class AuditController {
  constructor(private readonly db: TenantDatabase) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Latest 100 security audit events of the current hospital' })
  @ApiOkResponse({ type: AuditEventDto, isArray: true })
  list(@CurrentAuth() auth: AuthContext): Promise<AuditEventDto[]> {
    return this.db.run(auth.tenantId, (tx) =>
      tx.auditEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          action: true,
          outcome: true,
          actorUserId: true,
          targetType: true,
          targetId: true,
          createdAt: true,
        },
      }),
    );
  }
}
