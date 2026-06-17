const Joi = require('joi');

const upgradeSubscriptionSchema = Joi.object({
  newPlanId: Joi.string().uuid().required(),
});

const downgradeSubscriptionSchema = Joi.object({
  newPlanId: Joi.string().uuid().required(),
});

const subscriptionIdSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  next();
};

const validateParams = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.params, { abortEarly: false });
  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  next();
};

module.exports = {
  upgradeSubscriptionSchema,
  downgradeSubscriptionSchema,
  subscriptionIdSchema,
  validate,
  validateParams,
};
