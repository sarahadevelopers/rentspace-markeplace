const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../config/email');

const router = express.Router();

// ─── JWT Token Generator ──────────────────────────────────────
const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// ─── Signup ────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // ── 1. Validate required fields ────────────────────────────
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        error: 'All fields are required: name, email, phone, password'
      });
    }

    // ── 2. Check for existing user ─────────────────────────────
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });
    if (existingUser) {
      return res.status(400).json({
        error: 'User already exists with that email or phone'
      });
    }

    // ── 3. Generate verification token ──────────────────────────
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // ── 4. Create user (unverified) ─────────────────────────────
    const user = await User.create({
      name,
      email,
      phone,
      password,
      verificationToken,
      verified: false
    });

    // ── 5. Send verification email (non-blocking) ───────────────
    try {
      await sendVerificationEmail(email, name, verificationToken);
      console.log(`✅ Verification email sent to ${email}`);
    } catch (emailError) {
      console.error('❌ Failed to send verification email:', emailError);
      // User is still created, but they won't get the email
    }

    const token = generateToken(user._id, user.role);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        subscriptionPlan: user.subscriptionPlan,
        verified: user.verified
      },
      requiresVerification: true
    });

  } catch (error) {
    console.error('❌ Signup error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 11000) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(500).json({
      error: isProduction
        ? 'Server error during signup. Please try again later.'
        : error.message,
      ...(isProduction ? {} : { stack: error.stack })
    });
  }
});

// ─── Verify Email ──────────────────────────────────────────────
// GET /api/auth/verify-email/:token
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({ verificationToken: token });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification token'
      });
    }

    user.verified = true;
    user.verificationToken = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully! You can now log in.'
    });
  } catch (error) {
    console.error('❌ Verification error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user._id, user.role);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        subscriptionPlan: user.subscriptionPlan,
        verified: user.verified
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ─── Get Current User ────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ success: true, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================
// 🔐 PASSWORD RESET ENDPOINTS
// =============================================================

// ─── Request Password Reset ──────────────────────────────────
// POST /api/auth/forgot-password
// Body: { email }
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Security: don't reveal if email exists
      return res.status(200).json({
        message: 'If that email is registered, you will receive a reset link.'
      });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = Date.now() + 3600000;

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetExpires;
    await user.save();

    // ─── Send password reset email ──────────────────────────────
    try {
      await sendPasswordResetEmail(email, user.name, resetToken);
      console.log(`✅ Password reset email sent to ${email}`);
    } catch (emailError) {
      console.error('❌ Failed to send password reset email:', emailError);
    }

    res.status(200).json({
      message: 'If that email is registered, you will receive a reset link.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error processing request' });
  }
});

// ─── Verify Reset Token ──────────────────────────────────────
// GET /api/auth/verify-reset-token/:token
router.get('/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired token' });
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Reset Password ──────────────────────────────────────────
// POST /api/auth/reset-password
// Body: { token, newPassword }
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;