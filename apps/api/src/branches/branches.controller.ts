import type { TenantTransaction } from '@kenisha/database';
import { HOSPITAL_ADMIN_ROLES } from '@kenisha/shared';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { type AuditAction, AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../auth/decorators';
import { TenantDatabase } from '../database/tenant-database.service';
import { PlanLimitsService } from '../tenancy/plan-limits.service';

const BRANCH_SELECT = {
  id: true,
  code: true,
  name: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  countryCode: true,
  phone: true,
  isActive: true,
} as const;

class BranchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) addressLine1!: string | null;
  @ApiProperty({ nullable: true }) addressLine2!: string | null;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
  @ApiProperty({ nullable: true }) postalCode!: string | null;
  @ApiProperty() countryCode!: string;
  @ApiProperty({ nullable: true }) phone!: string | null;
  @ApiProperty() isActive!: boolean;
}

class CreateBranchDto {
  @ApiProperty({ example: 'BLR-02', description: 'Short code, unique in this hospital' })
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,31}$/, {
    message: 'code must be 1-32 upper-case letters, digits or -',
  })
  code!: string;

  @ApiProperty({ example: 'Whitefield Clinic' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) addressLine2?: string;

  @ApiProperty({ example: 'Bengaluru' }) @IsString() @MinLength(2) @MaxLength(100) city!: string;
  @ApiProperty({ example: 'Karnataka' }) @IsString() @MinLength(2) @MaxLength(100) state!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) postalCode?: string;

  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be ISO 3166-1 alpha-2' })
  countryCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
}

class UpdateBranchDto extends PartialType(CreateBranchDto) {}

const PERSONAL_ROLES = new Set(['PATIENT', 'PARENT_GUARDIAN']);

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(
    private readonly db: TenantDatabase,
    private readonly limits: PlanLimitsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('branch:read')
  @ApiOperation({
    summary: 'Branches of the current hospital visible to the caller',
    description:
      'In ASSIGNED_BRANCHES mode, staff other than Hospital Admin / Management see only ' +
      'branches they are assigned to (ADR-0002, D3).',
  })
  @ApiOkResponse({ type: BranchDto, isArray: true })
  list(@CurrentAuth() auth: AuthContext): Promise<BranchDto[]> {
    return this.db.run(auth.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { branchScopeMode: true },
      });
      // Break-glass support sees what a Hospital Admin sees (read-only by permission).
      const isAdmin =
        auth.supportAccess !== undefined ||
        auth.roles.some((role) => HOSPITAL_ADMIN_ROLES.includes(role));
      const isPersonal =
        auth.roles.length > 0 && auth.roles.every((role) => PERSONAL_ROLES.has(role));
      const restricted = tenant.branchScopeMode === 'ASSIGNED_BRANCHES' && !isAdmin && !isPersonal;

      return tx.branch.findMany({
        where: {
          ...(isPersonal ? { isActive: true } : {}),
          ...(restricted ? { staffAssignments: { some: { userId: auth.userId } } } : {}),
        },
        orderBy: { code: 'asc' },
        select: BRANCH_SELECT,
      });
    });
  }

  @Post()
  @RequirePermissions('branch:manage')
  @ApiOperation({ summary: 'Add a branch (counts against the plan)' })
  @ApiCreatedResponse({ type: BranchDto })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateBranchDto,
    @Req() req: Request,
  ): Promise<BranchDto> {
    return this.db.run(auth.tenantId, async (tx) => {
      await this.limits.assertCanAddBranch(tx, auth.tenantId);
      await this.assertCodeFree(tx, dto.code);
      const branch = await tx.branch.create({
        data: { ...dto, tenantId: auth.tenantId },
        select: BRANCH_SELECT,
      });
      await this.record(tx, auth, req, 'BRANCH_CREATED', branch.id);
      return branch;
    });
  }

  @Patch(':id')
  @RequirePermissions('branch:manage')
  @ApiOperation({ summary: 'Edit branch details' })
  @ApiOkResponse({ type: BranchDto })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: Request,
  ): Promise<BranchDto> {
    const changes = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to change.');
    }
    return this.db.run(auth.tenantId, async (tx) => {
      const existing = await this.find(tx, id);
      if (dto.code && dto.code !== existing.code) {
        await this.assertCodeFree(tx, dto.code);
      }
      const branch = await tx.branch.update({
        where: { id },
        data: changes,
        select: BRANCH_SELECT,
      });
      await this.record(tx, auth, req, 'BRANCH_UPDATED', id, {
        fields: Object.keys(changes).join(','),
      });
      return branch;
    });
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('branch:manage')
  @ApiOperation({ summary: 'Deactivate a branch (history is kept; never deleted)' })
  @ApiOkResponse({ type: BranchDto })
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<BranchDto> {
    return this.setActive(auth, id, false, req);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('branch:manage')
  @ApiOperation({ summary: 'Reactivate a branch (counts against the plan)' })
  @ApiOkResponse({ type: BranchDto })
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<BranchDto> {
    return this.setActive(auth, id, true, req);
  }

  private setActive(
    auth: AuthContext,
    id: string,
    active: boolean,
    req: Request,
  ): Promise<BranchDto> {
    return this.db.run(auth.tenantId, async (tx) => {
      const existing = await this.find(tx, id);
      if (existing.isActive === active) {
        throw new ConflictException(`This branch is already ${active ? 'active' : 'inactive'}.`);
      }
      if (active) {
        await this.limits.assertCanAddBranch(tx, auth.tenantId);
      }
      const branch = await tx.branch.update({
        where: { id },
        data: { isActive: active },
        select: BRANCH_SELECT,
      });
      await this.record(tx, auth, req, active ? 'BRANCH_REACTIVATED' : 'BRANCH_DEACTIVATED', id);
      return branch;
    });
  }

  private async find(tx: TenantTransaction, id: string) {
    const branch = await tx.branch.findUnique({ where: { id }, select: BRANCH_SELECT });
    if (!branch) {
      throw new NotFoundException('No branch with that ID.');
    }
    return branch;
  }

  private async assertCodeFree(tx: TenantTransaction, code: string) {
    if (await tx.branch.findFirst({ where: { code }, select: { id: true } })) {
      throw new ConflictException(`Branch code ${code} is already used in this hospital.`);
    }
  }

  private record(
    tx: TenantTransaction,
    auth: AuthContext,
    req: Request,
    action: AuditAction,
    branchId: string,
    metadata?: Record<string, string>,
  ) {
    return this.audit.record(tx, auth.tenantId, {
      action,
      outcome: 'SUCCESS',
      actorUserId: auth.userId,
      targetType: 'branch',
      targetId: branchId,
      ...(metadata ? { metadata } : {}),
      request: { ip: req.ip, userAgent: req.get('user-agent') },
    });
  }
}
