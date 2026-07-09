import express from 'express';
import Transaction from '../models/Transaction.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// GET /api/transactions
router.get('/', protect, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.userId }).sort({ date: -1 });
    return res.json(transactions);
  } catch (err) {
    console.error('Fetch transactions error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// POST /api/transactions
router.post('/', protect, async (req, res) => {
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
    return res.status(201).json(transaction);
  } catch (err) {
    console.error('Add transaction error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/transactions/:id
router.put('/:id', protect, async (req, res) => {
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
    return res.json(updatedTransaction);
  } catch (err) {
    console.error('Update transaction error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', protect, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await Transaction.findOneAndDelete({ _id: id, userId: req.userId });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    return res.json({ success: true, message: 'Transaction deleted' });
  } catch (err) {
    console.error('Delete transaction error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
