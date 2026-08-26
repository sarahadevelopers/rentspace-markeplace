const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Property = require('../models/Property');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ─── Cloudinary Configuration ──────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ─── Multer Storage (uploads directly to Cloudinary) ──────────
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'rentspace/properties',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }]
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB per file
});

// ─── Helper: generate unique slug from title ──────────────────
async function generateUniqueSlug(title, existingId = null) {
  let baseSlug = title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  let slug = baseSlug;
  let counter = 1;
  let existing = await Property.findOne({ slug, _id: { $ne: existingId } });
  while (existing) {
    slug = `${baseSlug}-${counter}`;
    existing = await Property.findOne({ slug, _id: { $ne: existingId } });
    counter++;
  }
  return slug;
}

// ─── GET /api/properties (public, with ranking) ────────────────
// Properties are ranked by:
//   1. featured (manual override)
//   2. owner subscription plan (developer > pro > basic > free)
//   3. creation date (newest first)
router.get('/', async (req, res) => {
  try {
    const {
      estate,
      minPrice,
      maxPrice,
      type,
      bedrooms,
      bathrooms,
      featured,
      page = 1,
      limit = 20
    } = req.query;

    const query = { status: 'approved' };

    if (estate) query.estate = estate;
    if (type) query.listingType = type;
    if (featured === 'true') query.featured = true;
    if (bedrooms) query.bedrooms = parseInt(bedrooms);
    if (bathrooms) query.bathrooms = parseInt(bathrooms);

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseInt(minPrice);
      if (maxPrice) query.price.$lte = parseInt(maxPrice);
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // ── Aggregation pipeline for ranking ────────────────────────
    const pipeline = [
      { $match: query },
      {
        $addFields: {
          priority: {
            $switch: {
              branches: [
                { case: { $eq: ['$ownerSubscriptionPlan', 'developer'] }, then: 4 },
                { case: { $eq: ['$ownerSubscriptionPlan', 'pro'] }, then: 3 },
                { case: { $eq: ['$ownerSubscriptionPlan', 'basic'] }, then: 2 },
                { case: { $eq: ['$ownerSubscriptionPlan', 'free'] }, then: 1 }
              ],
              default: 0
            }
          }
        }
      },
      { $sort: { featured: -1, priority: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum }
    ];

    const [properties, total] = await Promise.all([
      Property.aggregate(pipeline),
      Property.countDocuments(query)
    ]);

    res.json({
      success: true,
      count: properties.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      properties
    });
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json({ success: false, error: 'Server error fetching properties' });
  }
});

// ─── GET /api/properties/my-properties (authenticated) ────────
// MUST be placed BEFORE /:slug to avoid conflict
router.get('/my-properties', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let query = {};
    // If user is admin, show all properties; otherwise only their own
    if (req.user.role !== 'admin') {
      query = { ownerId: req.user._id };
    }

    const [properties, total] = await Promise.all([
      Property.find(query)
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 })
        .lean(),
      Property.countDocuments(query)
    ]);

    res.json({
      success: true,
      count: properties.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      properties
    });
  } catch (error) {
    console.error('Error fetching user properties:', error);
    res.status(500).json({ success: false, error: 'Server error fetching your properties' });
  }
});

// ─── GET /api/properties/:slug (public) ────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const property = await Property.findOne({ slug: req.params.slug }).lean();
    if (!property) {
      return res.status(404).json({ success: false, error: 'Property not found' });
    }

    // Increment view count asynchronously
    Property.updateOne({ _id: property._id }, { $inc: { views: 1 } }).exec();

    res.json({ success: true, property });
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({ success: false, error: 'Server error fetching property' });
  }
});

// ─── POST /api/properties (authenticated, with image upload) ──
router.post('/', authMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    console.log('📥 Incoming property data (body):', req.body);
    console.log('📸 Uploaded files:', req.files);
    console.log('👤 User subscription plan:', req.user.subscriptionPlan);
    console.log('👤 User subscription expiry:', req.user.subscriptionExpiry);

    // ── 1. Validate required fields ──────────────────────────────
    const {
      title,
      listingType,
      estate,
      county,
      price,
      bedrooms,
      bathrooms,
      parking,
      sqft,
      description,
      amenities,
      propertyType,
      size,
      status,
      available_for,
      rental_type
    } = req.body;

    if (!title || !listingType || !estate || !price || !description) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, listingType, estate, price, description'
      });
    }

    // ── 2. Subscription check (PAID-ONLY, admins bypass) ──────────
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin) {
      const validPlans = ['basic', 'pro', 'developer'];
      const userPlan = req.user.subscriptionPlan || 'free';
      const userExpiry = req.user.subscriptionExpiry;

      let isPaid = validPlans.includes(userPlan);
      if (isPaid && userExpiry) {
        isPaid = new Date(userExpiry) > new Date();
      }

      if (!isPaid) {
        return res.status(403).json({
          success: false,
          error: 'You need an active subscription to list properties. Please upgrade from your dashboard.'
        });
      }
    }

    // ── 3. Generate slug ──────────────────────────────────────────
    const slug = await generateUniqueSlug(title);

    // ── 4. Extract image URLs from Cloudinary upload ─────────────
    const imageUrls = req.files ? req.files.map(file => file.path) : [];

    // ── 5. Parse amenities (if sent as JSON string) ──────────────
    let amenitiesArray = [];
    if (amenities) {
      try {
        amenitiesArray = typeof amenities === 'string' ? JSON.parse(amenities) : amenities;
      } catch (e) {
        amenitiesArray = [];
      }
    }

    // ── 6. Build property object (including owner's plan) ────────
    const propertyData = {
      ownerId: req.user._id,
      title,
      slug,
      listingType,
      estate,
      county: county || 'Nairobi',
      price: parseFloat(price),
      bedrooms: bedrooms ? parseInt(bedrooms) : 0,
      bathrooms: bathrooms ? parseInt(bathrooms) : 0,
      parking: parking ? parseInt(parking) : 0,
      sqft: sqft ? parseFloat(sqft) : 0,
      description,
      images: imageUrls,
      amenities: amenitiesArray,
      propertyType: propertyType || 'apartment',
      status: status || 'pending',
      available_for: available_for || '',
      rental_type: rental_type || '',
      // ⭐ NEW: Store the owner's subscription plan for ranking
      ownerSubscriptionPlan: req.user.subscriptionPlan || 'free'
    };

    console.log('📦 Property data to save:', propertyData);

    // ── 7. Save to database ───────────────────────────────────────
    const property = await Property.create(propertyData);

    res.status(201).json({ success: true, property });
  } catch (error) {
    console.error('❌ Property creation error FULL:', error);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error stack:', error.stack);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: error.message,
        fields: Object.keys(error.errors)
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate property (slug already exists)'
      });
    }

    const isProduction = process.env.NODE_ENV === 'production';
    res.status(500).json({
      success: false,
      error: isProduction
        ? 'Server error creating property. Please try again later.'
        : error.message,
      ...(isProduction ? {} : { stack: error.stack })
    });
  }
});

// ─── PUT /api/properties/:id (authenticated, owner or admin) ──
router.put('/:id', authMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, error: 'Property not found' });
    }

    // Check ownership or admin
    if (property.ownerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to update this property' });
    }

    // ── Build update data from request body ──────────────────
    const updateData = { ...req.body };

    // ── Handle images ──────────────────────────────────────────
    // 1. Parse existing images from form (sent as JSON string)
    let existingImages = [];
    if (req.body.existingImages) {
      try {
        existingImages = typeof req.body.existingImages === 'string'
          ? JSON.parse(req.body.existingImages)
          : req.body.existingImages;
      } catch (e) {
        existingImages = [];
      }
    }

    // 2. Get new uploaded images (if any)
    const newImageUrls = req.files ? req.files.map(file => file.path) : [];

    // 3. Combine: keep existing images + append new ones
    let finalImages = existingImages.length > 0 ? existingImages : property.images || [];
    if (newImageUrls.length > 0) {
      finalImages = [...finalImages, ...newImageUrls];
    }

    // 4. Update the images array in updateData
    updateData.images = finalImages;

    // ── Handle slug if title changes ──────────────────────────
    if (req.body.title && req.body.title !== property.title) {
      updateData.slug = await generateUniqueSlug(req.body.title, property._id);
    }

    // ── Remove fields that shouldn't be updated ──────────────
    delete updateData._id;
    delete updateData.ownerId;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.slug; // handled above
    delete updateData.existingImages;
    delete updateData.existingPublicIds;

    // ── Optionally update ownerSubscriptionPlan if user plan changed ──
    // We keep the plan at creation time; if you want dynamic, use join.
    // If you want to update it on edit, uncomment:
    // updateData.ownerSubscriptionPlan = req.user.subscriptionPlan || 'free';

    // ── Update the property ────────────────────────────────────
    const updatedProperty = await Property.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({ success: true, property: updatedProperty });
  } catch (error) {
    console.error('Error updating property:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: 'Server error updating property' });
  }
});

// ─── DELETE /api/properties/:id (authenticated, owner or admin) ──
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, error: 'Property not found' });
    }

    if (property.ownerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this property' });
    }

    property.status = 'archived';
    await property.save();

    res.json({ success: true, message: 'Property archived' });
  } catch (error) {
    console.error('Error deleting property:', error);
    res.status(500).json({ success: false, error: 'Server error deleting property' });
  }
});

module.exports = router;