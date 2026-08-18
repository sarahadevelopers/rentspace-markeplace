const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Please add a phone number'],
    unique: true
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['customer', 'agent', 'landlord', 'admin'],
    default: 'customer'
  },
  verified: {
    type: Boolean,
    default: false
  },
  verificationToken: {
    type: String,
    select: false
  },
  subscriptionPlan: {
    type: String,
    enum: ['free', 'basic', 'pro', 'developer'],
    default: 'free'
  },
  subscriptionExpiry: {
    type: Date,
    default: null
  },
  // ─── Password Reset Fields (NEW) ────────────────────────────
  resetPasswordToken: {
    type: String,
    select: false // Don't return by default
  },
  resetPasswordExpires: {
    type: Date,
    select: false // Don't return by default
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ─── Encrypt password using bcrypt ──────────────────────────────
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ─── Match user entered password to hashed password ─────────────
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// ─── Indexes for performance ────────────────────────────────────
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ resetPasswordToken: 1 }, { sparse: true });

module.exports = mongoose.model('User', userSchema);