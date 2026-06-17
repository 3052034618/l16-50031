const Joi = require('joi');

const createCouponSchema = Joi.object({
  code: Joi.string().trim().min(3).max(50).required(),
  type: Joi.string().valid('percentage', 'fixed').required(),
  value: Joi.number().positive().required(),
  currency: Joi.string().when('type', {
    is: 'fixed',
    then: Joi.required(),
    otherwise: Joi.allow(null, ''),
  }),
  maxUses: Joi.number().integer().min(1).allow(null),
  validFrom: Joi.date().required(),
  validTo: Joi.date().greater(Joi.ref('validFrom')).allow(null),
  appliesTo: Joi.string().valid('all', 'specific_plans').required(),
  planIds: Joi.array().items(Joi.string().uuid()).when('appliesTo', {
    is: 'specific_plans',
    then: Joi.array().min(1).required(),
    otherwise: Joi.allow(null),
  }),
  description: Joi.string().max(500).allow(null, ''),
});

const updateCouponSchema = Joi.object({
  code: Joi.string().trim().min(3).max(50),
  type: Joi.string().valid('percentage', 'fixed'),
  value: Joi.number().positive(),
  currency: Joi.string().allow(null, ''),
  maxUses: Joi.number().integer().min(1).allow(null),
  validFrom: Joi.date(),
  validTo: Joi.date().allow(null),
  appliesTo: Joi.string().valid('all', 'specific_plans'),
  planIds: Joi.array().items(Joi.string().uuid()).allow(null),
  description: Joi.string().max(500).allow(null, ''),
  isActive: Joi.boolean(),
});

const validateCouponSchema = Joi.object({
  code: Joi.string().required(),
  planId: Joi.string().uuid().required(),
});

const couponIdSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const listCouponsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid('active', 'inactive'),
  type: Joi.string().valid('percentage', 'fixed'),
  search: Joi.string().max(100),
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
  const { error } = schema.validate(req.query, { abortEarly: false });
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
  createCouponSchema,
  updateCouponSchema,
  validateCouponSchema,
  couponIdSchema,
  listCouponsSchema,
  validate,
  validateQuery,
  validateParams,
};
