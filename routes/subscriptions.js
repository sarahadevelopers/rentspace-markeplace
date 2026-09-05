const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Property = require('../models/Property');
const { sendSubscriptionConfirmationEmail } = require('../config/email');

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
      return res.status(400).json({ error: 'Phone number required' });
    }

    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const planData = PLANS[plan];
    const amount = planData.price;

    // ─── Free plan ──────────────────────────────────────────────
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

      try {
        await sendSubscriptionConfirmationEmail(user.email, user.name, plan, 0);
      } catch (emailError) {
        console.error('Email error:', emailError);
      }

      return res.json({
        success: true,
        message: 'Free plan activated',
        plan: planData
      });
    }

    // ─── Paid plan – forward to IntaSend payment service ──────
    const transactionRef = `RENT-${uuidv4().slice(0, 8)}`;

    const subscription = new Subscription({
      userId,
      plan,
      status: 'pending',
      paymentStatus: 'pending',
      transactionRef,
      amount,
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });
    await subscription.save();

    const intasendServiceUrl = process.env.INTASEND_SERVICE_URL || 'https://sarahapay-intasend.onrender.com';
    const callbackUrl = process.env.INTASEND_CALLBACK_URL || 'https://rentspace-markeplace.onrender.com/api/payment-callback';

    // ─── Call sarahapay-intasend with ALL required fields ──
    const response = await axios.post(
      `${intasendServiceUrl}/api/pay`,
      {
        phone: phoneNumber,
        amount: amount,
        plan: plan,
        userId: userId,
        website: 'rentspace',
        callbackUrl: callbackUrl,
        name: user.name || 'RentSpace User'   // ← ADDED: proxy requires 'name'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': process.env.API_SECRET   // ← MUST be set in environment
        },
        timeout: 15000
      }
    );

    subscription.metadata = {
      ...subscription.metadata,
      checkout_id: response.data.checkoutId,
      intasendResponse: response.data
    };
    await subscription.save();

    res.json({
      success: true,
      message: 'STK push initiated. Check your phone for M-Pesa prompt.',
      transactionRef,
      checkoutId: response.data.checkoutId
    });

  } catch (error) {
    console.error('Subscription error:', {
      message: error.message,
      response: error.response?.data || 'No response data'
    });
    const errorMsg = error.response?.data?.error || 'Payment initiation failed';
    res.status(500).json({
      success: false,
      error: errorMsg
    });
  }
});

// ─── POST /api/payment-callback (Called by IntaSend service) ──
router.post('/payment-callback', async (req, res) => {
  try {
    const { transactionRef, userId, plan, status, mpesaReceipt } = req.body;

    console.log(`📥 Payment callback received: ${transactionRef} | ${status}`);

    const subscription = await Subscription.findOne({ transactionRef });
    if (!subscription) {
      console.warn(`⚠️ No subscription found for ref: ${transactionRef}`);
      return res.status(404).json({ error: 'Subscription not found' });
    }

    if (subscription.status !== 'pending') {
      console.log(`⏭️ Subscription ${transactionRef} already processed`);
      return res.status(200).send('OK');
    }

    if (status === 'completed') {
      subscription.status = 'active';
      subscription.paymentStatus = 'paid';
      subscription.metadata = {
        ...subscription.metadata,
        mpesaReceipt,
        paidAt: new Date(),
        verifiedBy: 'callback'
      };
      await subscription.save();

      const user = await User.findById(userId);
      if (user) {
        user.subscriptionPlan = plan;
        user.subscriptionExpiry = subscription.renewalDate;
        await user.save();

        await Property.updateMany(
          { ownerId: user._id },
          { $set: { ownerSubscriptionPlan: plan } }
        );

        console.log(`✅ User ${user.email} upgraded to ${plan} via callback`);

        try {
          await sendSubscriptionConfirmationEmail(
            user.email,
            user.name,
            plan,
            subscription.amount
          );
          console.log(`✅ Confirmation email sent to ${user.email}`);
        } catch (emailError) {
          console.error('Email error:', emailError);
        }
      }
    } else {
      subscription.status = 'cancelled';
      subscription.paymentStatus = 'failed';
      await subscription.save();
      console.log(`❌ Payment failed for ${transactionRef}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Payment callback error:', error);
    res.status(500).json({ error: 'Callback processing failed' });
  }
});

// ─── POST /api/subscriptions/intasend-webhook (Legacy) ──
router.post('/intasend-webhook', async (req, res) => {
  console.log('📥 Legacy webhook called (intasend-webhook) — ignoring.');
  res.status(200).send('OK');
});

// ─── POST /api/subscriptions/verify-payment (Manual fallback) ──
router.post('/verify-payment', authMiddleware, async (req, res) => {
  try {
    const { transactionRef, mpesaReceipt } = req.body;
    if (!transactionRef) {
      return res.status(400).json({ error: 'Transaction reference required' });
    }

    const subscription = await Subscription.findOne({
      transactionRef,
      userId: req.user._id,
      status: 'pending'
    });

    if (!subscription) {
      return res.status(404).json({ error: 'No pending subscription found' });
    }

    if (!mpesaReceipt) {
      return res.status(400).json({ error: 'M-Pesa receipt number required' });
    }

    subscription.status = 'active';
    subscription.paymentStatus = 'paid';
    subscription.metadata = {
      ...subscription.metadata,
      mpesaReceipt,
      verifiedAt: new Date(),
      verifiedBy: 'manual'
    };
    await subscription.save();

    const user = await User.findById(subscription.userId);
    if (user) {
      user.subscriptionPlan = subscription.plan;
      user.subscriptionExpiry = subscription.renewalDate;
      await user.save();

      await Property.updateMany(
        { ownerId: user._id },
        { $set: { ownerSubscriptionPlan: subscription.plan } }
      );
    }

    res.json({ success: true, message: 'Subscription activated manually' });
  } catch (error) {
    console.error('Manual verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;