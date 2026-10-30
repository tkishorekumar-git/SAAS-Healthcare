import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  IsEmail,
  IsInt,
  IsJWT,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';
import type { PlatformAuthContext, RequestMeta } from '../auth/auth-context';
import { CurrentPlatformAuth, PlatformRoute, Public } from '../auth/decorators';
import type { Env } from '../config/env.validation';
import { PlatformAuthService } from './platform-auth.service';
import type { IssuedPlatformSession } from './platform-session.service';
import { PlatformSessionService } from './platform-session.service';
import { PlatformSupportAccessService } from './platform-support-access.service';

export const PLATFORM_REFRESH_COOKIE = 'kenisha_prt';

const loginThrottle = () =>
  Throttle({
    default: { limit: () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 10), ttl: 60_000 },
  });

// --- DTOs ------------------------------------------------------------------------------

class PlatformLoginDto {
  @ApiProperty({ example: 'super.admin@example.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

class PlatformCodeDto {
  @ApiProperty({ description: 'mfaToken returned by the password step' })
  @IsJWT()
  mfaToken!: string;

  @ApiProperty({ example: '123456', description: 'Code from the authenticator app' })
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

class MfaChallengeDto {
  @ApiProperty() mfaToken!: string;
  @ApiProperty({ example: 300 }) expiresInSeconds!: number;
}

class PlatformTokensDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ format: 'date-time' }) accessTokenExpiresAt!: string;
}

class PlatformMeDto {
  @ApiProperty({ format: 'uuid' }) platformUserId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['SUPER_ADMIN'], isArray: true }) roles!: ['SUPER_ADMIN'];
}

class CreateSupportAccessDto {
  @ApiProperty({ example: 'demo-aarogya' })
  @IsString()
  @Matches(/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/, {
    message: 'hospitalCode is not a valid hospital code',
  })
  hospitalCode!: string;

  @ApiProperty({
    example: 'Ticket SUP-1042: branch list not loading for the hospital admin',
    description: 'Shown to the Hospital Admin who decides. 20-1000 characters. No patient data.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({ example: 60, minimum: 15, maximum: 240 })
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes!: number;
}

class SupportAccessTokenDto {
  @ApiProperty({ description: 'Use as Bearer token on read-only hospital endpoints' })
  accessToken!: string;
  @ApiProperty({ format: 'date-time' }) accessTokenExpiresAt!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
}

// --- Controllers -----------------------------------------------------------------------

@ApiTags('platform: auth')
@PlatformRoute()
@Controller('platform/auth')
export class PlatformAuthController {
  private readonly cookiePath: string;
  private readonly cookieSecure: boolean;

  constructor(
    private readonly auth: PlatformAuthService,
    private readonly sessions: PlatformSessionService,
    config: ConfigService<Env, true>,
  ) {
    this.cookiePath = `/${config.get('API_GLOBAL_PREFIX', { infer: true })}/v1/platform/auth`;
    this.cookieSecure = config.get('AUTH_COOKIE_SECURE', { infer: true });
  }

  @Public()
  @loginThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Super Admin step 1: email + password' })
  @ApiOkResponse({ type: MfaChallengeDto })
  login(@Body() dto: PlatformLoginDto, @Req() req: Request): Promise<MfaChallengeDto> {
    return this.auth.login(dto.email, dto.password, meta(req));
  }

  @Public()
  @loginThrottle()
  @Post('totp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Super Admin step 2: authenticator app code' })
  @ApiOkResponse({ type: PlatformTokensDto })
  async verify(
    @Body() dto: PlatformCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformTokensDto> {
    return this.respond(await this.auth.verifyCode(dto.mfaToken, dto.code, meta(req)), res);
  }

  @Public()
  @loginThrottle()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the Super Admin refresh cookie' })
  @ApiOkResponse({ type: PlatformTokensDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformTokensDto> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[PLATFORM_REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Your session has ended. Please log in again.');
    }
    try {
      return this.respond(await this.sessions.refresh(token, meta(req)), res);
    } catch (error) {
      res.clearCookie(PLATFORM_REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End the Super Admin session' })
  async logout(
    @CurrentPlatformAuth() auth: PlatformAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revoke(auth, meta(req));
    res.clearCookie(PLATFORM_REFRESH_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in Super Admin' })
  @ApiOkResponse({ type: PlatformMeDto })
  me(@CurrentPlatformAuth() auth: PlatformAuthContext): Promise<PlatformMeDto> {
    return this.auth.me(auth);
  }

  /** The Super Admin console is web-only: refresh token only ever in an HttpOnly cookie. */
  private respond(session: IssuedPlatformSession, res: Response): PlatformTokensDto {
    res.cookie(PLATFORM_REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieOptions(),
      expires: session.refreshTokenExpiresAt,
    });
    return {
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    };
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.cookieSecure, sameSite: 'strict', path: this.cookiePath };
  }
}

@ApiTags('platform: support access')
@ApiBearerAuth()
@PlatformRoute()
@Controller('platform/support-access')
export class PlatformSupportAccessController {
  constructor(private readonly supportAccess: PlatformSupportAccessService) {}

  @Post()
  @ApiOperation({ summary: 'Ask a hospital for temporary read-only access (break-glass)' })
  @ApiCreatedResponse({ description: 'Request created; the hospital must approve it' })
  request(
    @CurrentPlatformAuth() auth: PlatformAuthContext,
    @Body() dto: CreateSupportAccessDto,
    @Req() req: Request,
  ) {
    return this.supportAccess.request(
      auth,
      dto.hospitalCode,
      dto.reason,
      dto.durationMinutes,
      meta(req),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Support access requests across hospitals (latest 100)' })
  list() {
    return this.supportAccess.list();
  }

  @Post(':id/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a short-lived token for an approved request',
    description: 'Read-only, expires with the grant, and every use is logged for the hospital.',
  })
  @ApiOkResponse({ type: SupportAccessTokenDto })
  async token(
    @CurrentPlatformAuth() auth: PlatformAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<SupportAccessTokenDto> {
    const token = await this.supportAccess.issueToken(auth, id, meta(req));
    return { ...token, accessTokenExpiresAt: token.accessTokenExpiresAt.toISOString() };
  }
}

function meta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}
