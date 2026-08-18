const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const Subscription = require('../models/Subscription');

// Plan definitions
const PLANS = {
  free: { name: 'Free', listings: 2, price: 0, featured: false, analytics: false, badge: false },
  basic: { name: 'Basic', listings: 20, price: 2500, featured: false, analytics: true, badge: false },
  pro: { name: 'Pro', listings: Infinity, price: 5000, featured: true, analytics: true, badge: true },
  developer: { name: 'Developer', listings: Infinity, price: 10000, featured: true, analytics: true, badge: true }
};

// @route   GET /api/subscriptions/plans
// @desc    Get available plans
router.get('/plans', (req, res) => {
  res.json(PLANS);
});

// @route   POST /api/subscriptions/subscribe
// @desc    Initiate STK push via Saraha Pay
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

    // If plan is free, just upgrade and return
    if (amount === 0) {
      user.subscriptionPlan = plan;
      user.subscriptionExpiry = null; // or set to far future
      await user.save();

      // Create a free subscription record
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

    // Paid plan – initiate STK push
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

    // Call Saraha Pay API
    const SARAHA_API_URL = process.env.SARAHAPAY_ENVIRONMENT === 'production'
      ? 'https://api.sarahapay.com/v1/stkpush'
      : 'https://sandbox.sarahapay.com/v1/stkpush'; // adjust if sandbox exists

    const sarahaResponse = await axios.post(
      SARAHA_API_URL,
      {
        phone: phoneNumber,
        amount: amount,
        reference: transactionRef,
        callback_url: `${process.env.BASE_URL}/api/subscriptions/saraha-webhook`
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.SARAHAPAY_API_SECRET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Update subscription with response metadata
    subscription.metadata = sarahaResponse.data;
    await subscription.save();

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

// @route   POST /api/subscriptions/saraha-webhook
// @desc    Webhook to confirm payment from Saraha Pay
router.post('/saraha-webhook', async (req, res) => {
  try {
    const { reference, status, mpesa_receipt, amount } = req.body;

    // Find the subscription by transactionRef
    const subscription = await Subscription.findOne({ transactionRef: reference });
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Optional: verify webhook secret if Saraha Pay provides a signature header
    // const signature = req.headers['x-saraha-signature'];
    // if (signature !== process.env.WEBHOOK_SECRET) {
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }

    if (status === 'paid' || status === 'completed') {
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
      }
    } else {
      // Payment failed
      subscription.status = 'cancelled';
      subscription.paymentStatus = 'failed';
      await subscription.save();
    }

    // Always respond with 200 OK to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;