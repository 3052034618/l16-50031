const prisma = require('../config/prisma');

const FEATURE_LEVELS = {
  FREE: 'free',
  BASIC: 'basic',
  PREMIUM: 'premium',
};

const SUBSCRIPTION_STATUS_ACCESS = {
  active: {
    [FEATURE_LEVELS.FREE]: true,
    [FEATURE_LEVELS.BASIC]: true,
    [FEATURE_LEVELS.PREMIUM]: true,
  },
  past_due: {
    [FEATURE_LEVELS.FREE]: true,
    [FEATURE_LEVELS.BASIC]: true,
    [FEATURE_LEVELS.PREMIUM]: false,
  },
  paused: {
    [FEATURE_LEVELS.FREE]: true,
    [FEATURE_LEVELS.BASIC]: false,
    [FEATURE_LEVELS.PREMIUM]: false,
  },
  cancelled: {
    [FEATURE_LEVELS.FREE]: true,
    [FEATURE_LEVELS.BASIC]: false,
    [FEATURE_LEVELS.PREMIUM]: false,
  },
  expired: {
    [FEATURE_LEVELS.FREE]: true,
    [FEATURE_LEVELS.BASIC]: false,
    [FEATURE_LEVELS.PREMIUM]: false,
  },
};

const STATUS_DESCRIPTIONS = {
  active: '订阅正常',
  past_due: '宽限期内，高级功能受限',
  paused: '订阅已暂停，请续费恢复',
  cancelled: '订阅已取消',
  expired: '订阅已过期',
};

const getUserActiveSubscription = async (userId) => {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: {
        in: ['active', 'past_due', 'paused', 'cancelled', 'expired'],
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      plan: true,
    },
  });

  return subscription;
};

const requireFeature = (requiredLevel = FEATURE_LEVELS.PREMIUM) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: '请先登录',
          code: 'AUTH_REQUIRED',
        });
      }

      if (req.user.role === 'admin') {
        return next();
      }

      const subscription = await getUserActiveSubscription(req.user.id);

      if (!subscription) {
        return res.status(403).json({
          error: requiredLevel === FEATURE_LEVELS.FREE
            ? '请创建订阅'
            : requiredLevel === FEATURE_LEVELS.BASIC
              ? '此功能需要有效的订阅，请先订阅'
              : '此功能需要有效的活跃订阅，请先订阅或续费',
          code: 'SUBSCRIPTION_REQUIRED',
          subscription: null,
          requiredLevel,
        });
      }

      const accessMatrix = SUBSCRIPTION_STATUS_ACCESS[subscription.status] || {
        [FEATURE_LEVELS.FREE]: true,
        [FEATURE_LEVELS.BASIC]: false,
        [FEATURE_LEVELS.PREMIUM]: false,
      };

      const hasAccess = accessMatrix[requiredLevel] || false;

      if (!hasAccess) {
        let errorMessage = '';
        let errorCode = '';

        switch (subscription.status) {
          case 'past_due':
            errorMessage = requiredLevel === FEATURE_LEVELS.PREMIUM
              ? '您的订阅已到期，目前处于宽限期，仅可使用基础功能。请尽快续费以恢复全部功能。'
              : '您的订阅已到期，请续费恢复功能。';
            errorCode = 'SUBSCRIPTION_IN_GRACE_PERIOD';
            break;
          case 'paused':
            errorMessage = '您的订阅已暂停，请续费或恢复订阅以继续使用。';
            errorCode = 'SUBSCRIPTION_PAUSED';
            break;
          case 'cancelled':
            errorMessage = '您的订阅已取消，请重新订阅以继续使用。';
            errorCode = 'SUBSCRIPTION_CANCELLED';
            break;
          case 'expired':
            errorMessage = '您的订阅已过期，请重新订阅以继续使用。';
            errorCode = 'SUBSCRIPTION_EXPIRED';
            break;
          default:
            errorMessage = '您没有访问此功能的权限。';
            errorCode = 'INSUFFICIENT_PERMISSION';
        }

        return res.status(403).json({
          error: errorMessage,
          code: errorCode,
          subscription: {
            id: subscription.id,
            status: subscription.status,
            statusDescription: STATUS_DESCRIPTIONS[subscription.status],
            currentPeriodEnd: subscription.currentPeriodEnd,
            gracePeriodEndsAt: subscription.gracePeriodEndsAt,
            plan: subscription.plan ? {
              id: subscription.plan.id,
              name: subscription.plan.name,
            } : null,
          },
          requiredLevel,
          availableLevels: Object.entries(accessMatrix)
            .filter(([_, allowed]) => allowed)
            .map(([level]) => level),
        });
      }

      req.subscription = {
        id: subscription.id,
        status: subscription.status,
        statusDescription: STATUS_DESCRIPTIONS[subscription.status],
        plan: subscription.plan,
        currentPeriodEnd: subscription.currentPeriodEnd,
        gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        accessLevels: Object.entries(accessMatrix)
          .filter(([_, allowed]) => allowed)
          .map(([level]) => level),
      };

      next();
    } catch (error) {
      console.error('[FeatureAccess] 权限检查失败:', error);
      res.status(500).json({
        error: '权限检查失败，请稍后重试',
        code: 'FEATURE_CHECK_ERROR',
      });
    }
  };
};

const requireFree = requireFeature(FEATURE_LEVELS.FREE);
const requireBasic = requireFeature(FEATURE_LEVELS.BASIC);
const requirePremium = requireFeature(FEATURE_LEVELS.PREMIUM);

module.exports = {
  FEATURE_LEVELS,
  SUBSCRIPTION_STATUS_ACCESS,
  STATUS_DESCRIPTIONS,
  requireFeature,
  requireFree,
  requireBasic,
  requirePremium,
  getUserActiveSubscription,
};
