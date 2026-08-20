const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

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

    // ── 3. Create user ──────────────────────────────────────────
    const user = await User.create({
      name,
      email,
      phone,
      password
    });

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
      }
    });

  } catch (error) {
    // ── 4. Log the full error (for debugging) ──────────────────
    console.error('❌ Signup error:', error);

    // ── 5. Handle specific error types ──────────────────────────
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        error: error.message
      });
    }

    if (error.code === 11000) {
      // Duplicate key (email or phone) – fallback
      return res.status(400).json({
        error: 'User already exists with that email or phone'
      });
    }

    // ── 6. Generic server error ─────────────────────────────────
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(500).json({
      error: isProduction
        ? 'Server error during signup. Please try again later.'
        : error.message,
      // Optionally show stack trace in development
      ...(isProduction ? {} : { stack: error.stack })
    });
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

    // Find user (but don't reveal existence)
    const user = await User.findOne({ email });
    if (!user) {
      // Return success message even if email doesn't exist (security best practice)
      return res.status(200).json({
        message: 'If that email is registered, you will receive a reset link.'
      });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = Date.now() + 3600000; // 1 hour

    // Save token to user
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetExpires;
    await user.save();

    // ─── Send email with reset link ──────────────────────────
    // You can use your existing email provider (Brevo/Resend)
    // Example link: FRONTEND_URL/reset-password.html?token=RESET_TOKEN
    const resetLink = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;
    
    // TODO: Implement email sending
    // await sendEmail({
    //   to: user.email,
    //   subject: 'Reset Your RentSpace Password',
    //   html: `<p>Click <a href="${resetLink}">here</a> to reset your password. This link expires in 1 hour.</p>`
    // });

    // For development, log the link to console
    console.log(`🔑 Password reset link for ${user.email}: ${resetLink}`);

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

    // Find user with valid token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Update password
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Optionally: log user in by returning a new token
    // const jwtToken = generateToken(user._id, user.role);
    // res.json({ success: true, token: jwtToken });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;