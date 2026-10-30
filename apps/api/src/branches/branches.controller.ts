import { HOSPITAL_ADMIN_ROLES } from '@kenisha/shared';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../auth/decorators';
import { TenantDatabase } from '../database/tenant-database.service';

class BranchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
  @ApiProperty() isActive!: boolean;
}

const PERSONAL_ROLES = new Set(['PATIENT', 'PARENT_GUARDIAN']);

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly db: TenantDatabase) {}

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
        select: { id: true, code: true, name: true, city: true, state: true, isActive: true },
      });
    });
  }
}
