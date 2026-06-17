const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/authMiddleware');
const { requireFree, requireBasic, requirePremium } = require('../middleware/featureAccess');
const {
  createSubscriptionSchema,
  subscriptionIdSchema,
  cancelSubscriptionSchema,
  validate,
  validateParams,
} = require('../validations/subscriptionValidation');
const {
  createSubscription,
  getUserSubscriptions,
  getSubscriptionById,
  cancelSubscription,
  resumeSubscription,
} = require('../controllers/subscriptionController');
const subscriptionUpgradeRoutes = require('./subscriptionUpgradeRoutes');

router.post('/', authenticate, validate(createSubscriptionSchema), createSubscription);

router.get('/', requireFree, getUserSubscriptions);

router.get('/:id', requireFree, validateParams(subscriptionIdSchema), getSubscriptionById);

router.post('/:id/cancel', requireBasic, validateParams(subscriptionIdSchema), validate(cancelSubscriptionSchema), cancelSubscription);

router.post('/:id/resume', requireBasic, validateParams(subscriptionIdSchema), resumeSubscription);

router.use('/:id', requirePremium, validateParams(subscriptionIdSchema), subscriptionUpgradeRoutes);

module.exports = router;
