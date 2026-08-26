const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  // ─── Owner ──────────────────────────────────────────────────
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // ─── Basic Info ─────────────────────────────────────────────
  title: {
    type: String,
    required: [true, 'Please add a title'],
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  listingType: {
    type: String,
    enum: ['sale', 'rent', 'short_term', 'long_term'],
    required: true,
    default: 'sale'
  },
  propertyType: {
    type: String,
    default: 'apartment'
  },

  // ─── Location ───────────────────────────────────────────────
  estate: {
    type: String,
    required: true
  },
  county: {
    type: String,
    default: 'Nairobi'
  },

  // ─── Pricing & Specs ────────────────────────────────────────
  price: {
    type: Number,
    required: true
  },
  priceNight: Number,                // for short‑stay
  bedrooms: Number,
  bathrooms: Number,
  parking: Number,
  sqft: Number,
  size: String,                      // e.g., "1/8 acre"

  // ─── Description & Media ──────────────────────────────────
  description: {
    type: String,
    required: true
  },
  images: [String],
  amenities: [String],

  // ─── Status & Metadata ────────────────────────────────────
  status: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'rejected', 'published', 'rented', 'expired', 'archived'],
    default: 'pending'
  },
  featured: {
    type: Boolean,
    default: false
  },
  views: {
    type: Number,
    default: 0
  },

  // ─── Availability (for filtering) ──────────────────────────
  available_for: {
    type: String,
    enum: ['long_term', 'short_term', 'both', 'sale'],
    default: 'long_term'
  },
  rental_type: {
    type: String,
    enum: ['long_term', 'short_term', 'sale'],
    default: 'long_term'
  },
  isAirbnb: {
    type: Boolean,
    default: false
  },

  // ⭐ NEW: Subscription plan of the owner (for ranking)
  ownerSubscriptionPlan: {
    type: String,
    enum: ['free', 'basic', 'pro', 'developer'],
    default: 'free'
  },

  // ─── Timestamps ─────────────────────────────────────────────
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ─── Index for efficient ranking sorting ──────────────────────
//   Sorts: featured first, then by subscription priority,
//   then by creation date (newest first).
propertySchema.index({ featured: -1, ownerSubscriptionPlan: 1, createdAt: -1 });

// ─── Pre‑save hook ─────────────────────────────────────────────
propertySchema.pre('save', async function() {
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('Property', propertySchema);