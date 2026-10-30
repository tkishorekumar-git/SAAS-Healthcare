import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth, RequirePermissions } from '../auth/decorators';
import { SupportAccessService, type SupportAccessRequestView } from './support-access.service';

class SupportAccessRequestDto implements SupportAccessRequestView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() requesterName!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() requestedMinutes!: number;
  @ApiProperty({ enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED'] })
  status!: SupportAccessRequestView['status'];
  @ApiProperty({ description: 'True only while an approval is in force' }) active!: boolean;
  @ApiProperty({ format: 'uuid', nullable: true }) decidedByUserId!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true }) decidedAt!: Date | null;
  @ApiProperty({ format: 'date-time', nullable: true }) approvedUntil!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

/** Hospital Admins decide whether Kenisha support may enter their hospital (break-glass). */
@ApiTags('support access')
@ApiBearerAuth()
@Controller('support-access-requests')
export class SupportAccessController {
  constructor(private readonly supportAccess: SupportAccessService) {}

  @Get()
  @RequirePermissions('support_access:manage')
  @ApiOperation({ summary: 'Support access requests for this hospital (latest 100)' })
  @ApiOkResponse({ type: SupportAccessRequestDto, isArray: true })
  list(@CurrentAuth() auth: AuthContext): Promise<SupportAccessRequestDto[]> {
    return this.supportAccess.list(auth);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('support_access:manage')
  @ApiOperation({ summary: 'Approve for the requested duration (max 4 hours), starting now' })
  @ApiOkResponse({ type: SupportAccessRequestDto })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<SupportAccessRequestDto> {
    return this.supportAccess.approve(auth, id, meta(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('support_access:manage')
  @ApiOperation({ summary: 'Reject a pending request' })
  @ApiOkResponse({ type: SupportAccessRequestDto })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<SupportAccessRequestDto> {
    return this.supportAccess.reject(auth, id, meta(req));
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('support_access:manage')
  @ApiOperation({ summary: 'End an approved grant immediately' })
  @ApiOkResponse({ type: SupportAccessRequestDto })
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<SupportAccessRequestDto> {
    return this.supportAccess.revoke(auth, id, meta(req));
  }
}

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}
