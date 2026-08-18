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
const subscriptionRoutes = require('./routes/subscriptions'); // NEW



const app = express();
const PORT = process.env.PORT || 3000;

// ----- CORS (allow frontend & backend) -----
const allowedOrigins = [
  'https://sarahadevelopers.github.io',          // GitHub Pages frontend
  'https://rentspace-markeplace.onrender.com',   // Render backend (for self‑calls)
  'http://localhost:5000',                       // Local dev
  'http://localhost:3000'
];


app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// ----- Body parsing -----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----- API routes -----
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'RentSpace API is running' });
});

// Authentication
app.use('/api/auth', authRoutes);

// Properties
app.use('/api/properties', propertyRoutes);

// Blog posts
app.use('/api/posts', postRoutes);

// Subscriptions & Payments (NEW)
app.use('/api/subscriptions', subscriptionRoutes);

// ----- Serve static frontend files (HTML, CSS, JS, images, etc.) -----
app.use(express.static(path.join(__dirname)));

// ----- SPA fallback – send index.html for any non‑API, non‑file GET request -----
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();  // Skip API routes
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ----- Connect to MongoDB and start server -----
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`📁 Frontend: http://localhost:${PORT}`);
      console.log(`🔌 API: http://localhost:${PORT}/api/health`);
      console.log(`🔐 Auth: http://localhost:${PORT}/api/auth`);
      console.log(`🏠 Properties: http://localhost:${PORT}/api/properties`);
      console.log(`💳 Subscriptions: http://localhost:${PORT}/api/subscriptions/plans`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });