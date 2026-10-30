import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from './generated/prisma/client';
import { InvalidTenantIdError, assertTenantId, withTenant } from './tenant';

const TENANT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('assertTenantId', () => {
  it('accepts UUIDs', () => {
    expect(() => assertTenantId(TENANT)).not.toThrow();
  });

  it.each(['', 'demo-aarogya', "x' OR '1'='1", `${TENANT} `])('rejects %j', (value) => {
    expect(() => assertTenantId(value)).toThrow(InvalidTenantIdError);
  });
});

describe('withTenant', () => {
  function fakePrisma() {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const prisma = {
      $transaction: vi.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    };
    return { prisma: prisma as unknown as PrismaClient, tx, raw: prisma };
  }

  it('sets the tenant context first, then runs the work in the same transaction', async () => {
    const { prisma, tx, raw } = fakePrisma();

    const result = await withTenant(prisma, TENANT, async (client) => {
      expect(client).toBe(tx);
      return 'done';
    });

    expect(result).toBe('done');
    expect(raw.$transaction).toHaveBeenCalledTimes(1);
    const [sqlParts, value] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sqlParts.join('?')).toContain("set_config('app.tenant_id', ?, true)");
    expect(value).toBe(TENANT);
  });

  it('refuses an invalid tenant ID before opening a transaction', async () => {
    const { prisma, raw } = fakePrisma();

    await expect(withTenant(prisma, 'not-a-uuid', async () => 'never')).rejects.toThrow(
      InvalidTenantIdError,
    );
    expect(raw.$transaction).not.toHaveBeenCalled();
  });
});
