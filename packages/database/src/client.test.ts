import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEMA, parseDatabaseUrl } from './client';

describe('parseDatabaseUrl', () => {
  it('extracts the schema parameter and removes it from the URL', () => {
    const result = parseDatabaseUrl(
      'postgresql://kenisha_app:pw@db.test:5432/kenisha?schema=tenant_data&sslmode=require',
    );
    expect(result.schema).toBe('tenant_data');
    expect(result.connectionString).toBe(
      'postgresql://kenisha_app:pw@db.test:5432/kenisha?sslmode=require',
    );
  });

  it('defaults to the kenisha schema', () => {
    expect(parseDatabaseUrl('postgresql://u:p@localhost/db').schema).toBe(DEFAULT_SCHEMA);
  });

  it('rejects non-PostgreSQL URLs without echoing the password', () => {
    const attempt = () => parseDatabaseUrl('mysql://root:topsecret@localhost/db');
    expect(attempt).toThrow(/postgresql/);
    expect(attempt).not.toThrow(/topsecret/);
  });

  it('rejects schema names that could inject SQL into search_path', () => {
    expect(() => parseDatabaseUrl('postgresql://u:p@h/db?schema=public;DROP')).toThrow(
      /invalid schema/,
    );
  });
});
