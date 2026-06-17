const subscriptionService = require('../services/subscriptionService');

const createSubscription = async (req, res, next) => {
  try {
    const { planId, billingCycle, couponCode } = req.body;
    const userId = req.user.id;

    const subscription = await subscriptionService.createSubscription(
      userId,
      planId,
      billingCycle,
      couponCode
    );

    res.status(201).json({ data: subscription });
  } catch (error) {
    next(error);
  }
};

const getUserSubscriptions = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const subscriptions = await subscriptionService.getUserSubscriptions(userId);

    res.json({ data: subscriptions });
  } catch (error) {
    next(error);
  }
};

const getSubscriptionById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const subscription = await subscriptionService.getSubscriptionById(id);

    if (subscription.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden - Access denied' });
    }

    res.json({ data: subscription });
  } catch (error) {
    next(error);
  }
};

const cancelSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const subscription = await subscriptionService.getSubscriptionById(id);

    if (subscription.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden - Access denied' });
    }

    const cancelled = await subscriptionService.cancelSubscription(id, userId);

    res.json({ data: cancelled });
  } catch (error) {
    next(error);
  }
};

const resumeSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const subscription = await subscriptionService.getSubscriptionById(id);

    if (subscription.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden - Access denied' });
    }

    const resumed = await subscriptionService.resumeSubscription(id);

    res.json({ data: resumed });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSubscription,
  getUserSubscriptions,
  getSubscriptionById,
  cancelSubscription,
  resumeSubscription,
};
