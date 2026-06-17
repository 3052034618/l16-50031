const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/authMiddleware');
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

router.use(authenticate);

router.post('/', validate(createSubscriptionSchema), createSubscription);

router.get('/', getUserSubscriptions);

router.get('/:id', validateParams(subscriptionIdSchema), getSubscriptionById);

router.post('/:id/cancel', validateParams(subscriptionIdSchema), validate(cancelSubscriptionSchema), cancelSubscription);

router.post('/:id/resume', validateParams(subscriptionIdSchema), resumeSubscription);

router.use('/:id', validateParams(subscriptionIdSchema), subscriptionUpgradeRoutes);

module.exports = router;
