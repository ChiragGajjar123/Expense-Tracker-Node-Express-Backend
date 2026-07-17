import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Budget from '../models/Budget.js';
import { protect, invalidateUserCache } from '../middleware/auth.js';
import { invalidateAllUserCaches } from '../middleware/cache.js';
import { authRateLimit, passwordResetRateLimit } from '../middleware/rateLimiter.js';
import { logger } from '../config/logger.js';

const router = express.Router();

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

const setAuthCookie = (res, token) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

// POST /api/auth/register
router.post('/register', authRateLimit, async (req, res) => {
  const { name, email, password } = req.body;
  try {
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    const user = new User({ name, email, password });
    await user.save();

    const token = generateToken(user._id);
    setAuthCookie(res, token);

    return res.status(201).json({
      success: true,
      token,
      user
    });
  } catch (err) {
    logger.error({ err }, 'Register error');
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join(' ') });
    }
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// POST /api/auth/login
router.post('/login', authRateLimit, async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = generateToken(user._id);
    setAuthCookie(res, token);

    return res.json({
      success: true,
      token,
      user
    });
  } catch (err) {
    logger.error({ err }, 'Login error');
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax'
  });
  return res.json({ success: true, message: 'Logged out successfully.' });
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  return res.json({ success: true, user: req.user });
});

// PUT /api/auth/profile
router.put('/profile', protect, async (req, res) => {
  const { name, currency } = req.body;
  const updates = {};
  if (name !== undefined) {
    if (name.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Name must be at least 2 characters.' });
    }
    updates.name = name.trim();
  }
  if (currency !== undefined) updates.currency = currency;

  try {
    const user = await User.findByIdAndUpdate(req.userId, updates, { new: true, runValidators: true });

    // Invalidate cached user data so subsequent requests see the update
    await invalidateUserCache(req.userId);

    return res.json({ success: true, user });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join(' ') });
    }
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// PUT /api/auth/password
router.put('/password', protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current and new passwords are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
  }

  try {
    const user = await User.findById(req.userId).select('+password');
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = newPassword;
    await user.save();

    // Invalidate cached user data
    await invalidateUserCache(req.userId);

    const token = generateToken(user._id);
    setAuthCookie(res, token);
    return res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    logger.error({ err }, 'Change password error');
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// POST /api/auth/delete-account
router.post('/delete-account', protect, async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required to delete account.' });
  }

  try {
    const user = await User.findById(req.userId).select('+password');
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect password.' });
    }

    // Delete all user data
    await Promise.all([
      Transaction.deleteMany({ userId: req.userId }),
      Budget.deleteMany({ userId: req.userId }),
      User.findByIdAndDelete(req.userId)
    ]);

    // Invalidate ALL cached data for this user
    await invalidateAllUserCaches(req.userId);

    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie('token', {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax'
    });

    return res.json({ success: true, message: 'Account deleted successfully.' });
  } catch (err) {
    logger.error({ err }, 'Delete account error');
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', passwordResetRateLimit, async (req, res) => {
  const { email } = req.body;
  try {
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Account with this email address does not exist.' });
    }

    const cooldown = 60 * 1000;
    if (user.lastResetRequest && Date.now() - user.lastResetRequest.getTime() < cooldown) {
      const remainingSeconds = Math.ceil((cooldown - (Date.now() - user.lastResetRequest.getTime())) / 1000);
      return res.status(400).json({
        success: false,
        message: `Please wait ${remainingSeconds} seconds before requesting another password reset link.`
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    user.lastResetRequest = new Date();
    await user.save();

    const resendApiKey = process.env.RESEND_API_KEY;
    const clientUrl = process.env.CLIENT_URL || req.headers.origin || 'http://localhost:5173';
    const resetLink = `${clientUrl}/?resetToken=${token}`;

    if (!resendApiKey || resendApiKey === 're_your_api_key_here') {
      logger.warn(`RESEND_API_KEY is not configured. Falling back to console logging the reset token.`);
      logger.info(`[PASSWORD RESET TOKEN FOR ${email}]: ${resetLink}`);
    } else {
      const resend = new Resend(resendApiKey);
      const { data, error } = await resend.emails.send({
        from: process.env.EMAIL_FROM || 'Expensy <onboarding@resend.dev>',
        to: [email],
        subject: 'Reset Password - Expensy',
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #2563eb; margin-bottom: 20px;">Reset Your Password</h2>
            <p>You requested to reset your password for your Expensy account. Click the button below to complete the request:</p>
            <div style="margin: 30px 0; text-align: center;">
              <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Reset Password</a>
            </div>
            <p style="font-size: 12px; color: #64748b;">This link will expire in 1 hour. If you did not make this request, please ignore this email.</p>
          </div>
        `
      });

      if (error) {
        logger.error({ err: error }, 'Resend API Error');
        return res.status(400).json({ success: false, message: error.message });
      }
    }
    return res.json({ success: true, message: 'Password reset link has been sent successfully to your email address.' });
  } catch (err) {
    logger.error({ err }, 'Forgot password error');
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', passwordResetRateLimit, async (req, res) => {
  const { token, newPassword } = req.body;
  try {
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Password reset token is invalid or has expired.' });
    }

    user.password = newPassword;
    user.resetPasswordToken = '';
    user.resetPasswordExpires = undefined;
    await user.save();

    // Invalidate cached user data after password change
    await invalidateUserCache(user._id.toString());

    const authToken = generateToken(user._id);
    setAuthCookie(res, authToken);

    return res.json({
      success: true,
      message: 'Password has been reset successfully.',
      token: authToken,
      user
    });
  } catch (err) {
    logger.error({ err }, 'Reset password error');
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

export default router;
