const prisma = require('../config/prisma');

const GRACE_PERIOD_DAYS = parseInt(process.env.GRACE_PERIOD_DAYS) || 7;

const SUBSCRIPTION_STATUSES = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  PAST_DUE: 'past_due',
};

const BILLING_CYCLES = {
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};

const DAYS_PER_CYCLE = {
  monthly: 30,
  yearly: 365,
};

const calculatePeriodEnd = (startDate, billingCycle) => {
  const days = DAYS_PER_CYCLE[billingCycle];
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days);
  return endDate;
};

const calculateGracePeriodEnd = (periodEnd) => {
  const graceEnd = new Date(periodEnd);
  graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);
  return graceEnd;
};

const calculatePrice = (plan, billingCycle) => {
  return billingCycle === BILLING_CYCLES.MONTHLY ? plan.priceMonthly : plan.priceYearly;
};

const validateCouponForPlan = async (couponCode, planId) => {
  if (!couponCode) {
    return null;
  }

  const coupon = await prisma.coupon.findUnique({
    where: { code: couponCode },
    include: { plans: true },
  });

  if (!coupon || !coupon.isActive) {
    const error = new Error('优惠码无效或已停用');
    error.status = 400;
    throw error;
  }

  const now = new Date();
  if (coupon.validFrom > now) {
    const error = new Error('优惠码尚未生效');
    error.status = 400;
    throw error;
  }
  if (coupon.validTo && coupon.validTo < now) {
    const error = new Error('优惠码已过期');
    error.status = 400;
    throw error;
  }

  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    const error = new Error('优惠码使用次数已达上限');
    error.status = 400;
    throw error;
  }

  if (coupon.appliesTo === 'specific_plans') {
    const planMatch = coupon.plans.some((cp) => cp.planId === planId);
    if (!planMatch) {
      const error = new Error('该优惠码不适用于此订阅计划');
      error.status = 400;
      throw error;
    }
  }

  return coupon;
};

const applyCouponDiscount = (price, coupon) => {
  if (!coupon) return price;

  const priceNum = parseFloat(price);

  if (coupon.type === 'percentage') {
    const discount = priceNum * (parseFloat(coupon.value) / 100);
    return (priceNum - discount).toFixed(2);
  } else if (coupon.type === 'fixed') {
    const result = priceNum - parseFloat(coupon.value);
    return Math.max(0, result).toFixed(2);
  }

  return price;
};

const createSubscription = async (userId, planId, billingCycle, couponCode = null) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const error = new Error('用户不存在');
    error.status = 404;
    throw error;
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    const error = new Error('订阅计划不存在');
    error.status = 404;
    throw error;
  }
  if (plan.status !== 'active') {
    const error = new Error('该订阅计划不可用');
    error.status = 400;
    throw error;
  }

  const existingActive = await prisma.subscription.findFirst({
    where: {
      userId,
      status: {
        in: [SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.PAST_DUE, SUBSCRIPTION_STATUSES.PAUSED],
      },
    },
  });
  if (existingActive) {
    const error = new Error('用户已有生效中的订阅');
    error.status = 400;
    throw error;
  }

  const coupon = await validateCouponForPlan(couponCode, planId);

  const basePrice = calculatePrice(plan, billingCycle);
  const currentPrice = applyCouponDiscount(basePrice, coupon);

  const now = new Date();
  const currentPeriodEnd = calculatePeriodEnd(now, billingCycle);
  const gracePeriodEndsAt = calculateGracePeriodEnd(currentPeriodEnd);

  const subscription = await prisma.subscription.create({
    data: {
      userId,
      planId,
      status: SUBSCRIPTION_STATUSES.ACTIVE,
      billingCycle,
      currentPrice,
      startDate: now,
      currentPeriodStart: now,
      currentPeriodEnd,
      gracePeriodEndsAt,
      autoRenew: true,
      couponId: coupon ? coupon.id : null,
    },
    include: {
      plan: true,
      coupon: true,
    },
  });

  if (coupon) {
    await prisma.coupon.update({
      where: { id: coupon.id },
      data: { usedCount: { increment: 1 } },
    });

    await prisma.couponUsage.create({
      data: {
        couponId: coupon.id,
        userId,
        subscriptionId: subscription.id,
        discountAmount: parseFloat(basePrice) - parseFloat(currentPrice),
      },
    });
  }

  return subscription;
};

const cancelSubscription = async (subscriptionId, userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    const error = new Error('订阅不存在');
    error.status = 404;
    throw error;
  }

  if (subscription.userId !== userId) {
    const error = new Error('无权操作此订阅');
    error.status = 403;
    throw error;
  }

  if (subscription.status === SUBSCRIPTION_STATUSES.CANCELLED) {
    const error = new Error('订阅已取消');
    error.status = 400;
    throw error;
  }

  if (subscription.cancelAtPeriodEnd) {
    return subscription;
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      cancelAtPeriodEnd: true,
      endsAt: subscription.currentPeriodEnd,
    },
    include: {
      plan: true,
    },
  });

  return updated;
};

const renewSubscription = async (subscriptionId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, coupon: true },
  });

  if (!subscription) {
    const error = new Error('订阅不存在');
    error.status = 404;
    throw error;
  }

  if (subscription.status === SUBSCRIPTION_STATUSES.CANCELLED ||
      subscription.status === SUBSCRIPTION_STATUSES.EXPIRED) {
    const error = new Error('订阅已取消或过期，无法续费');
    error.status = 400;
    throw error;
  }

  if (!subscription.autoRenew && subscription.status === SUBSCRIPTION_STATUSES.ACTIVE) {
    const error = new Error('自动续费已关闭，无法自动续费');
    error.status = 400;
    throw error;
  }

  const now = new Date();
  const newPeriodStart = subscription.currentPeriodEnd > now
    ? new Date(subscription.currentPeriodEnd)
    : now;
  const newPeriodEnd = calculatePeriodEnd(newPeriodStart, subscription.billingCycle);
  const newGracePeriodEnd = calculateGracePeriodEnd(newPeriodEnd);

  let currentPrice = parseFloat(subscription.currentPrice);
  if (subscription.coupon) {
    const basePrice = calculatePrice(subscription.plan, subscription.billingCycle);
    currentPrice = parseFloat(applyCouponDiscount(basePrice, subscription.coupon));
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: SUBSCRIPTION_STATUSES.ACTIVE,
      currentPeriodStart: newPeriodStart,
      currentPeriodEnd: newPeriodEnd,
      gracePeriodEndsAt: newGracePeriodEnd,
      currentPrice,
    },
    include: {
      plan: true,
    },
  });

  return updated;
};

const pauseSubscription = async (subscriptionId, reason) => {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    const error = new Error('订阅不存在');
    error.status = 404;
    throw error;
  }

  if (subscription.status !== SUBSCRIPTION_STATUSES.ACTIVE &&
      subscription.status !== SUBSCRIPTION_STATUSES.PAST_DUE) {
    const error = new Error('仅活跃或逾期状态的订阅可以暂停');
    error.status = 400;
    throw error;
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: SUBSCRIPTION_STATUSES.PAUSED,
    },
    include: {
      plan: true,
    },
  });

  return updated;
};

const resumeSubscription = async (subscriptionId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    const error = new Error('订阅不存在');
    error.status = 404;
    throw error;
  }

  if (subscription.status !== SUBSCRIPTION_STATUSES.PAUSED) {
    const error = new Error('仅暂停状态的订阅可以恢复');
    error.status = 400;
    throw error;
  }

  if (subscription.cancelAtPeriodEnd && subscription.endsAt < new Date()) {
    const error = new Error('订阅已到期取消，无法恢复');
    error.status = 400;
    throw error;
  }

  const now = new Date();
  let newStatus = SUBSCRIPTION_STATUSES.ACTIVE;
  let newPeriodEnd = subscription.currentPeriodEnd;
  let newGraceEnd = subscription.gracePeriodEndsAt;

  if (subscription.currentPeriodEnd < now) {
    if (subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt >= now) {
      newStatus = SUBSCRIPTION_STATUSES.PAST_DUE;
    } else {
      const error = new Error('订阅已过期，需重新订阅');
      error.status = 400;
      throw error;
    }
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: newStatus,
      currentPeriodEnd: newPeriodEnd,
      gracePeriodEndsAt: newGraceEnd,
    },
    include: {
      plan: true,
    },
  });

  return updated;
};

const checkAndHandleExpiredSubscriptions = async () => {
  const now = new Date();
  const results = {
    pastDue: 0,
    paused: 0,
    cancelled: 0,
    expired: 0,
  };

  const expiringSubscriptions = await prisma.subscription.findMany({
    where: {
      status: SUBSCRIPTION_STATUSES.ACTIVE,
      currentPeriodEnd: {
        lt: now,
      },
      gracePeriodEndsAt: {
        gt: now,
      },
      cancelAtPeriodEnd: false,
    },
  });

  for (const sub of expiringSubscriptions) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SUBSCRIPTION_STATUSES.PAST_DUE },
    });
    results.pastDue++;
  }

  const graceEndedSubscriptions = await prisma.subscription.findMany({
    where: {
      status: {
        in: [SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.PAST_DUE],
      },
      gracePeriodEndsAt: {
        lt: now,
      },
      cancelAtPeriodEnd: false,
    },
  });

  for (const sub of graceEndedSubscriptions) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SUBSCRIPTION_STATUSES.PAUSED },
    });
    results.paused++;
  }

  const cancelledEndedSubscriptions = await prisma.subscription.findMany({
    where: {
      status: {
        in: [SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.PAST_DUE],
      },
      cancelAtPeriodEnd: true,
      endsAt: {
        lt: now,
      },
    },
  });

  for (const sub of cancelledEndedSubscriptions) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SUBSCRIPTION_STATUSES.CANCELLED },
    });
    results.cancelled++;
  }

  const pausedExpired = await prisma.subscription.findMany({
    where: {
      status: SUBSCRIPTION_STATUSES.PAUSED,
      gracePeriodEndsAt: {
        lt: now,
      },
    },
  });

  for (const sub of pausedExpired) {
    const daysPaused = Math.floor(
      (now - new Date(sub.gracePeriodEndsAt)) / (1000 * 60 * 60 * 24)
    );
    if (daysPaused > 30) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUSES.EXPIRED },
      });
      results.expired++;
    }
  }

  return results;
};

const getSubscriptionById = async (id) => {
  const subscription = await prisma.subscription.findUnique({
    where: { id },
    include: {
      plan: true,
      coupon: true,
      invoices: {
        take: 5,
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!subscription) {
    const error = new Error('订阅不存在');
    error.status = 404;
    throw error;
  }

  return subscription;
};

const getUserSubscriptions = async (userId) => {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    include: {
      plan: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return subscriptions;
};

module.exports = {
  createSubscription,
  cancelSubscription,
  renewSubscription,
  pauseSubscription,
  resumeSubscription,
  checkAndHandleExpiredSubscriptions,
  getSubscriptionById,
  getUserSubscriptions,
  SUBSCRIPTION_STATUSES,
  BILLING_CYCLES,
  GRACE_PERIOD_DAYS,
};
