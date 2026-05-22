// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (HTML, CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname)));

// API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'RentSpace API is running' });
});

// TODO: add /api/auth, /api/properties, etc.

// SPA fallback – send index.html for any non‑API, non‑file GET request
// This avoids Express 5's path-to-regexp wildcard error
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
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });