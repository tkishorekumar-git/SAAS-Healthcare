import type { TenantId } from '@kenisha/shared';
import type { Prisma, PrismaClient } from './generated/prisma/client';

export type TenantTransaction = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidTenantIdError extends Error {
  constructor() {
    super('Tenant ID must be a UUID');
    this.name = 'InvalidTenantIdError';
  }
}

export function assertTenantId(value: string): asserts value is TenantId {
  if (!UUID.test(value)) {
    throw new InvalidTenantIdError();
  }
}

const TENANT_CODE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export interface ResolvedTenant {
  tenantId: TenantId;
  isActive: boolean;
  status: 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED';
}

/**
 * Looks up a hospital by its login code (slug) before any tenant context exists, via the
 * `resolve_tenant` database function, which reveals only the ID, active flag and status.
 */
export async function resolveTenantByCode(
  prisma: PrismaClient,
  code: string,
): Promise<ResolvedTenant | null> {
  const normalized = code.trim().toLowerCase();
  if (!TENANT_CODE.test(normalized)) {
    return null;
  }
  const rows = await prisma.$queryRaw<
    Array<{ tenant_id: string; is_active: boolean; status: ResolvedTenant['status'] }>
  >`SELECT tenant_id, is_active, status FROM resolve_tenant(${normalized})`;
  const row = rows[0];
  if (!row) {
    return null;
  }
  assertTenantId(row.tenant_id);
  return { tenantId: row.tenant_id, isActive: row.is_active, status: row.status };
}

export interface WithTenantOptions {
  /** Interactive transaction timeout. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** How long to wait for a pooled connection. Defaults to 5 seconds (Prisma's is 2). */
  maxWaitMs?: number;
}

/**
 * Runs `work` in a transaction bound to one tenant. PostgreSQL RLS policies read the
 * transaction-local `app.tenant_id` setting, so every query inside `work` can only see
 * and write that tenant's rows. The setting disappears when the transaction ends, so a
 * pooled connection never carries one tenant's context into another request.
 *
 * `tenantId` must come from the authenticated session — never from request input.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  work: (tx: TenantTransaction) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  assertTenantId(tenantId);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return work(tx);
    },
    { timeout: options.timeoutMs ?? 10_000, maxWait: options.maxWaitMs ?? 5_000 },
  );
}
