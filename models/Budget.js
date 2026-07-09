import mongoose from 'mongoose';

const budgetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  categoryId: { type: String, required: true },
  amount: { type: Number, required: true },
  period: { type: String, default: 'monthly' }
}, {
  timestamps: true,
  toJSON: {
    transform: (doc, ret) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
    }
  }
});

// Unique compound index: one budget per category per user
budgetSchema.index({ userId: 1, categoryId: 1 }, { unique: true });

export default mongoose.model('Budget', budgetSchema);
