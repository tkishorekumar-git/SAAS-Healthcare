import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export const DEFAULT_SCHEMA = 'kenisha';

export interface ParsedDatabaseUrl {
  /** URL without Prisma's `schema` parameter, which node-postgres does not understand. */
  connectionString: string;
  schema: string;
}

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Splits the `?schema=` parameter out of a PostgreSQL URL. Errors never include the URL,
 * because it contains a password.
 */
export function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Database URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Database URL must use the postgresql:// scheme');
  }

  const schema = parsed.searchParams.get('schema') ?? DEFAULT_SCHEMA;
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error('Database URL has an invalid schema name');
  }
  parsed.searchParams.delete('schema');

  return { connectionString: parsed.toString(), schema };
}

export interface CreatePrismaClientOptions {
  /** Maximum pooled connections. Defaults to 10. */
  maxConnections?: number;
}

/**
 * Creates a Prisma client for one database role. The role is whatever the URL logs in as:
 * kenisha_app for the API, kenisha_platform for Super Admin tooling.
 * Feature code must not query tenant tables directly — wrap work in withTenant().
 */
export function createPrismaClient(
  url: string,
  options: CreatePrismaClientOptions = {},
): PrismaClient {
  const { connectionString, schema } = parseDatabaseUrl(url);
  const adapter = new PrismaPg(
    {
      connectionString,
      max: options.maxConnections ?? 10,
      // Raw SQL resolves unqualified names in the application schema only. TimeZone=UTC is
      // required: the pg adapter exchanges timestamps without an offset, so any other
      // session time zone silently shifts every stored timestamp.
      options: `-c search_path=${schema} -c TimeZone=UTC`,
    },
    { schema },
  );
  return new PrismaClient({ adapter });
}
