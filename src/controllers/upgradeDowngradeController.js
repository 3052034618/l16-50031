const upgradeDowngradeService = require('../services/upgradeDowngradeService');

const upgradeSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPlanId } = req.body;
    const userId = req.user.id;

    const result = await upgradeDowngradeService.upgradeSubscription(
      id,
      newPlanId,
      userId
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
};

const downgradeSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPlanId } = req.body;
    const userId = req.user.id;

    const result = await upgradeDowngradeService.downgradeSubscription(
      id,
      newPlanId,
      userId
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
};

const cancelScheduledDowngrade = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await upgradeDowngradeService.cancelScheduledDowngrade(
      id,
      userId
    );

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  upgradeSubscription,
  downgradeSubscription,
  cancelScheduledDowngrade,
};
