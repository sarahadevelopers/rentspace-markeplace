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
  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordExpires: {
    type: Date,
    select: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ─── Encrypt password using bcrypt ──────────────────────────────
// ✅ FIXED: Removed 'next' parameter (not needed with async/await)
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// ─── Match user entered password to hashed password ─────────────
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// ─── Indexes for performance ────────────────────────────────────
// ✅ FIXED: Removed duplicate indexes (unique: true already creates them)
// Only keep the sparse index for resetPasswordToken
userSchema.index({ resetPasswordToken: 1 }, { sparse: true });

module.exports = mongoose.model('User', userSchema);