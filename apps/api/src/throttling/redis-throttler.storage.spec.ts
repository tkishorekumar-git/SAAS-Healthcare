import { Logger } from '@nestjs/common';
import {
  INCREMENT_SCRIPT,
  RedisThrottlerStorage,
  type ThrottleRedis,
} from './redis-throttler.storage';

function fakeRedis(reply: unknown[] | Error) {
  const calls: unknown[][] = [];
  const redis = {
    eval: jest.fn(async (...args: unknown[]) => {
      calls.push(args);
      if (reply instanceof Error) throw reply;
      return reply;
    }),
    quit: jest.fn(async () => 'OK'),
  } as unknown as ThrottleRedis;
  return { redis, calls };
}

describe('RedisThrottlerStorage', () => {
  afterEach(() => jest.restoreAllMocks());

  it('runs one atomic script with namespaced keys and millisecond arguments', async () => {
    const { redis, calls } = fakeRedis([3, 42_100, 0, 0]);
    const record = await new RedisThrottlerStorage(redis).increment(
      'abc',
      60_000,
      10,
      0,
      'default',
    );

    expect(calls).toEqual([
      [
        INCREMENT_SCRIPT,
        2,
        'kenisha:throttle:default:abc:hits',
        'kenisha:throttle:default:abc:block',
        '60000',
        '10',
        // No explicit block duration: block for the rest of the window, like Nest's store.
        '60000',
      ],
    ]);
    expect(record).toEqual({
      totalHits: 3,
      timeToExpire: 43,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('reports a block in seconds', async () => {
    const { redis } = fakeRedis([11, 5_000, 1, 30_000]);
    const record = await new RedisThrottlerStorage(redis).increment('k', 60_000, 10, 30_000, 'd');
    expect(record).toMatchObject({ isBlocked: true, timeToBlockExpire: 30, totalHits: 11 });
  });

  it('allows the request and logs only the error class when Redis is down', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { redis } = fakeRedis(
      Object.assign(new Error('connect ECONNREFUSED redis://:s3cret@cache:6379'), {
        code: 'ECONNREFUSED',
      }),
    );
    const record = await new RedisThrottlerStorage(redis).increment('k', 60_000, 10, 0, 'd');

    expect(record.isBlocked).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('Error [ECONNREFUSED]');
    expect(String(warn.mock.calls[0]![0])).not.toContain('s3cret');
  });
});
