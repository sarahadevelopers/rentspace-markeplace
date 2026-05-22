// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

// Import route modules
const authRoutes = require('./routes/auth');
const propertyRoutes = require('./routes/properties');
const postRoutes = require('./routes/posts');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/posts', postRoutes);

// Serve static frontend files (HTML, CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname)));

// API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'RentSpace API is running' });
});

// Mount authentication and property routes
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);

// SPA fallback – send index.html for any non‑API, non‑file GET request
app.use((req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) return next();
  // Only handle GET requests for missing routes
  if (req.method !== 'GET') return next();
  // Send index.html (your frontend router will handle the rest)
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Connect to MongoDB then start server
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`📁 Frontend: http://localhost:${PORT}`);
      console.log(`🔌 API: http://localhost:${PORT}/api/health`);
      console.log(`🔐 Auth: http://localhost:${PORT}/api/auth`);
      console.log(`🏠 Properties: http://localhost:${PORT}/api/properties`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });