const express = require('express');
const Post = require('../models/Post');
const router = express.Router();

// GET all posts (public)
router.get('/', async (req, res) => {
  try {
    const { limit = 20, category } = req.query;
    const query = {};
    if (category) query.category = category;
    
    const posts = await Post.find(query)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    res.json({ success: true, count: posts.length, posts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET a single post by slug
router.get('/:slug', async (req, res) => {
  try {
    const post = await Post.findOne({ slug: req.params.slug });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    res.json({ success: true, post });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;