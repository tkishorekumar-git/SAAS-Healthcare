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
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import type { PlatformAuthContext, RequestMeta } from '../auth/auth-context';
import { CurrentPlatformAuth, PlatformRoute } from '../auth/decorators';
import { PlatformTenantsService } from './platform-tenants.service';

class OnboardHospitalDto {
  @ApiProperty({
    example: 'city-care',
    description: 'Login code / subdomain: lower-case letters, digits, -',
  })
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: 'code must be lower-case letters, digits or -',
  })
  code!: string;

  @ApiProperty({ example: 'City Care Hospital' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'PROFESSIONAL' })
  @IsString()
  @MaxLength(50)
  planCode!: string;

  @ApiProperty({ example: 'Dr. Ravi Kumar' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  adminName!: string;

  @ApiProperty({ example: '+919812345678' })
  @IsString()
  @MaxLength(24)
  adminPhone!: string;

  @ApiPropertyOptional({ example: 'admin@citycare.example.test' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  adminEmail?: string;
}

class ChangePlanDto {
  @ApiProperty({ example: 'ENTERPRISE' })
  @IsString()
  @MaxLength(50)
  planCode!: string;
}

@ApiTags('platform: hospitals')
@ApiBearerAuth()
@PlatformRoute()
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  @ApiOperation({ summary: 'All hospitals with plan and usage counts (no staff or patient data)' })
  list() {
    return this.tenants.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Onboard a hospital',
    description:
      'Creates the hospital (ONBOARDING) and its subscription, and SMS-invites its first ' +
      'Hospital Admin. The hospital becomes ACTIVE when the admin accepts.',
  })
  onboard(
    @CurrentPlatformAuth() auth: PlatformAuthContext,
    @Body() dto: OnboardHospitalDto,
    @Req() req: Request,
  ) {
    return this.tenants.onboard(auth, dto, meta(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Hospital detail: plan history, usage, first-admin invitations' })
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tenants.detail(id);
  }

  @Post(':id/admin-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a new first-admin invitation (onboarding hospitals only)' })
  resendAdminInvitation(
    @CurrentPlatformAuth() auth: PlatformAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.tenants.resendAdminInvitation(auth, id, meta(req));
  }

  @Put(':id/plan')
  @ApiOperation({ summary: 'Move the hospital to another plan (new subscription from today)' })
  changePlan(
    @CurrentPlatformAuth() auth: PlatformAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangePlanDto,
    @Req() req: Request,
  ) {
    return this.tenants.changePlan(auth, id, dto.planCode, meta(req));
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend: blocks all logins and ends every session immediately' })
  suspend(
    @CurrentPlatformAuth() auth: PlatformAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.tenants.setSuspended(auth, id, true, meta(req));
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lift a suspension' })
  reactivate(
    @CurrentPlatformAuth() auth: PlatformAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return this.tenants.setSuspended(auth, id, false, meta(req));
  }
}

function meta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}
