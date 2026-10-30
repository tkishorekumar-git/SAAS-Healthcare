/**
 * Seeds SYNTHETIC demo data. Every name, phone number and address here is fictional.
 *
 * Writes go through the same least-privilege roles the product uses, so the seed also
 * exercises the RLS policies: platform tables as kenisha_platform, branches as
 * kenisha_app inside withTenant().
 *
 * Demo staff share one password taken from SEED_STAFF_PASSWORD (never committed).
 * Patients log in with an SMS code, printed to the API log in development.
 *
 *   pnpm --filter @kenisha/database db:seed
 */
import { hash } from '@node-rs/argon2';
import type { TenantRole } from '../src/generated/prisma/client';
import { createPrismaClient } from '../src/client';
import { withTenant } from '../src/tenant';
import { requireEnv } from './env';

const PLANS = [
  {
    code: 'STARTER',
    name: 'Starter',
    includedModules: ['HOSPITAL'] as const,
    maxBranches: 1,
    maxStaffUsers: 25,
  },
  {
    code: 'PROFESSIONAL',
    name: 'Professional',
    includedModules: ['HOSPITAL', 'CHRONIC_CARE', 'MATERNAL'] as const,
    maxBranches: 5,
    maxStaffUsers: 150,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    includedModules: ['HOSPITAL', 'CHRONIC_CARE', 'MATERNAL', 'PEDIATRIC'] as const,
    maxBranches: 50,
    maxStaffUsers: 2000,
  },
];

type DemoUser = {
  kind: 'STAFF' | 'PERSONAL';
  displayName: string;
  phone: string;
  email?: string;
  roles: TenantRole[];
  branchCodes?: string[];
};

const TENANTS: Array<{
  slug: string;
  name: string;
  planCode: string;
  branches: Array<{ code: string; name: string; city: string; state: string }>;
  users: DemoUser[];
}> = [
  {
    slug: 'demo-aarogya',
    name: 'Aarogya Demo Hospital (synthetic)',
    planCode: 'ENTERPRISE',
    branches: [
      { code: 'MAIN', name: 'Main Campus', city: 'Bengaluru', state: 'Karnataka' },
      { code: 'NORTH', name: 'North Clinic', city: 'Bengaluru', state: 'Karnataka' },
    ],
    users: [
      {
        kind: 'STAFF',
        displayName: 'Demo Admin (synthetic)',
        phone: '+919800000001',
        email: 'admin@aarogya.example.test',
        roles: ['HOSPITAL_ADMIN'],
      },
      {
        kind: 'STAFF',
        displayName: 'Dr. Demo Doctor (synthetic)',
        phone: '+919800000002',
        email: 'doctor@aarogya.example.test',
        roles: ['DOCTOR'],
        branchCodes: ['NORTH'],
      },
      {
        kind: 'STAFF',
        displayName: 'Demo Nurse (synthetic)',
        phone: '+919800000003',
        email: 'nurse@aarogya.example.test',
        roles: ['NURSE'],
        branchCodes: ['MAIN'],
      },
      {
        kind: 'PERSONAL',
        displayName: 'Demo Mother (synthetic)',
        phone: '+919800000101',
        roles: ['PATIENT', 'PARENT_GUARDIAN'],
      },
    ],
  },
  {
    slug: 'demo-sunrise',
    name: 'Sunrise Demo Clinic (synthetic)',
    planCode: 'STARTER',
    branches: [{ code: 'MAIN', name: 'Sunrise Clinic', city: 'Pune', state: 'Maharashtra' }],
    users: [
      {
        kind: 'STAFF',
        displayName: 'Sunrise Admin (synthetic)',
        phone: '+919800000201',
        email: 'admin@sunrise.example.test',
        roles: ['HOSPITAL_ADMIN'],
      },
    ],
  },
];

async function main(): Promise<void> {
  const staffPassword = requireEnv('SEED_STAFF_PASSWORD');
  if (staffPassword.length < 12) {
    throw new Error('SEED_STAFF_PASSWORD must be at least 12 characters');
  }
  // Same Argon2id parameters as the API (apps/api/src/auth/password/password-hasher.ts).
  const passwordHash = await hash(staffPassword, {
    algorithm: 2, // Algorithm.Argon2id (a const enum, not importable under isolatedModules)
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const platform = createPrismaClient(requireEnv('PLATFORM_DATABASE_URL'), { maxConnections: 2 });
  const app = createPrismaClient(requireEnv('APP_DATABASE_URL'), { maxConnections: 2 });

  try {
    for (const plan of PLANS) {
      const data = { ...plan, includedModules: [...plan.includedModules] };
      await platform.subscriptionPlan.upsert({
        where: { code: plan.code },
        create: data,
        update: data,
      });
    }

    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    for (const spec of TENANTS) {
      const tenant = await platform.tenant.upsert({
        where: { slug: spec.slug },
        create: { slug: spec.slug, name: spec.name, status: 'ACTIVE' },
        update: { name: spec.name },
      });

      const existing = await platform.tenantSubscription.count({ where: { tenantId: tenant.id } });
      if (existing === 0) {
        const plan = await platform.subscriptionPlan.findUniqueOrThrow({
          where: { code: spec.planCode },
        });
        await platform.tenantSubscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            status: 'ACTIVE',
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          },
        });
      }

      await withTenant(app, tenant.id, async (tx) => {
        for (const branch of spec.branches) {
          await tx.branch.upsert({
            where: { tenantId_code: { tenantId: tenant.id, code: branch.code } },
            create: { ...branch, tenantId: tenant.id },
            update: { name: branch.name, city: branch.city, state: branch.state },
          });
        }

        for (const demo of spec.users) {
          const user = await tx.user.upsert({
            where: {
              tenantId_accountKind_phoneE164: {
                tenantId: tenant.id,
                accountKind: demo.kind,
                phoneE164: demo.phone,
              },
            },
            create: {
              tenantId: tenant.id,
              accountKind: demo.kind,
              displayName: demo.displayName,
              phoneE164: demo.phone,
              email: demo.email ?? null,
            },
            update: { displayName: demo.displayName },
          });
          await tx.userRole.createMany({
            data: demo.roles.map((role) => ({ tenantId: tenant.id, userId: user.id, role })),
            skipDuplicates: true,
          });
          if (demo.kind === 'STAFF') {
            const credential = await tx.passwordCredential.findUnique({
              where: { userId: user.id },
            });
            if (!credential) {
              await tx.passwordCredential.create({
                data: { tenantId: tenant.id, userId: user.id, passwordHash },
              });
            }
          }
          for (const code of demo.branchCodes ?? []) {
            const branch = await tx.branch.findUniqueOrThrow({
              where: { tenantId_code: { tenantId: tenant.id, code } },
            });
            await tx.staffBranchAssignment.createMany({
              data: [{ tenantId: tenant.id, userId: user.id, branchId: branch.id }],
              skipDuplicates: true,
            });
          }
        }
      });
    }

    console.warn(
      `Seeded ${PLANS.length} plans, ${TENANTS.length} synthetic tenants and their demo users.`,
    );
  } finally {
    await Promise.all([platform.$disconnect(), app.$disconnect()]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
