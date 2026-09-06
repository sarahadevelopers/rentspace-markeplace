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
  free: { 
    name: 'Bronze',        // ← New display name
    listings: 2, 
    price: 0,              // Keep 0 for trial, or set to 500 for paid
    featured: false, 
    analytics: false, 
    badge: false 
  },
  basic: { 
    name: 'Silver',        // ← New display name
    listings: 20, 
    price: 2, 
    featured: false, 
    analytics: true, 
    badge: false 
  },
  pro: { 
    name: 'Gold',          // ← New display name
    listings: 50, 
    price: 5, 
    featured: true, 
    analytics: true, 
    badge: true 
  },
  developer: { 
    name: 'Platinum',      // ← New display name
    listings: Infinity, 
    price: 10, 
    featured: true, 
    analytics: true, 
    badge: true 
  }
};
// ─── Helper: Check if user has an active subscription ──────────
function hasActiveSubscription(user) {
  if (!user.subscriptionPlan || user.subscriptionPlan === 'free') return false;
  if (!user.subscriptionExpiry) return false;
  return new Date(user.subscriptionExpiry) > new Date();
}

// ─── GET /api/subscriptions/plans ──────────────────────────────
router.get('/plans', (req, res) => {
  res.json(PLANS);
});

// ─── POST /api/subscriptions/subscribe ─────────────────────────
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { plan, phoneNumber } = req.body;

    // ─── Validate input ────────────────────────────────────────
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

    // ─── Check for existing active subscription ────────────────
    if (hasActiveSubscription(user)) {
      return res.status(409).json({
        error: 'You already have an active subscription. Manage it from your dashboard.',
        currentPlan: user.subscriptionPlan,
        expiresAt: user.subscriptionExpiry
      });
    }

    // ─── Free plan ──────────────────────────────────────────────
    if (amount === 0) {
      user.subscriptionPlan = plan;
      user.subscriptionExpiry = null;
      user.trialStartDate = user.trialStartDate || new Date(); // Preserve trial date
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
    const renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const subscription = new Subscription({
      userId,
      plan,
      status: 'pending',
      paymentStatus: 'pending',
      transactionRef,
      amount,
      renewalDate
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
        name: user.name || 'RentSpace User'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': process.env.API_SECRET
        },
        timeout: 15000
      }
    );

    // ─── Store checkout ID from proxy response ────────────────
   // ─── Store checkout ID from proxy response ────────────────
const checkoutId = response.data.checkoutId || response.data.checkout_id || response.data.id;
subscription.metadata = {
  ...subscription.metadata,
  checkout_id: checkoutId,
  intasendResponse: response.data,
  initiatedAt: new Date()
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
      response: error.response?.data || 'No response data',
      status: error.response?.status
    });

    const errorMsg = error.response?.data?.error || 'Payment initiation failed';
    const statusCode = error.response?.status || 500;

    res.status(statusCode).json({
      success: false,
      error: errorMsg
    });
  }
});

// ─── POST /api/payment-callback (Called by IntaSend service) ──
router.post('/payment-callback', async (req, res) => {
  try {
    const payload = req.body;
    const { transactionRef, userId, plan, status, mpesaReceipt } = payload;

    console.log(`📥 Payment callback received: ${transactionRef} | ${status}`);

    // ─── Find the subscription ──────────────────────────────────
    const subscription = await Subscription.findOne({ transactionRef });
    if (!subscription) {
      console.warn(`⚠️ No subscription found for ref: ${transactionRef}`);
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // ─── Only process if still pending ──────────────────────────
    if (subscription.status !== 'pending') {
      console.log(`⏭️ Subscription ${transactionRef} already processed (status: ${subscription.status})`);
      return res.status(200).send('OK');
    }

    // ─── Handle successful payment ──────────────────────────────
    if (status === 'completed' || status === 'COMPLETE' || status === 'success') {
      // ── Update subscription ──────────────────────────────────
      subscription.status = 'active';
      subscription.paymentStatus = 'paid';
      subscription.metadata = {
        ...subscription.metadata,
        mpesaReceipt,
        paidAt: new Date(),
        verifiedBy: 'callback',
        callbackPayload: payload
      };
      await subscription.save();

      // ── Update user ──────────────────────────────────────────
      const user = await User.findById(userId);
      if (user) {
        // Store previous plan for reference
        const previousPlan = user.subscriptionPlan;

        // Update user's subscription
        user.subscriptionPlan = plan;
        user.subscriptionExpiry = subscription.renewalDate;

        // Ensure trial start date is set (for new users)
        if (!user.trialStartDate) {
          user.trialStartDate = new Date();
        }

        await user.save();

        // ── Update all properties owned by this user ──────────
        await Property.updateMany(
          { ownerId: user._id },
          { $set: { ownerSubscriptionPlan: plan } }
        );

        console.log(`✅ User ${user.email} upgraded from ${previousPlan || 'free'} to ${plan} via callback`);

        // ── Send confirmation email ────────────────────────────
        try {
          await sendSubscriptionConfirmationEmail(
            user.email,
            user.name || 'User',
            plan,
            subscription.amount
          );
          console.log(`✅ Confirmation email sent to ${user.email}`);
        } catch (emailError) {
          console.error('Email error:', emailError);
        }
      } else {
        console.warn(`⚠️ User ${userId} not found for subscription ${transactionRef}`);
      }

    } else {
      // ─── Payment failed ───────────────────────────────────────
      subscription.status = 'cancelled';
      subscription.paymentStatus = 'failed';
      subscription.metadata = {
        ...subscription.metadata,
        failedAt: new Date(),
        failureReason: status || 'Unknown',
        callbackPayload: payload
      };
      await subscription.save();
      console.log(`❌ Payment failed for ${transactionRef} (status: ${status})`);
    }

    // ─── Always respond 200 to acknowledge ──────────────────────
    res.status(200).send('OK');

  } catch (error) {
    console.error('❌ Payment callback error:', error);
    console.error('❌ Stack:', error.stack);
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

    // ─── Activate subscription ──────────────────────────────────
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
      const previousPlan = user.subscriptionPlan;
      user.subscriptionPlan = subscription.plan;
      user.subscriptionExpiry = subscription.renewalDate;
      await user.save();

      await Property.updateMany(
        { ownerId: user._id },
        { $set: { ownerSubscriptionPlan: subscription.plan } }
      );

      console.log(`✅ User ${user.email} upgraded from ${previousPlan || 'free'} to ${subscription.plan} via manual verification`);
    }

    res.json({
      success: true,
      message: 'Subscription activated manually',
      subscription
    });
  } catch (error) {
    console.error('Manual verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── GET /api/subscriptions/status (Check current subscription) ──
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isActive = hasActiveSubscription(user);

    res.json({
      success: true,
      subscription: {
        plan: user.subscriptionPlan || 'free',
        isActive,
        expiresAt: user.subscriptionExpiry,
        trialStartDate: user.trialStartDate,
        // Calculate days remaining if active
        daysRemaining: isActive && user.subscriptionExpiry
          ? Math.max(0, Math.ceil((new Date(user.subscriptionExpiry) - new Date()) / (1000 * 60 * 60 * 24)))
          : 0
      }
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

module.exports = router;