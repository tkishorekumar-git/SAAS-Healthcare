import { type Permission, SUPPORT_ACCESS_PERMISSIONS, hasPermissions } from '@kenisha/shared';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PlatformSessionService } from '../platform/platform-session.service';
import { SupportAccessService } from '../support-access/support-access.service';
import { InvalidTokenError } from './crypto/ed25519-jwt';
import { IS_PLATFORM, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * Global, deny-by-default authentication (ADR-0003 section 6). Three kinds of caller:
 * - hospital users: token + live session row
 * - Super Admin under break-glass: token + live approved grant, permission-guarded
 *   endpoints only, every request audited in the hospital's log
 * - Super Admin on /platform: platform token + live platform session
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly platformSessions: PlatformSessionService,
    private readonly supportAccess: SupportAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);

    if (this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets)) {
      const platformAuth = verifyOrUnauthorized(() => this.tokens.verifyPlatformAccessToken(token));
      if (!(await this.platformSessions.isActive(platformAuth))) {
        throw new UnauthorizedException();
      }
      request.platformAuth = platformAuth;
      return true;
    }

    const auth = verifyOrUnauthorized(() => this.tokens.verifyAccessToken(token));

    if (auth.supportAccess) {
      const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
        REQUIRED_PERMISSIONS,
        targets,
      );
      if (!required || required.length === 0) {
        throw new ForbiddenException('Not available during support access.');
      }
      const routePath = (request.route as { path?: string } | undefined)?.path ?? 'unknown';
      if (
        !(await this.supportAccess.useGrant(auth, `${request.method} ${routePath}`, meta(request)))
      ) {
        throw new UnauthorizedException();
      }
    } else if (!(await this.sessions.isActive(auth))) {
      // Revocation (logout, theft detection, disabled user) takes effect immediately.
      throw new UnauthorizedException();
    }

    request.auth = auth;
    return true;
  }
}

/** Enforces @RequirePermissions(...) using the role → permission map in @kenisha/shared. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth) {
      throw new UnauthorizedException();
    }
    const allowed = auth.supportAccess
      ? required.every((permission) => SUPPORT_ACCESS_PERMISSIONS.includes(permission))
      : hasPermissions(auth.roles, required);
    if (!allowed) {
      throw new ForbiddenException('You do not have permission to do this.');
    }
    return true;
  }
}

function bearerToken(request: Request): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedException();
  }
  return header.slice('Bearer '.length).trim();
}

function verifyOrUnauthorized<T>(verify: () => T): T {
  try {
    return verify();
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      throw new UnauthorizedException();
    }
    throw error;
  }
}

function meta(request: Request) {
  return { ip: request.ip, userAgent: request.get('user-agent') };
}
