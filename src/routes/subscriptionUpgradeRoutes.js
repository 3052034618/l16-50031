const express = require('express');
const router = express.Router({ mergeParams: true });

const {
  upgradeSubscriptionSchema,
  downgradeSubscriptionSchema,
  validate,
} = require('../validations/upgradeDowngradeValidation');
const {
  upgradeSubscription,
  downgradeSubscription,
  cancelScheduledDowngrade,
} = require('../controllers/upgradeDowngradeController');

router.post('/upgrade', validate(upgradeSubscriptionSchema), upgradeSubscription);

router.post('/downgrade', validate(downgradeSubscriptionSchema), downgradeSubscription);

router.post('/cancel-downgrade', cancelScheduledDowngrade);

module.exports = router;
