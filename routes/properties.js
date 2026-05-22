const express = require('express');
const Property = require('../models/Property');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Helper: generate unique slug from title
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

// @route   GET /api/properties
// @desc    Get all approved properties (public) with pagination & filtering
// @query   page, limit, estate, minPrice, maxPrice, type, bedrooms, bathrooms, featured
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
    
    const [properties, total] = await Promise.all([
      Property.find(query)
        .skip(skip)
        .limit(limitNum)
        .sort({ featured: -1, createdAt: -1 })
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
    console.error('Error fetching properties:', error);
    res.status(500).json({ success: false, error: 'Server error fetching properties' });
  }
});

// @route   GET /api/properties/:slug
// @desc    Get single property by slug (public)
router.get('/:slug', async (req, res) => {
  try {
    const property = await Property.findOne({ slug: req.params.slug }).lean();
    if (!property) {
      return res.status(404).json({ success: false, error: 'Property not found' });
    }
    
    // Increment view count asynchronously (don't wait for response)
    Property.updateOne({ _id: property._id }, { $inc: { views: 1 } }).exec();
    
    res.json({ success: true, property });
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({ success: false, error: 'Server error fetching property' });
  }
});

// @route   POST /api/properties
// @desc    Create a new property (authenticated)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, ...rest } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }
    
    const slug = await generateUniqueSlug(title);
    
    const property = await Property.create({
      ...rest,
      title,
      ownerId: req.user._id,
      slug,
      status: 'pending' // new listings require moderation
    });
    
    res.status(201).json({ success: true, property });
  } catch (error) {
    console.error('Error creating property:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: 'Server error creating property' });
  }
});

// @route   GET /api/properties/my-properties
// @desc    Get all properties for the logged in user (with pagination)
router.get('/my-properties', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    const [properties, total] = await Promise.all([
      Property.find({ ownerId: req.user._id })
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 })
        .lean(),
      Property.countDocuments({ ownerId: req.user._id })
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

// @route   PUT /api/properties/:id
// @desc    Update a property (owner or admin)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    let property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, error: 'Property not found' });
    }
    
    // Check ownership or admin
    if (property.ownerId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized to update this property' });
    }
    
    // If title is being updated, regenerate slug
    let updateData = { ...req.body };
    if (req.body.title && req.body.title !== property.title) {
      updateData.slug = await generateUniqueSlug(req.body.title, property._id);
    }
    
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

// @route   DELETE /api/properties/:id
// @desc    Soft delete (archive) a property (owner or admin)
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