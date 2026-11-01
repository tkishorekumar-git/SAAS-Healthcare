import { Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { describeError } from '../bootstrap/safe-exception.filter';

/**
 * Fixed-window counter plus block flag, in one atomic step.
 * KEYS[1] hit counter, KEYS[2] block flag. ARGV ttl ms, limit, block ms.
 * Returns { hits, ms until the window ends, blocked 0/1, ms until the block ends }.
 */
export const INCREMENT_SCRIPT = `
local blockMs = redis.call('PTTL', KEYS[2])
if blockMs > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, math.max(redis.call('PTTL', KEYS[1]), 0), 1, blockMs }
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

const PREFIX = 'kenisha:throttle:';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** The part of ioredis this storage uses (keeps tests free of a real server). */
export type ThrottleRedis = Pick<Redis, 'eval' | 'quit'>;

/**
 * Rate-limit counters in Redis (ADR-0006), so limits hold across restarts and API
 * instances. Keys are the throttler's own hashes (no IPs or personal data in Redis).
 *
 * If Redis is unreachable the request is allowed and a warning logged: rate limiting is a
 * second line of defence (account lockout lives in PostgreSQL), and failing closed would
 * lock every user out of the platform during a Redis outage.
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly redis: ThrottleRedis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${PREFIX}${throttlerName}:${key}`;
    try {
      const result = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `${base}:hits`,
        `${base}:block`,
        String(ttl),
        String(limit),
        String(blockDuration > 0 ? blockDuration : ttl),
      )) as [number, number, number, number];
      const [hits, windowMs, blocked, blockMs] = result.map(Number) as [
        number,
        number,
        number,
        number,
      ];
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(windowMs / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(blockMs / 1000),
      };
    } catch (error) {
      this.logger.warn(`Rate-limit store unavailable, request allowed: ${describeError(error)}`);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
