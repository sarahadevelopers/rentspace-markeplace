const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const Subscription = require('../models/Subscription');

// ─── Plan definitions ──────────────────────────────────────────
const PLANS = {
  free: { name: 'Free', listings: 2, price: 0, featured: false, analytics: false, badge: false },
  basic: { name: 'Basic', listings: 20, price: 2, featured: false, analytics: true, badge: false },
  pro: { name: 'Pro', listings: Infinity, price: 5, featured: true, analytics: true, badge: true },
  developer: { name: 'Developer', listings: Infinity, price: 10, featured: true, analytics: true, badge: true }
};

// ─── GET /api/subscriptions/plans ──────────────────────────────
router.get('/plans', (req, res) => {
  res.json(PLANS);
});

// ─── POST /api/subscriptions/subscribe ─────────────────────────
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { plan, phoneNumber } = req.body;
    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required for STK push' });
    }

    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const planData = PLANS[plan];
    const amount = planData.price;

    // ── Free plan ──────────────────────────────────────────────
    if (amount === 0) {
      user.subscriptionPlan = plan;
      user.subscriptionExpiry = null;
      await user.save();

      const subscription = new Subscription({
        userId,
        plan,
        status: 'active',
        paymentStatus: 'paid',
        transactionRef: `FREE-${uuidv4().slice(0, 8)}`,
        amount: 0,
        renewalDate: null
      });
      await subscription.save();

      return res.json({
        success: true,
        message: 'Free plan activated',
        plan: planData
      });
    }

    // ── Paid plan – initiate STK push via Saraha Pay service ──
    const transactionRef = `RENT-${uuidv4().slice(0, 8)}`;

    // Create pending subscription record
    const subscription = new Subscription({
      userId,
      plan,
      status: 'pending',
      paymentStatus: 'pending',
      transactionRef,
      amount,
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });
    await subscription.save();

    // ── Call Saraha Pay service ──────────────────────────────────
    const SARAHA_BASE_URL = process.env.SARAHAPAY_BASE_URL || 'https://sarahapay.onrender.com';
    const SARAHA_API_URL = `${SARAHA_BASE_URL}/api/pay`;

    const sarahaResponse = await axios.post(
      SARAHA_API_URL,
      {
        name: `RentSpace ${plan} Subscription (${transactionRef})`,
        phone: phoneNumber,
        amount: amount
      },
      {
        headers: {
          'x-api-secret': process.env.SARAHAPAY_API_SECRET,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    // The service returns a transaction ID; store it as checkout_id
    const checkoutId = sarahaResponse.data.transactionId || sarahaResponse.data.checkout_id;
    if (checkoutId) {
      subscription.metadata = {
        ...subscription.metadata,
        checkout_id: checkoutId,
        sarahaResponse: sarahaResponse.data
      };
      await subscription.save();
    }

    res.json({
      success: true,
      message: 'STK push initiated. Check your phone for M-Pesa prompt.',
      transactionRef,
      sarahaResponse: sarahaResponse.data
    });

  } catch (error) {
    console.error('Subscription error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Payment initiation failed' });
  }
});

// ─── POST /api/subscriptions/saraha-webhook ─────────────────────
// This endpoint receives callbacks from the Saraha Pay service.
// The service must forward its callback payload (including checkout_id)
// to this URL.
router.post('/saraha-webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('📥 Webhook received:', payload);

    // Extract fields (the service may send different keys)
    const checkoutId = payload.checkout_id || payload.checkoutId || payload.transactionId;
    const status = payload.status || payload.paymentStatus;
    const mpesa_receipt = payload.mpesa_receipt || payload.receipt;
    const amount = payload.amount;

    if (!checkoutId) {
      console.warn('⚠️ No checkout_id in webhook payload');
      return res.status(400).json({ error: 'Missing checkout_id' });
    }

    // Find the subscription by checkout_id stored in metadata
    let subscription = await Subscription.findOne({
      'metadata.checkout_id': checkoutId
    });

    // Fallback: try by transactionRef if sent
    if (!subscription && payload.reference) {
      subscription = await Subscription.findOne({ transactionRef: payload.reference });
    }

    if (!subscription) {
      console.warn(`⚠️ No subscription found for checkout_id: ${checkoutId}`);
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Determine status
    const isSuccess = status === 'paid' || status === 'completed' || status === 'SUCCESS';

    if (isSuccess) {
      // Update subscription
      subscription.status = 'active';
      subscription.paymentStatus = 'paid';
      subscription.metadata = {
        ...subscription.metadata,
        mpesa_receipt,
        paidAt: new Date()
      };
      await subscription.save();

      // Update user's plan
      const user = await User.findById(subscription.userId);
      if (user) {
        user.subscriptionPlan = subscription.plan;
        user.subscriptionExpiry = subscription.renewalDate;
        await user.save();
        console.log(`✅ User ${user.email} upgraded to ${subscription.plan}`);
      }
    } else {
      // Payment failed
      subscription.status = 'cancelled';
      subscription.paymentStatus = 'failed';
      await subscription.save();
      console.log(`❌ Payment failed for subscription ${subscription._id}`);
    }

    // Always respond with 200 OK to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;