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
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ─── FIXED: Pre‑save hook using async/await (no `next`) ──────
propertySchema.pre('save', async function() {
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('Property', propertySchema);