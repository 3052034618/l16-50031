const Joi = require('joi');

const registerSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': '邮箱格式不正确',
    'any.required': '邮箱是必填项',
  }),
  password: Joi.string().min(6).required().messages({
    'string.min': '密码至少需要6个字符',
    'any.required': '密码是必填项',
  }),
  name: Joi.string().optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': '邮箱格式不正确',
    'any.required': '邮箱是必填项',
  }),
  password: Joi.string().required().messages({
    'any.required': '密码是必填项',
  }),
});

function validateRegister(req, res, next) {
  const { error } = registerSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).json({ error: '参数验证失败', details: errors });
  }
  next();
}

function validateLogin(req, res, next) {
  const { error } = loginSchema.validate(req.body, { abortEarly: false });
  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).json({ error: '参数验证失败', details: errors });
  }
  next();
}

module.exports = {
  validateRegister,
  validateLogin,
};
