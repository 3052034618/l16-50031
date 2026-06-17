const prisma = require('../config/prisma');
const couponService = require('../services/couponService');

const validateCoupon = async (req, res, next) => {
  try {
    const { code, planId, billingCycle = 'monthly' } = req.query;
    const userId = req.user ? req.user.id : null;

    if (!userId) {
      const error = new Error('请先登录后再验证优惠码');
      error.status = 401;
      throw error;
    }

    const coupon = await couponService.validateCoupon(code, planId, userId);

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    let originalAmount = 0;
    if (plan) {
      originalAmount = billingCycle === 'yearly'
        ? parseFloat(plan.priceYearly)
        : parseFloat(plan.priceMonthly);
    }

    const discountAmount = couponService.calculateDiscount(coupon, originalAmount);
    const finalAmount = Math.max(0, originalAmount - discountAmount);

    const usageCheck = await prisma.couponUsage.findFirst({
      where: {
        couponId: coupon.id,
        userId,
      },
    });

    if (usageCheck) {
      const error = new Error('您已使用过此优惠码，不可重复使用');
      error.status = 400;
      throw error;
    }

    res.json({
      data: {
        coupon: {
          id: coupon.id,
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          currency: coupon.currency,
          appliesTo: coupon.appliesTo,
          description: coupon.description,
        },
        discountAmount,
        originalAmount,
        finalAmount,
        billingCycle,
        canApply: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getCoupons = async (req, res, next) => {
  try {
    const { page, limit, status, type, search } = req.query;

    const result = await couponService.listCoupons({
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      type,
      search,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};

const getCouponById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const coupon = await couponService.getCouponById(id);

    res.json({ data: coupon });
  } catch (error) {
    next(error);
  }
};

const createCoupon = async (req, res, next) => {
  try {
    const coupon = await couponService.createCoupon(req.body);

    res.status(201).json({ data: coupon });
  } catch (error) {
    next(error);
  }
};

const updateCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;

    const updatedCoupon = await couponService.updateCoupon(id, req.body);

    res.json({ data: updatedCoupon });
  } catch (error) {
    next(error);
  }
};

const deleteCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;

    const deletedCoupon = await couponService.deleteCoupon(id);

    res.json({ data: deletedCoupon });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  validateCoupon,
  getCoupons,
  getCouponById,
  createCoupon,
  updateCoupon,
  deleteCoupon,
};
