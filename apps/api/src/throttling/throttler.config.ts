import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.validation';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Global rate limit; counters in Redis when REDIS_URL is set (required in production,
 * ADR-0006), otherwise in process memory for local development and tests.
 */
export function throttlerOptions(config: ConfigService<Env, true>): ThrottlerModuleOptions {
  const throttlers = [
    {
      ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
      limit: config.get('THROTTLE_LIMIT', { infer: true }),
    },
  ];
  const redisUrl = config.get('REDIS_URL', { infer: true });
  if (!redisUrl) {
    return { throttlers };
  }
  const redis = new Redis(redisUrl, {
    // Fail fast instead of queueing requests while Redis is down.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });
  const logger = new Logger('RedisThrottler');
  // The URL holds a password: log only the event.
  redis.on('error', () => logger.warn('Redis connection error'));
  return { throttlers, storage: new RedisThrottlerStorage(redis) };
}
