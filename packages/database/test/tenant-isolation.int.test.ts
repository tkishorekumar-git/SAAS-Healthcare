/**
 * Proves the ADR-0002 guarantees against a real PostgreSQL 18 database with the real
 * migrations applied. All data is synthetic.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, parseDatabaseUrl } from '../src/client';
import type { PrismaClient } from '../src/generated/prisma/client';
import { checkConnectionRole } from '../src/role-check';
import { withTenant } from '../src/tenant';

const urls = inject('databaseUrls');

let app: PrismaClient;
let platform: PrismaClient;
let migrator: PrismaClient;
let tenantA: string;
let tenantB: string;
let branchA: string;
let branchB: string;

/** A raw node-postgres session as the API role, bypassing all application code. */
async function rawAppSession(): Promise<Client> {
  const { connectionString, schema } = parseDatabaseUrl(urls.app);
  const client = new Client({ connectionString, options: `-c search_path=${schema}` });
  await client.connect();
  return client;
}

beforeAll(async () => {
  app = createPrismaClient(urls.app, { maxConnections: 2 });
  platform = createPrismaClient(urls.platform, { maxConnections: 2 });
  migrator = createPrismaClient(urls.migrator, { maxConnections: 1 });

  const plan = await platform.subscriptionPlan.create({
    data: {
      code: 'IT_PLAN',
      name: 'Integration plan',
      includedModules: ['HOSPITAL'],
      maxBranches: 3,
      maxStaffUsers: 10,
    },
  });
  const a = await platform.tenant.create({
    data: { slug: 'it-hospital-a', name: 'IT Hospital A' },
  });
  const b = await platform.tenant.create({
    data: { slug: 'it-hospital-b', name: 'IT Hospital B' },
  });
  tenantA = a.id;
  tenantB = b.id;

  const now = new Date();
  const later = new Date(now.getTime() + 86_400_000);
  for (const tenantId of [tenantA, tenantB]) {
    await platform.tenantSubscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: later,
      },
    });
  }

  branchA = (
    await withTenant(app, tenantA, (tx) =>
      tx.branch.create({
        data: { tenantId: tenantA, code: 'MAIN', name: 'A Main', city: 'Mysuru', state: 'KA' },
      }),
    )
  ).id;
  branchB = (
    await withTenant(app, tenantB, (tx) =>
      tx.branch.create({
        data: { tenantId: tenantB, code: 'MAIN', name: 'B Main', city: 'Nashik', state: 'MH' },
      }),
    )
  ).id;
});

afterAll(async () => {
  await Promise.all([app?.$disconnect(), platform?.$disconnect(), migrator?.$disconnect()]);
});

describe('tenant isolation for the API role (kenisha_app)', () => {
  it('sees only the current tenant’s branches', async () => {
    const asA = await withTenant(app, tenantA, (tx) => tx.branch.findMany());
    const asB = await withTenant(app, tenantB, (tx) => tx.branch.findMany());

    expect(asA.map((b) => b.id)).toEqual([branchA]);
    expect(asB.map((b) => b.id)).toEqual([branchB]);
  });

  it('cannot fetch another tenant’s branch even by its exact ID', async () => {
    const leaked = await withTenant(app, tenantA, (tx) =>
      tx.branch.findUnique({ where: { id: branchB } }),
    );
    expect(leaked).toBeNull();
  });

  it('sees nothing without a tenant context (fails closed)', async () => {
    await expect(app.branch.findMany()).resolves.toEqual([]);
    await expect(app.tenant.findMany()).resolves.toEqual([]);
    await expect(app.tenantSubscription.findMany()).resolves.toEqual([]);
  });

  it('cannot create a branch for another tenant', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.branch.create({
          data: { tenantId: tenantB, code: 'SNEAK', name: 'x', city: 'x', state: 'x' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot move a branch to another tenant', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.branch.update({ where: { id: branchA }, data: { tenantId: tenantB } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('cannot update another tenant’s branch', async () => {
    const result = await withTenant(app, tenantA, (tx) =>
      tx.branch.updateMany({ where: { id: branchB }, data: { name: 'hijacked' } }),
    );
    expect(result.count).toBe(0);

    const unchanged = await withTenant(app, tenantB, (tx) =>
      tx.branch.findUniqueOrThrow({ where: { id: branchB } }),
    );
    expect(unchanged.name).toBe('B Main');
  });

  it('cannot delete branches at all (deactivate instead)', async () => {
    await expect(
      withTenant(app, tenantA, (tx) => tx.branch.deleteMany({ where: { id: branchA } })),
    ).rejects.toThrow(/permission denied/i);
  });

  it('reads only its own tenant row and may rename it, but not change its status', async () => {
    const visible = await withTenant(app, tenantA, (tx) => tx.tenant.findMany());
    expect(visible.map((t) => t.id)).toEqual([tenantA]);

    const renamed = await withTenant(app, tenantA, (tx) =>
      tx.tenant.update({ where: { id: tenantA }, data: { name: 'IT Hospital A (renamed)' } }),
    );
    expect(renamed.name).toBe('IT Hospital A (renamed)');

    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.tenant.update({ where: { id: tenantA }, data: { status: 'ACTIVE' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('sees only its own subscription', async () => {
    const subs = await withTenant(app, tenantA, (tx) => tx.tenantSubscription.findMany());
    expect(subs).toHaveLength(1);
    expect(subs[0]?.tenantId).toBe(tenantA);
  });

  it('cannot create tenants', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.tenant.create({ data: { slug: 'rogue', name: 'Rogue' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('raw SQL as kenisha_app (no application code involved)', () => {
  it('is isolated by RLS and cannot switch RLS off', async () => {
    const client = await rawAppSession();
    try {
      const noContext = await client.query('SELECT id FROM branches');
      expect(noContext.rowCount).toBe(0);

      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const scoped = await client.query<{ id: string }>('SELECT id FROM branches');
      expect(scoped.rows.map((r) => r.id)).toEqual([branchA]);
      await client.query('COMMIT');

      await expect(client.query('ALTER TABLE branches DISABLE ROW LEVEL SECURITY')).rejects.toThrow(
        /must be owner/i,
      );
      await expect(client.query('SET ROLE kenisha_migrator')).rejects.toThrow(/permission denied/i);
    } finally {
      await client.end();
    }
  });

  it('does not carry tenant context past the end of a transaction', async () => {
    const client = await rawAppSession();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await client.query('COMMIT');

      // After COMMIT the setting reads as '' — current_tenant_id() must turn that into NULL.
      const after = await client.query('SELECT id FROM branches');
      expect(after.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });

  it('rejects a malformed tenant context instead of matching rows', async () => {
    const client = await rawAppSession();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', 'not-a-uuid', true)");
      await expect(client.query('SELECT id FROM branches')).rejects.toThrow(/uuid/i);
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });
});

describe('platform role (kenisha_platform, Super Admin)', () => {
  it('sees every tenant and subscription', async () => {
    const tenants = await platform.tenant.findMany({ where: { slug: { startsWith: 'it-' } } });
    expect(tenants.map((t) => t.id).sort()).toEqual([tenantA, tenantB].sort());
    await expect(platform.tenantSubscription.count()).resolves.toBe(2);
  });

  it('has no access to tenant-owned data (ADR-0002, D2)', async () => {
    await expect(platform.branch.findMany()).rejects.toThrow(/permission denied/i);
  });
});

describe('checkConnectionRole', () => {
  it('reports the API and platform roles as safe', async () => {
    await expect(checkConnectionRole(app)).resolves.toMatchObject({
      role: 'kenisha_app',
      safe: true,
    });
    await expect(checkConnectionRole(platform)).resolves.toMatchObject({
      role: 'kenisha_platform',
      safe: true,
    });
  });

  it('flags the schema owner as unsafe for application use', async () => {
    await expect(checkConnectionRole(migrator)).resolves.toMatchObject({
      role: 'kenisha_migrator',
      ownsTables: true,
      safe: false,
    });
  });
});
