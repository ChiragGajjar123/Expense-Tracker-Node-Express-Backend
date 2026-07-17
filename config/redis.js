import Redis from 'ioredis';
import { logger } from './logger.js';

let redisClient = null;

/**
 * Get or create the Redis client singleton.
 * Falls back gracefully if Redis is unavailable — the app still works,
 * just without caching / rate limiting.
 */
export const getRedisClient = () => {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;

  // Skip Redis entirely if REDIS_URL is not configured
  if (!redisUrl) {
    logger.info('Redis: REDIS_URL not set — running without Redis (no caching/shared rate limiting)');
    return null;
  }

  redisClient = new Redis(redisUrl, {
    // Performance: keep connections warm
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) {
        logger.error('Redis: max reconnect attempts reached, giving up');
        return null; // stop retrying
      }
      return Math.min(times * 200, 2000); // exponential backoff, max 2s
    },
    enableReadyCheck: true,
    lazyConnect: false,
    // Connection pool settings for high throughput
    connectTimeout: 5000,
    commandTimeout: 3000,
  });

  redisClient.on('connect', () => {
    logger.info('Redis: connected');
  });

  redisClient.on('ready', () => {
    logger.info('Redis: ready to accept commands');
  });

  redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis: connection error');
  });

  redisClient.on('close', () => {
    logger.warn('Redis: connection closed');
  });

  return redisClient;
};

/**
 * Check if Redis is available and responsive.
 */
export const isRedisAvailable = async () => {
  try {
    const client = getRedisClient();
    if (client.status !== 'ready') return false;
    await client.ping();
    return true;
  } catch {
    return false;
  }
};

/**
 * Gracefully disconnect Redis.
 */
export const disconnectRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
};
