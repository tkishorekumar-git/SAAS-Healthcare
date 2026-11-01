/**
 * ADR-0006: the rate-limit script against a real Redis. CI provides one
 * (KENISHA_TEST_REDIS_URL); locally the suite is skipped with a message when it is unset.
 */
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RedisThrottlerStorage } from '../src/throttling/redis-throttler.storage';

const url = process.env.KENISHA_TEST_REDIS_URL;
if (!url && process.env.CI) {
  throw new Error('KENISHA_TEST_REDIS_URL must be set in CI');
}
const describeWithRedis = url ? describe : describe.skip;
if (!url) {
  process.stderr.write('Skipping Redis rate-limit tests: KENISHA_TEST_REDIS_URL is not set.\n');
}

describeWithRedis('Redis rate-limit store (real Redis)', () => {
  let a: Redis;
  let b: Redis;

  beforeAll(() => {
    a = new Redis(url!);
    b = new Redis(url!);
  });

  afterAll(async () => {
    await Promise.all([a?.quit(), b?.quit()]);
  });

  it('counts across API instances and blocks after the limit', async () => {
    const key = randomUUID();
    const first = new RedisThrottlerStorage(a);
    const second = new RedisThrottlerStorage(b);

    const hits = [];
    for (let i = 0; i < 3; i += 1) {
      hits.push(await (i % 2 === 0 ? first : second).increment(key, 60_000, 3, 0, 'login'));
    }
    expect(hits.map((h) => [h.totalHits, h.isBlocked])).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ]);
    const fourth = await second.increment(key, 60_000, 3, 0, 'login');
    expect(fourth.isBlocked).toBe(true);
    expect(fourth.timeToBlockExpire).toBeGreaterThan(55);
    expect(fourth.timeToExpire).toBeLessThanOrEqual(60);
  });

  it('starts a new window after the old one ends', async () => {
    const key = randomUUID();
    const store = new RedisThrottlerStorage(a);
    await store.increment(key, 300, 1, 300, 'login');
    expect((await store.increment(key, 300, 1, 300, 'login')).isBlocked).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const fresh = await store.increment(key, 300, 1, 300, 'login');
    expect(fresh).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('keeps separate throttlers and keys apart, and stores no plain addresses', async () => {
    const key = randomUUID();
    const store = new RedisThrottlerStorage(a);
    await store.increment(key, 60_000, 1, 0, 'login');
    expect((await store.increment(key, 60_000, 1, 0, 'default')).totalHits).toBe(1);
    const keys = await a.keys(`kenisha:throttle:*${key}*`);
    expect(keys.sort()).toEqual([
      `kenisha:throttle:default:${key}:hits`,
      `kenisha:throttle:login:${key}:hits`,
    ]);
  });
});
