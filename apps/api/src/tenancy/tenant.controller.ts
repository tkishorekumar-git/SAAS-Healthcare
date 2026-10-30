import { HEALTHCARE_MODULE_KEYS, type HealthcareModuleKey } from '@kenisha/shared';
import { BadRequestException, Body, Controller, Get, Patch, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../auth/decorators';
import { TenantDatabase } from '../database/tenant-database.service';
import { PlanLimitsService } from './plan-limits.service';

const SCOPE_MODES = ['TENANT_WIDE', 'ASSIGNED_BRANCHES'] as const;
const MFA_MODES = ['ALL_STAFF', 'ADMINS_ONLY'] as const;

class UpdateTenantSettingsDto {
  @ApiPropertyOptional({ example: 'Aarogya Hospital' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: SCOPE_MODES })
  @IsOptional()
  @IsIn(SCOPE_MODES)
  branchScopeMode?: (typeof SCOPE_MODES)[number];

  @ApiPropertyOptional({ enum: MFA_MODES })
  @IsOptional()
  @IsIn(MFA_MODES)
  staffMfaMode?: (typeof MFA_MODES)[number];
}

class PlanDto {
  @ApiProperty({ nullable: true }) code!: string | null;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty({ nullable: true, enum: ['TRIALING', 'ACTIVE', 'PAST_DUE'] })
  subscriptionStatus!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) currentPeriodEnd!: Date | null;
  @ApiProperty() maxBranches!: number;
  @ApiProperty() maxStaffUsers!: number;
  @ApiProperty({ enum: HEALTHCARE_MODULE_KEYS, isArray: true })
  enabledModules!: HealthcareModuleKey[];
  @ApiProperty({ description: 'False when new staff/branches cannot be added' })
  canGrow!: boolean;
}

class UsageDto {
  @ApiProperty() activeBranches!: number;
  @ApiProperty() activeStaff!: number;
  @ApiProperty() pendingInvitations!: number;
}

class TenantOverviewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ONBOARDING', 'ACTIVE', 'SUSPENDED'] }) status!: string;
  @ApiProperty({ enum: SCOPE_MODES }) branchScopeMode!: string;
  @ApiProperty({ enum: MFA_MODES }) staffMfaMode!: string;
  @ApiProperty({ type: PlanDto }) plan!: PlanDto;
  @ApiProperty({ type: UsageDto }) usage!: UsageDto;
}

@ApiTags('hospital')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(
    private readonly db: TenantDatabase,
    private readonly limits: PlanLimitsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('tenant:read')
  @ApiOperation({ summary: 'This hospital: settings, plan and usage' })
  @ApiOkResponse({ type: TenantOverviewDto })
  overview(@CurrentAuth() auth: AuthContext): Promise<TenantOverviewDto> {
    return this.db.run(auth.tenantId, (tx) => this.load(tx, auth));
  }

  @Patch()
  @RequirePermissions('tenant:settings')
  @ApiOperation({ summary: 'Change hospital name, branch scope or staff SMS-factor mode' })
  @ApiOkResponse({ type: TenantOverviewDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateTenantSettingsDto,
    @Req() req: Request,
  ): Promise<TenantOverviewDto> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as UpdateTenantSettingsDto;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to change.');
    }
    return this.db.run(auth.tenantId, async (tx) => {
      await tx.tenant.update({ where: { id: auth.tenantId }, data: changes });
      await this.audit.record(tx, auth.tenantId, {
        action: 'TENANT_SETTINGS_CHANGED',
        outcome: 'SUCCESS',
        actorUserId: auth.userId,
        targetType: 'tenant',
        targetId: auth.tenantId,
        metadata: { fields: Object.keys(changes).join(',') },
        request: { ip: req.ip, userAgent: req.get('user-agent') },
      });
      return this.load(tx, auth);
    });
  }

  private async load(
    tx: Parameters<Parameters<TenantDatabase['run']>[1]>[0],
    auth: AuthContext,
  ): Promise<TenantOverviewDto> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
    const [plan, usage] = await Promise.all([this.limits.limits(tx), this.limits.usage(tx)]);
    return {
      id: tenant.id,
      code: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      branchScopeMode: tenant.branchScopeMode,
      staffMfaMode: tenant.staffMfaMode,
      plan: {
        code: plan.planCode,
        name: plan.planName,
        subscriptionStatus: plan.subscriptionStatus,
        currentPeriodEnd: plan.currentPeriodEnd,
        maxBranches: plan.maxBranches,
        maxStaffUsers: plan.maxStaffUsers,
        enabledModules: plan.enabledModules,
        canGrow: plan.canGrow,
      },
      usage,
    };
  }
}
