import express from 'express';
import Transaction from '../models/Transaction.js';
import { protect } from '../middleware/auth.js';
import { cacheResponse, invalidateCache } from '../middleware/cache.js';
import { apiRateLimit } from '../middleware/rateLimiter.js';
import { logger } from '../config/logger.js';

const router = express.Router();

// GET /api/transactions — cached for 30s per user
router.get('/', protect, cacheResponse('transactions', 30), async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.userId }).sort({ date: -1 });
    return res.json(transactions);
  } catch (err) {
    logger.error({ err }, 'Fetch transactions error');
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// POST /api/transactions
router.post('/', protect, apiRateLimit, async (req, res) => {
  const { title, amount, type, categoryId, date, note } = req.body;
  try {
    const transaction = new Transaction({
      userId: req.userId,
      title,
      amount,
      type,
      categoryId,
      date,
      note
    });
    await transaction.save();

    // Invalidate cached transaction list so next GET fetches fresh data
    await invalidateCache('transactions', req.userId);

    return res.status(201).json(transaction);
  } catch (err) {
    logger.error({ err }, 'Add transaction error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/transactions/:id
router.put('/:id', protect, apiRateLimit, async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  try {
    const updatedTransaction = await Transaction.findOneAndUpdate(
      { _id: id, userId: req.userId },
      updateData,
      { new: true }
    );
    if (!updatedTransaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Invalidate cached transaction list
    await invalidateCache('transactions', req.userId);

    return res.json(updatedTransaction);
  } catch (err) {
    logger.error({ err }, 'Update transaction error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', protect, apiRateLimit, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await Transaction.findOneAndDelete({ _id: id, userId: req.userId });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Invalidate cached transaction list
    await invalidateCache('transactions', req.userId);

    return res.json({ success: true, message: 'Transaction deleted' });
  } catch (err) {
    logger.error({ err }, 'Delete transaction error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
