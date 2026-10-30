import type { PrismaClient } from './generated/prisma/client';

export interface ConnectionRoleCheck {
  role: string;
  isSuperuser: boolean;
  bypassesRls: boolean;
  /** Table owners can disable RLS, so the API role must own nothing. */
  ownsTables: boolean;
  /** True only when RLS is guaranteed to apply to this connection. */
  safe: boolean;
}

interface RoleRow {
  role: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  owns_tables: boolean;
}

/**
 * Verifies the connected role cannot escape Row-Level Security (ADR-0002 rule 3).
 * Doubles as a connectivity probe for readiness checks.
 */
export async function checkConnectionRole(prisma: PrismaClient): Promise<ConnectionRoleCheck> {
  const rows = await prisma.$queryRaw<RoleRow[]>`
    SELECT r.rolname AS role,
           r.rolsuper,
           r.rolbypassrls,
           EXISTS (
             SELECT 1 FROM pg_catalog.pg_tables t
             WHERE t.schemaname = current_schema() AND t.tableowner = current_user
           ) AS owns_tables
    FROM pg_catalog.pg_roles r
    WHERE r.rolname = current_user`;

  const row = rows[0];
  if (!row) {
    throw new Error('Could not read the current database role');
  }
  return {
    role: row.role,
    isSuperuser: row.rolsuper,
    bypassesRls: row.rolbypassrls,
    ownsTables: row.owns_tables,
    safe: !row.rolsuper && !row.rolbypassrls && !row.owns_tables,
  };
}
