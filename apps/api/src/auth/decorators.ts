import type { Permission } from '@kenisha/shared';
import {
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext, PlatformAuthContext } from './auth-context';

export const IS_PUBLIC = 'kenisha:isPublic';
export const IS_PLATFORM = 'kenisha:isPlatform';
export const REQUIRED_PERMISSIONS = 'kenisha:requiredPermissions';
export const IS_SELF_SERVICE = 'kenisha:isSelfService';

/** Opts an endpoint out of the global authentication guard. Use sparingly. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Any signed-in hospital user, acting only on their own account (sign out, "who am I").
 * Every hospital route must carry either this or @RequirePermissions — the API refuses to
 * start otherwise (see route-access.ts).
 */
export const SelfService = () => SetMetadata(IS_SELF_SERVICE, true);

/** Marks a /platform controller: Super Admin tokens only, never hospital tokens. */
export const PlatformRoute = () => SetMetadata(IS_PLATFORM, true);

/** The caller's roles must grant every listed permission (ADR-0003 section 6). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Injects the verified AuthContext of the current hospital request. */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<Request>().auth;
    if (!auth) {
      throw new UnauthorizedException();
    }
    return auth;
  },
);

/** Injects the verified Super Admin identity of the current /platform request. */
export const CurrentPlatformAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformAuthContext => {
    const auth = ctx.switchToHttp().getRequest<Request>().platformAuth;
    if (!auth) {
      throw new UnauthorizedException();
    }
    return auth;
  },
);
