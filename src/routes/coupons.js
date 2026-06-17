const express = require('express');
const router = express.Router();

const { authenticate, requireAdmin } = require('../middleware/authMiddleware');
const {
  createCouponSchema,
  updateCouponSchema,
  validateCouponSchema,
  couponIdSchema,
  listCouponsSchema,
  validate,
  validateQuery,
  validateParams,
} = require('../validations/couponValidation');
const {
  validateCoupon,
  getCoupons,
  getCouponById,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} = require('../controllers/couponController');

router.get('/validate', authenticate, validateQuery(validateCouponSchema), validateCoupon);

router.get('/', authenticate, requireAdmin, validateQuery(listCouponsSchema), getCoupons);

router.post('/', authenticate, requireAdmin, validate(createCouponSchema), createCoupon);

router.get('/:id', authenticate, requireAdmin, validateParams(couponIdSchema), getCouponById);

router.put('/:id', authenticate, requireAdmin, validateParams(couponIdSchema), validate(updateCouponSchema), updateCoupon);

router.delete('/:id', authenticate, requireAdmin, validateParams(couponIdSchema), deleteCoupon);

module.exports = router;
