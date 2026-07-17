import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { getRedisClient, isRedisAvailable } from '../config/redis.js';
import { logger } from '../config/logger.js';

let authLimiter = null;
let passwordResetLimiter = null;
let apiLimiter = null;
let fallbackInitialized = false;

/**
 * Initialize rate limiters.
 * Uses Redis backend (shared across cluster workers) with in-memory fallback.
 */
const initLimiters = async () => {
  const available = await isRedisAvailable();

  if (available) {
    const storeClient = getRedisClient();

    // Auth routes: login, register — 20 req/min per IP
    authLimiter = new RateLimiterRedis({
      storeClient,
      keyPrefix: 'rl:auth',
      points: 20,
      duration: 60, // seconds
      blockDuration: 60, // block for 1 min if exceeded
    });

    // Password reset: 5 req/min per IP (brute force protection)
    passwordResetLimiter = new RateLimiterRedis({
      storeClient,
      keyPrefix: 'rl:pwreset',
      points: 5,
      duration: 60,
      blockDuration: 120,
    });

    // General API routes: 300 req/min per IP
    apiLimiter = new RateLimiterRedis({
      storeClient,
      keyPrefix: 'rl:api',
      points: 300,
      duration: 60,
      blockDuration: 30,
    });

    logger.info('Rate limiters initialized with Redis backend');
  } else if (!fallbackInitialized) {
    // Fallback: per-process in-memory limiters (not shared across cluster)
    authLimiter = new RateLimiterMemory({
      keyPrefix: 'rl:auth',
      points: 20,
      duration: 60,
    });

    passwordResetLimiter = new RateLimiterMemory({
      keyPrefix: 'rl:pwreset',
      points: 5,
      duration: 60,
    });

    apiLimiter = new RateLimiterMemory({
      keyPrefix: 'rl:api',
      points: 300,
      duration: 60,
    });

    fallbackInitialized = true;
    logger.warn('Rate limiters using in-memory fallback (not shared across cluster workers)');
  }
};

/**
 * Create an Express middleware from a rate limiter instance.
 */
const createMiddleware = (getLimiter) => {
  return async (req, res, next) => {
    try {
      // Lazy-init limiters on first request
      if (!authLimiter) await initLimiters();

      const limiter = getLimiter();
      if (!limiter) return next();

      const key = req.ip;
      await limiter.consume(key);
      next();
    } catch (rateLimiterRes) {
      // Rate limit exceeded
      if (rateLimiterRes instanceof Error) {
        // Actual error, not a rate limit
        logger.error({ err: rateLimiterRes }, 'Rate limiter error');
        return next();
      }

      const retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000) || 60;
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Remaining', '0');
      return res.status(429).json({
        success: false,
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
      });
    }
  };
};

/** Rate limiter for auth routes (login/register) — 20 req/min */
export const authRateLimit = createMiddleware(() => authLimiter);

/** Rate limiter for password reset routes — 5 req/min */
export const passwordResetRateLimit = createMiddleware(() => passwordResetLimiter);

/** Rate limiter for general API routes — 300 req/min */
export const apiRateLimit = createMiddleware(() => apiLimiter);
