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
const subscriptionRoutes = require('./routes/subscriptions');

// Import User model (adjust path if your model is elsewhere)
const User = require('./models/User');

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

// Subscriptions & Payments (existing)
app.use('/api/subscriptions', subscriptionRoutes);

// =============================================
// Webhook from sarahapay-intasend
// =============================================
app.post('/api/subscriptions/saraha-webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('📥 Webhook received from sarahapay:', payload);

    // Extract expected fields
    const { checkout_id, status, mpesa_receipt, amount, phone, name, reference } = payload;

    // Only process if payment was successful
    if (status !== 'paid') {
      console.log(`⏭️ Payment status is "${status}", ignoring.`);
      return res.status(200).json({ message: 'Ignored' });
    }

    // Find user by phone number (format: 2547XXXXXXXX)
    let userPhone = phone;
    // Try both formats (with and without '254')
    let user = await User.findOne({ phone: userPhone });
    if (!user && userPhone.startsWith('254')) {
      const altPhone = userPhone.replace(/^254/, '0');
      user = await User.findOne({ phone: altPhone });
    }
    if (!user && !userPhone.startsWith('254')) {
      const altPhone = '254' + userPhone.replace(/^0/, '');
      user = await User.findOne({ phone: altPhone });
    }

    if (!user) {
      console.warn(`❌ User not found for phone: ${phone}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Determine subscription plan based on amount (2 = basic, 5 = pro, 10 = developer)
    let planName = 'basic';
    const amt = parseFloat(amount);
    if (amt >= 10) planName = 'developer';
    else if (amt >= 5) planName = 'pro';
    else if (amt >= 2) planName = 'basic';

    // Update subscription – adapt to your actual User schema
    user.subscription = {
      plan: planName,
      status: 'active',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      mpesaReceipt: mpesa_receipt || reference,
      transactionRef: reference || checkout_id
    };
    await user.save();

    console.log(`✅ Subscription upgraded for ${user.email || user.phone} (plan: ${planName})`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
      console.log(`🔔 Webhook: http://localhost:${PORT}/api/subscriptions/saraha-webhook`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });