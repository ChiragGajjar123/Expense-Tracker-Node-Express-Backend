import express from 'express';
import Budget from '../models/Budget.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// GET /api/budgets
router.get('/', protect, async (req, res) => {
  try {
    const budgets = await Budget.find({ userId: req.userId });
    return res.json(budgets);
  } catch (err) {
    console.error('Fetch budgets error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// PUT /api/budgets
router.put('/', protect, async (req, res) => {
  const { categoryId, amount } = req.body;
  try {
    const budget = await Budget.findOneAndUpdate(
      { categoryId, userId: req.userId },
      { $set: { amount } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true }
    );
    return res.json(budget);
  } catch (err) {
    console.error("Budget update error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
