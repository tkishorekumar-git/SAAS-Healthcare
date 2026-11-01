import { classify } from './route-access';

const none = { isPublic: false, isPlatform: false, isSelfService: false, permissions: [] };

describe('classify', () => {
  it('rejects a route with no access decision', () => {
    const entry = classify('GET /x', none);
    expect(entry.access).toBe('UNCLASSIFIED');
    expect(entry.problems).toHaveLength(1);
  });

  it('accepts each single decision', () => {
    expect(classify('GET /a', { ...none, isPublic: true }).access).toBe('public');
    expect(classify('GET /b', { ...none, isPlatform: true }).access).toBe('platform');
    expect(classify('GET /c', { ...none, isSelfService: true }).access).toBe('self-service');
    expect(classify('GET /d', { ...none, permissions: ['branch:read'] }).access).toBe(
      'permissions',
    );
  });

  it('rejects contradictory decisions', () => {
    expect(
      classify('GET /e', { ...none, isSelfService: true, permissions: ['branch:read'] }).problems,
    ).toHaveLength(1);
    expect(
      classify('GET /f', { ...none, isPublic: true, permissions: ['branch:read'] }).problems,
    ).toHaveLength(1);
    expect(
      classify('GET /g', { ...none, isPlatform: true, permissions: ['branch:read'] }).problems,
    ).toHaveLength(1);
  });

  it('lets a public login route live inside a platform controller', () => {
    const entry = classify('POST /platform/auth/login', {
      ...none,
      isPublic: true,
      isPlatform: true,
    });
    expect(entry).toMatchObject({ access: 'public', problems: [] });
  });
});
