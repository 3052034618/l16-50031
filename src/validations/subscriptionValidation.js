const Joi = require('joi');

const createSubscriptionSchema = Joi.object({
  planId: Joi.string().uuid().required(),
  billingCycle: Joi.string().valid('monthly', 'yearly').required(),
  couponCode: Joi.string().allow(null, ''),
});

const subscriptionIdSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const cancelSubscriptionSchema = Joi.object({
  reason: Joi.string().max(500).allow(null, ''),
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
  createSubscriptionSchema,
  subscriptionIdSchema,
  cancelSubscriptionSchema,
  validate,
  validateParams,
};
