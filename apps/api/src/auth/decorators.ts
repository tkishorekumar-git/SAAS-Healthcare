import type { Permission } from '@kenisha/shared';
import {
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from './auth-context';

export const IS_PUBLIC = 'kenisha:isPublic';
export const REQUIRED_PERMISSIONS = 'kenisha:requiredPermissions';

/** Opts an endpoint out of the global authentication guard. Use sparingly. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The caller's roles must grant every listed permission (ADR-0003 §6). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Injects the verified AuthContext of the current request. */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<Request>().auth;
    if (!auth) {
      throw new UnauthorizedException();
    }
    return auth;
  },
);
