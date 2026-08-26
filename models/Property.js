const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
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
  estate: {
    type: String,
    required: true
  },
  county: {
    type: String,
    default: 'Nairobi'
  },
  price: {
    type: Number,
    required: true
  },
  priceNight: Number, // for short‑stay
  bedrooms: Number,
  bathrooms: Number,
  parking: Number,
  sqft: Number,
  size: String,        // Added for land/plot size (e.g., "1/8 acre")
  description: {
    type: String,
    required: true
  },
  images: [String],
  amenities: [String],
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
  // ===== NEW FIELDS for availability =====
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
  // ===== Optional: flag for Airbnb (derived from listingType/propertyType) =====
  isAirbnb: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ─── Pre‑save hook (async/await) ──────────────
propertySchema.pre('save', async function() {
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('Property', propertySchema);