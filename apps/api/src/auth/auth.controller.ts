import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env.validation';
import type { AuthContext, RequestMeta } from './auth-context';
import { AuthService } from './auth.service';
import { CurrentAuth, Public } from './decorators';
import {
  ChallengeResponseDto,
  CurrentUserDto,
  RefreshDto,
  RequestCodeDto,
  StaffCodeDto,
  StaffLoginDto,
  StaffLoginResponseDto,
  TokensResponseDto,
  VerifyCodeDto,
} from './dto';
import type { IssuedSession } from './session.service';
import { SessionService } from './session.service';

export const REFRESH_COOKIE = 'kenisha_rt';

/** Per-IP limit on login endpoints; resolved per request so the validated env applies. */
const authThrottle = () =>
  Throttle({
    default: {
      limit: () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 10),
      ttl: 60_000,
    },
  });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookiePath: string;
  private readonly cookieSecure: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    config: ConfigService<Env, true>,
  ) {
    this.cookiePath = `/${config.get('API_GLOBAL_PREFIX', { infer: true })}/v1/auth`;
    this.cookieSecure = config.get('AUTH_COOKIE_SECURE', { infer: true });
  }

  @Public()
  @authThrottle()
  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Patients/guardians: send a login code by SMS',
    description: 'Always returns 202 with the same shape, whether or not the number is registered.',
  })
  @ApiAcceptedResponse({ type: ChallengeResponseDto })
  requestCode(@Body() dto: RequestCodeDto, @Req() req: Request): Promise<ChallengeResponseDto> {
    return this.auth.requestPersonalCode(dto.hospitalCode, dto.phone, meta(req));
  }

  @Public()
  @authThrottle()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Patients/guardians: verify the SMS code and start a session' })
  @ApiOkResponse({ type: TokensResponseDto })
  async verifyCode(
    @Body() dto: VerifyCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokensResponseDto> {
    const session = await this.auth.verifyPersonalCode(
      dto.hospitalCode,
      dto.challengeId,
      dto.code,
      dto.client,
      meta(req),
    );
    return this.respondWithSession(session, res);
  }

  @Public()
  @authThrottle()
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff: password step (usually followed by an SMS code)' })
  @ApiOkResponse({ type: StaffLoginResponseDto })
  async staffLogin(
    @Body() dto: StaffLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaffLoginResponseDto> {
    const result = await this.auth.staffLogin(
      dto.hospitalCode,
      dto.identifier,
      dto.password,
      dto.client,
      meta(req),
    );
    if (result.status === 'MFA_REQUIRED') {
      return result;
    }
    return { status: 'AUTHENTICATED', tokens: this.respondWithSession(result.session, res) };
  }

  @Public()
  @authThrottle()
  @Post('staff/mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff: verify the SMS second factor and start a session' })
  @ApiOkResponse({ type: TokensResponseDto })
  async verifyStaffCode(
    @Body() dto: StaffCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokensResponseDto> {
    const session = await this.auth.verifyStaffCode(
      dto.hospitalCode,
      dto.challengeId,
      dto.code,
      dto.client,
      meta(req),
    );
    return this.respondWithSession(session, res);
  }

  @Public()
  @authThrottle()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token and get a new access token',
    description: 'Web sends the HttpOnly cookie; mobile sends refreshToken in the body.',
  })
  @ApiOkResponse({ type: TokensResponseDto })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokensResponseDto> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const token = dto.refreshToken ?? cookies?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Your session has ended. Please log in again.');
    }
    try {
      return this.respondWithSession(await this.sessions.refresh(token, meta(req)), res);
    } catch (error) {
      this.clearCookie(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End the current session' })
  @ApiNoContentResponse()
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revoke(auth, meta(req));
    this.clearCookie(res);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End every session of the current user on all devices' })
  @ApiNoContentResponse()
  async logoutAll(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revokeAllForUser(auth, meta(req));
    this.clearCookie(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user, roles and permissions' })
  @ApiOkResponse({ type: CurrentUserDto })
  me(@CurrentAuth() auth: AuthContext): Promise<CurrentUserDto> {
    return this.auth.currentUser(auth);
  }

  /** Web: refresh token only in an HttpOnly cookie. Mobile: in the body. */
  private respondWithSession(session: IssuedSession, res: Response): TokensResponseDto {
    const body: TokensResponseDto = {
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    };
    if (session.client === 'mobile') {
      body.refreshToken = session.refreshToken;
      return body;
    }
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieOptions(),
      expires: session.refreshTokenExpiresAt,
    });
    return body;
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.cookieSecure, sameSite: 'strict', path: this.cookiePath };
  }
}

function meta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}
