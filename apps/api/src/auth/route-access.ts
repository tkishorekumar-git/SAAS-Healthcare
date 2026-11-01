import type { Permission } from '@kenisha/shared';
import { Injectable, type OnApplicationBootstrap, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { IS_PLATFORM, IS_PUBLIC, IS_SELF_SERVICE, REQUIRED_PERMISSIONS } from './decorators';

/**
 * How a route is protected (ADR-0005 section 1). Every route has exactly one class:
 * - `public`: no token (login, health) — reviewed allow-list in the inventory test
 * - `platform`: Super Admin token and live platform session
 * - `permissions`: hospital token, live session, and every listed permission
 * - `self-service`: any signed-in hospital user, on their own account only
 */
export type RouteAccess = 'public' | 'platform' | 'permissions' | 'self-service';

export interface RouteEntry {
  /** e.g. `GET /branches/:id` (without the global prefix and version). */
  route: string;
  access: RouteAccess | 'UNCLASSIFIED';
  permissions: Permission[];
  problems: string[];
}

export function listRoutes(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  reflector: Reflector,
): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || typeof metatype !== 'function') continue;
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    const base = normalize(Reflect.getMetadata(PATH_METADATA, metatype) as string | undefined);

    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      const path = normalize(Reflect.getMetadata(PATH_METADATA, handler) as string | undefined);
      const targets = [handler, metatype];
      entries.push(
        classify(`${RequestMethod[method]} /${[base, path].filter(Boolean).join('/')}`, {
          isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) === true,
          isPlatform: reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets) === true,
          isSelfService: reflector.getAllAndOverride<boolean>(IS_SELF_SERVICE, targets) === true,
          permissions:
            reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, targets) ??
            [],
        }),
      );
    }
  }
  return entries.sort((a, b) => a.route.localeCompare(b.route));
}

interface RouteMarkers {
  isPublic: boolean;
  isPlatform: boolean;
  isSelfService: boolean;
  permissions: Permission[];
}

export function classify(route: string, markers: RouteMarkers): RouteEntry {
  const { isPublic, isPlatform, isSelfService, permissions } = markers;
  const problems: string[] = [];
  let access: RouteEntry['access'] = 'UNCLASSIFIED';

  if (isPublic) {
    access = 'public';
    if (permissions.length > 0 || isSelfService) {
      problems.push('a public route cannot also require permissions or a session');
    }
  } else if (isPlatform) {
    access = 'platform';
    if (permissions.length > 0 || isSelfService) {
      problems.push('platform routes use the platform guard, not hospital permissions');
    }
  } else if (permissions.length > 0) {
    access = 'permissions';
    if (isSelfService) problems.push('choose either @SelfService or @RequirePermissions');
  } else if (isSelfService) {
    access = 'self-service';
  } else {
    problems.push('needs @Public, @PlatformRoute, @RequirePermissions or @SelfService');
  }
  return { route, access, permissions, problems };
}

function normalize(path: string | undefined): string {
  return (path ?? '').replace(/^\/+|\/+$/g, '');
}

/**
 * Refuses to start the API if any route has no access decision, so an endpoint cannot ship
 * that any signed-in user (including a patient) could call by accident.
 */
@Injectable()
export class RouteAccessCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const broken = listRoutes(this.discovery, this.scanner, this.reflector).filter(
      (entry) => entry.problems.length > 0,
    );
    if (broken.length > 0) {
      const detail = broken.map((e) => `${e.route}: ${e.problems.join('; ')}`).join(' | ');
      throw new Error(`Routes without a valid access decision — ${detail}`);
    }
  }
}
