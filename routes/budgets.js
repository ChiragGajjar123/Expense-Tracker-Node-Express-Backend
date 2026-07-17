import express from 'express';
import Budget from '../models/Budget.js';
import { protect } from '../middleware/auth.js';
import { cacheResponse, invalidateCache } from '../middleware/cache.js';
import { apiRateLimit } from '../middleware/rateLimiter.js';
import { logger } from '../config/logger.js';

const router = express.Router();

// GET /api/budgets — cached for 60s per user
router.get('/', protect, cacheResponse('budgets', 60), async (req, res) => {
  try {
    const budgets = await Budget.find({ userId: req.userId });
    return res.json(budgets);
  } catch (err) {
    logger.error({ err }, 'Fetch budgets error');
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// PUT /api/budgets
router.put('/', protect, apiRateLimit, async (req, res) => {
  const { categoryId, amount } = req.body;
  try {
    const budget = await Budget.findOneAndUpdate(
      { categoryId, userId: req.userId },
      { $set: { amount } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true }
    );

    // Invalidate cached budget list
    await invalidateCache('budgets', req.userId);

    return res.json(budget);
  } catch (err) {
    logger.error({ err }, 'Budget update error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
