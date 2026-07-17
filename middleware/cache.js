import { getRedisClient, isRedisAvailable } from '../config/redis.js';
import { logger } from '../config/logger.js';

/**
 * Response caching middleware using Redis.
 * 
 * Caches the JSON response of GET requests per-user, so repeated reads
 * bypass MongoDB entirely (sub-millisecond response from Redis).
 * 
 * @param {string} prefix - Cache key prefix (e.g., 'transactions', 'budgets')
 * @param {number} ttlSeconds - Time-to-live in seconds (default: 30)
 */
export const cacheResponse = (prefix, ttlSeconds = 30) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    // Skip caching if Redis is down
    const available = await isRedisAvailable();
    if (!available) return next();

    const userId = req.userId;
    if (!userId) return next();

    const cacheKey = `cache:${prefix}:${userId}`;

    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);

      if (cached) {
        logger.debug({ cacheKey }, 'Cache HIT');
        return res.json(JSON.parse(cached));
      }

      logger.debug({ cacheKey }, 'Cache MISS');

      // Intercept res.json to cache the response before sending
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // Cache the response asynchronously (don't await — fire and forget)
        redis.setex(cacheKey, ttlSeconds, JSON.stringify(body)).catch((err) => {
          logger.error({ err, cacheKey }, 'Failed to write cache');
        });
        return originalJson(body);
      };

      next();
    } catch (err) {
      logger.error({ err }, 'Cache middleware error, skipping cache');
      next();
    }
  };
};

/**
 * Invalidate cached response(s) for a specific user and prefix.
 * Call this after mutations (POST/PUT/DELETE) to keep cache consistent.
 * 
 * @param {string} prefix - Cache key prefix (e.g., 'transactions', 'budgets')
 * @param {string} userId - The user whose cache should be invalidated
 */
export const invalidateCache = async (prefix, userId) => {
  try {
    const available = await isRedisAvailable();
    if (!available) return;

    const redis = getRedisClient();
    const cacheKey = `cache:${prefix}:${userId}`;
    await redis.del(cacheKey);
    logger.debug({ cacheKey }, 'Cache invalidated');
  } catch (err) {
    logger.error({ err }, 'Cache invalidation error');
  }
};

/**
 * Invalidate ALL caches for a specific user (used on account deletion).
 * 
 * @param {string} userId - The user whose caches should be wiped
 */
export const invalidateAllUserCaches = async (userId) => {
  try {
    const available = await isRedisAvailable();
    if (!available) return;

    const redis = getRedisClient();
    const keys = [
      `cache:transactions:${userId}`,
      `cache:budgets:${userId}`,
      `user:${userId}`,
    ];
    await redis.del(...keys);
    logger.debug({ userId }, 'All user caches invalidated');
  } catch (err) {
    logger.error({ err }, 'Bulk cache invalidation error');
  }
};
