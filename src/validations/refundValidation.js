const Joi = require('joi');

const createRefundSchema = Joi.object({
  paymentId: Joi.string().uuid().required(),
  amount: Joi.number().positive().required(),
  reason: Joi.string().min(1).max(500).required(),
});

const refundIdSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const getRefundsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid('pending', 'approved', 'rejected', 'refunded', 'failed'),
});

const reviewRefundSchema = Joi.object({
  adminNote: Joi.string().max(500).allow('').optional(),
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

const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, { abortEarly: false });
  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  req.query = value;
  next();
};

module.exports = {
  createRefundSchema,
  refundIdSchema,
  getRefundsSchema,
  reviewRefundSchema,
  validate,
  validateParams,
  validateQuery,
};
