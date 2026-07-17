import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { getRedisClient, isRedisAvailable } from '../config/redis.js';
import { logger } from '../config/logger.js';

// Cache TTL for user data in Redis (seconds)
const USER_CACHE_TTL = 300; // 5 minutes

export const protect = async (req, res, next) => {
  let token = req.cookies?.token;

  // Fallback to Authorization header
  if (!token) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Authentication required. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    let user = null;

    // Try Redis cache first (sub-millisecond vs 2-10ms MongoDB)
    const redisAvailable = await isRedisAvailable();
    if (redisAvailable) {
      try {
        const redis = getRedisClient();
        const cachedUser = await redis.get(`user:${userId}`);
        if (cachedUser) {
          user = JSON.parse(cachedUser);
          logger.debug({ userId }, 'Auth: user loaded from Redis cache');
        }
      } catch (cacheErr) {
        logger.error({ err: cacheErr }, 'Auth: Redis cache read error, falling back to DB');
      }
    }

    // Cache miss — fetch from MongoDB and cache the result
    if (!user) {
      user = await User.findById(userId);
      if (!user) {
        return res.status(401).json({ message: 'User no longer exists.' });
      }

      // Convert to plain object for caching
      const userObj = user.toJSON();

      // Cache in Redis asynchronously (fire-and-forget)
      if (redisAvailable) {
        try {
          const redis = getRedisClient();
          redis.setex(`user:${userId}`, USER_CACHE_TTL, JSON.stringify(userObj)).catch((err) => {
            logger.error({ err }, 'Auth: failed to cache user in Redis');
          });
        } catch (cacheErr) {
          logger.error({ err: cacheErr }, 'Auth: Redis cache write error');
        }
      }

      // Use the Mongoose document's JSON representation
      user = userObj;
    }

    req.user = user;
    req.userId = userId;
    next();
  } catch (error) {
    logger.error({ err: error.message }, 'Auth Middleware Error');
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

/**
 * Invalidate the cached user data in Redis.
 * Call this after profile updates, password changes, or account deletion.
 */
export const invalidateUserCache = async (userId) => {
  try {
    const available = await isRedisAvailable();
    if (!available) return;

    const redis = getRedisClient();
    await redis.del(`user:${userId}`);
    logger.debug({ userId }, 'User cache invalidated');
  } catch (err) {
    logger.error({ err }, 'Failed to invalidate user cache');
  }
};
