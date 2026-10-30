import { describe, expect, it } from 'vitest';
import { rolePasswordsFromUrls } from './bootstrap';

const urls = {
  migrator: 'postgresql://kenisha_migrator:migrator-secret-1@localhost/db?schema=kenisha',
  app: 'postgresql://kenisha_app:app-secret-123456@localhost/db?schema=kenisha',
  platform: 'postgresql://kenisha_platform:platform%40secret1@localhost/db?schema=kenisha',
};

describe('rolePasswordsFromUrls', () => {
  it('reads each password from its URL, decoding escapes', () => {
    expect(rolePasswordsFromUrls(urls)).toEqual({
      migrator: 'migrator-secret-1',
      app: 'app-secret-123456',
      platform: 'platform@secret1',
    });
  });

  it('requires each URL to log in as its fixed role name', () => {
    expect(() =>
      rolePasswordsFromUrls({ ...urls, app: 'postgresql://postgres:superuser-pw-1@localhost/db' }),
    ).toThrow(/must log in as kenisha_app/);
  });

  it('rejects short passwords without revealing them', () => {
    const attempt = () =>
      rolePasswordsFromUrls({ ...urls, app: 'postgresql://kenisha_app:short@localhost/db' });
    expect(attempt).toThrow(/at least 12 characters/);
    expect(attempt).not.toThrow(/short@/);
  });
});
