import { STAFF_ROLES, type StaffRole } from '@kenisha/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Request } from 'express';
import type { AuthContext, RequestMeta } from '../auth/auth-context';
import { CurrentAuth, Public, RequirePermissions } from '../auth/decorators';
import { type InvitationView, InvitationsService } from './invitations.service';
import { type StaffMemberView, StaffService } from './staff.service';

const HOSPITAL_CODE = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

// --- DTOs ------------------------------------------------------------------------------

class InviteStaffDto {
  @ApiProperty({ example: 'Dr. Asha Menon' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  displayName!: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @MaxLength(24)
  phone!: string;

  @ApiPropertyOptional({ example: 'asha.menon@example.test' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiProperty({ enum: STAFF_ROLES, isArray: true, example: ['DOCTOR'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsIn(STAFF_ROLES, { each: true })
  roles!: StaffRole[];

  @ApiProperty({ type: [String], format: 'uuid', example: [] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  branchIds!: string[];
}

class SetRolesDto {
  @ApiProperty({ enum: STAFF_ROLES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsIn(STAFF_ROLES, { each: true })
  roles!: StaffRole[];
}

class SetBranchesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  branchIds!: string[];
}

class InvitationTokenDto {
  @ApiProperty({ example: 'demo-aarogya' })
  @IsString()
  @Matches(HOSPITAL_CODE, { message: 'hospitalCode is not a valid hospital code' })
  hospitalCode!: string;

  @ApiProperty({ description: 'Token from the invitation link' })
  @IsString()
  @MaxLength(64)
  token!: string;
}

class AcceptInvitationDto extends InvitationTokenDto {
  @ApiProperty({ format: 'password', description: 'At least 12 characters, not common' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

class StaffMemberDto implements StaffMemberView {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() phoneE164!: string;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ enum: STAFF_ROLES, isArray: true }) roles!: StaffRole[];
  @ApiProperty({ type: [String], format: 'uuid' }) branchIds!: string[];
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: 'ACTIVE' | 'DISABLED';
  @ApiProperty() locked!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

class InvitationDto implements InvitationView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() phoneE164!: string;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ enum: STAFF_ROLES, isArray: true }) roles!: StaffRole[];
  @ApiProperty({ type: [String], format: 'uuid' }) branchIds!: string[];
  @ApiProperty({ enum: ['PENDING', 'EXPIRED', 'ACCEPTED', 'REVOKED'] })
  status!: InvitationView['status'];
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
  @ApiProperty({ enum: ['HOSPITAL', 'KENISHA'] }) invitedBy!: 'HOSPITAL' | 'KENISHA';
  @ApiProperty({ format: 'uuid', nullable: true }) acceptedUserId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

class InvitationPreviewDto {
  @ApiProperty() hospitalName!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: STAFF_ROLES, isArray: true }) roles!: StaffRole[];
  @ApiProperty({ example: '******3210' }) phone!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
}

class AcceptedDto {
  @ApiProperty() hospitalCode!: string;
  @ApiProperty() displayName!: string;
}

// --- Controllers -----------------------------------------------------------------------

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('staff:read')
  @ApiOperation({ summary: 'All staff accounts of this hospital' })
  @ApiOkResponse({ type: StaffMemberDto, isArray: true })
  list(@CurrentAuth() auth: AuthContext): Promise<StaffMemberDto[]> {
    return this.staff.list(auth);
  }

  @Put(':userId/roles')
  @RequirePermissions('staff:manage')
  @ApiOperation({ summary: 'Replace roles (ends the person’s sessions)' })
  @ApiOkResponse({ type: StaffMemberDto })
  setRoles(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: SetRolesDto,
    @Req() req: Request,
  ): Promise<StaffMemberDto> {
    return this.staff.setRoles(auth, userId, dto.roles, meta(req));
  }

  @Put(':userId/branches')
  @RequirePermissions('staff:manage')
  @ApiOperation({ summary: 'Replace branch assignments' })
  @ApiOkResponse({ type: StaffMemberDto })
  setBranches(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: SetBranchesDto,
    @Req() req: Request,
  ): Promise<StaffMemberDto> {
    return this.staff.setBranches(auth, userId, dto.branchIds, meta(req));
  }

  @Post(':userId/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('staff:manage')
  @ApiOperation({ summary: 'Disable an account (ends its sessions at once)' })
  @ApiOkResponse({ type: StaffMemberDto })
  disable(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ): Promise<StaffMemberDto> {
    return this.staff.disable(auth, userId, meta(req));
  }

  @Post(':userId/enable')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('staff:manage')
  @ApiOperation({ summary: 'Re-enable an account (counts against the plan)' })
  @ApiOkResponse({ type: StaffMemberDto })
  enable(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ): Promise<StaffMemberDto> {
    return this.staff.enable(auth, userId, meta(req));
  }

  @Post(':userId/unlock')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('staff:manage')
  @ApiOperation({ summary: 'Clear a lockout after too many failed logins' })
  @ApiOkResponse({ type: StaffMemberDto })
  unlock(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ): Promise<StaffMemberDto> {
    return this.staff.unlock(auth, userId, meta(req));
  }
}

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff-invitations')
export class StaffInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @RequirePermissions('staff:manage')
  @ApiOperation({ summary: 'Invite a staff member by SMS (counts against the plan)' })
  @ApiCreatedResponse({ type: InvitationDto })
  invite(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: InviteStaffDto,
    @Req() req: Request,
  ): Promise<InvitationDto> {
    return this.invitations.invite(auth, dto, meta(req));
  }

  @Get()
  @RequirePermissions('staff:read')
  @ApiOperation({ summary: 'Invitations of this hospital (latest 200)' })
  @ApiOkResponse({ type: InvitationDto, isArray: true })
  list(@CurrentAuth() auth: AuthContext): Promise<InvitationDto[]> {
    return this.invitations.list(auth);
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('staff:manage')
  @ApiOperation({ summary: 'Send a new link (the old one stops working)' })
  @ApiOkResponse({ type: InvitationDto })
  resend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<InvitationDto> {
    return this.invitations.resend(auth, id, meta(req));
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('staff:manage')
  @ApiOperation({ summary: 'Cancel a pending invitation' })
  @ApiOkResponse({ type: InvitationDto })
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<InvitationDto> {
    return this.invitations.revoke(auth, id, meta(req));
  }
}

/** Public endpoints used by the invitation link. */
@ApiTags('auth')
@Controller('auth/invitations')
export class InvitationAcceptanceController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Throttle({
    default: { limit: () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 10), ttl: 60_000 },
  })
  @Post('inspect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Show who an invitation is for (phone masked)' })
  @ApiOkResponse({ type: InvitationPreviewDto })
  inspect(@Body() dto: InvitationTokenDto): Promise<InvitationPreviewDto> {
    return this.invitations.inspect(dto.hospitalCode, dto.token);
  }

  @Public()
  @Throttle({
    default: { limit: () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 10), ttl: 60_000 },
  })
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a password and activate the staff account' })
  @ApiOkResponse({ type: AcceptedDto })
  accept(@Body() dto: AcceptInvitationDto, @Req() req: Request): Promise<AcceptedDto> {
    return this.invitations.accept(dto.hospitalCode, dto.token, dto.password, meta(req));
  }
}

function meta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}
