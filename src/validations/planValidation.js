const Joi = require('joi');

const createPlanSchema = Joi.object({
  name: Joi.string().required().max(100),
  description: Joi.string().max(500).allow(null, ''),
  priceMonthly: Joi.number().positive().precision(2).required(),
  priceYearly: Joi.number().positive().precision(2).required(),
  billingCycle: Joi.string().valid('monthly', 'yearly').required(),
  features: Joi.alternatives().try(Joi.object(), Joi.array()).allow(null),
  status: Joi.string().valid('active', 'inactive').default('active'),
  sortOrder: Joi.number().integer().min(0).default(0),
});

const updatePlanSchema = Joi.object({
  name: Joi.string().max(100),
  description: Joi.string().max(500).allow(null, ''),
  priceMonthly: Joi.number().positive().precision(2),
  priceYearly: Joi.number().positive().precision(2),
  billingCycle: Joi.string().valid('monthly', 'yearly'),
  features: Joi.alternatives().try(Joi.object(), Joi.array()).allow(null),
  status: Joi.string().valid('active', 'inactive'),
  sortOrder: Joi.number().integer().min(0),
}).min(1);

const getPlansSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid('active', 'inactive'),
});

const getPlanByIdSchema = Joi.object({
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

const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, { abortEarly: false });
  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  req.query = value;
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
  createPlanSchema,
  updatePlanSchema,
  getPlansSchema,
  getPlanByIdSchema,
  validate,
  validateQuery,
  validateParams,
};
