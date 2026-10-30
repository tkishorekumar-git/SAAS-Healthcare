import { type Permission, hasPermissions } from '@kenisha/shared';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { InvalidTokenError } from './crypto/ed25519-jwt';
import { IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * Global, deny-by-default authentication (ADR-0003 §6). Every request needs a valid
 * access token whose session is still active, unless the handler is marked @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    let auth;
    try {
      auth = this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new UnauthorizedException();
      }
      throw error;
    }

    // Revocation (logout, theft detection, disabled user) takes effect immediately.
    if (!(await this.sessions.isActive(auth))) {
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
    if (!hasPermissions(auth.roles, required)) {
      throw new ForbiddenException('You do not have permission to do this.');
    }
    return true;
  }
}
