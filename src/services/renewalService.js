const prisma = require('../config/prisma');
const subscriptionService = require('./subscriptionService');
const invoiceService = require('./invoiceService');
const emailService = require('./emailService');

const GRACE_PERIOD_DAYS = parseInt(process.env.GRACE_PERIOD_DAYS) || 7;

const SUBSCRIPTION_STATUSES = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  PAST_DUE: 'past_due',
};

const getSubscriptionsExpiringInDays = async (days) => {
  const now = new Date();
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + parseInt(days, 10));

  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: SUBSCRIPTION_STATUSES.ACTIVE,
      currentPeriodEnd: {
        gte: startOfDay,
        lte: endOfDay,
      },
      cancelAtPeriodEnd: false,
    },
    include: {
      plan: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  return subscriptions;
};

const getExpiredSubscriptions = async () => {
  const now = new Date();

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: {
        in: [SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.PAST_DUE],
      },
      currentPeriodEnd: {
        lt: now,
      },
      cancelAtPeriodEnd: false,
    },
    include: {
      plan: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  return subscriptions;
};

const processAutoRenewal = async () => {
  const results = {
    renewed: 0,
    failed: 0,
    invoicesCreated: 0,
  };

  try {
    const now = new Date();

    const subscriptionsToRenew = await prisma.subscription.findMany({
      where: {
        status: {
          in: [SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.PAST_DUE],
        },
        autoRenew: true,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: {
          lte: now,
        },
      },
      include: {
        plan: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    console.log(`找到 ${subscriptionsToRenew.length} 个需要自动续费的订阅`);

    for (const subscription of subscriptionsToRenew) {
      try {
        const renewedSubscription = await subscriptionService.renewSubscription(subscription.id);

        const invoice = await invoiceService.generateSubscriptionInvoice(
          renewedSubscription,
          invoiceService.BILLING_REASONS.SUBSCRIPTION_CYCLE
        );

        await emailService.sendInvoicePaid(
          subscription.user,
          invoice
        );

        results.renewed++;
        results.invoicesCreated++;

        console.log(`订阅 ${subscription.id} 自动续费成功`);
      } catch (error) {
        results.failed++;
        console.error(`订阅 ${subscription.id} 自动续费失败:`, error.message);
      }
    }

    return results;
  } catch (error) {
    console.error('处理自动续费时发生错误:', error.message);
    throw error;
  }
};

const processExpiredSubscriptions = async () => {
  const results = {
    pastDue: 0,
    paused: 0,
    cancelled: 0,
    expired: 0,
    graceNotificationsSent: 0,
    pauseNotificationsSent: 0,
  };

  try {
    const now = new Date();

    const newlyExpired = await prisma.subscription.findMany({
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
      include: {
        plan: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    for (const sub of newlyExpired) {
      try {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: SUBSCRIPTION_STATUSES.PAST_DUE },
        });

        await emailService.sendGracePeriodStart(sub.user, sub);

        results.pastDue++;
        results.graceNotificationsSent++;
        console.log(`订阅 ${sub.id} 已进入宽限期，已发送通知`);
      } catch (error) {
        console.error(`处理订阅 ${sub.id} 宽限期时出错:`, error.message);
      }
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
      include: {
        plan: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    for (const sub of graceEndedSubscriptions) {
      try {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: SUBSCRIPTION_STATUSES.PAUSED },
        });

        await emailService.sendSubscriptionPaused(sub.user, sub);

        results.paused++;
        results.pauseNotificationsSent++;
        console.log(`订阅 ${sub.id} 宽限期已过，已暂停订阅并发送通知`);
      } catch (error) {
        console.error(`暂停订阅 ${sub.id} 时出错:`, error.message);
      }
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
      try {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: SUBSCRIPTION_STATUSES.CANCELLED },
        });
        results.cancelled++;
        console.log(`订阅 ${sub.id} 已到期取消`);
      } catch (error) {
        console.error(`取消订阅 ${sub.id} 时出错:`, error.message);
      }
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
      try {
        const daysPaused = Math.floor(
          (now - new Date(sub.gracePeriodEndsAt)) / (1000 * 60 * 60 * 24)
        );
        if (daysPaused > 30) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: SUBSCRIPTION_STATUSES.EXPIRED },
          });
          results.expired++;
          console.log(`订阅 ${sub.id} 暂停超过30天，已标记为过期`);
        }
      } catch (error) {
        console.error(`处理过期订阅 ${sub.id} 时出错:`, error.message);
      }
    }

    return results;
  } catch (error) {
    console.error('处理过期订阅时发生错误:', error.message);
    throw error;
  }
};

const sendRenewalReminders = async (days) => {
  const results = {
    days,
    sent: 0,
    failed: 0,
  };

  try {
    const subscriptions = await getSubscriptionsExpiringInDays(days);

    console.log(`找到 ${subscriptions.length} 个将在 ${days} 天后到期的订阅，准备发送提醒`);

    for (const subscription of subscriptions) {
      try {
        await emailService.sendRenewalReminder(
          subscription.user,
          subscription,
          parseInt(days, 10)
        );
        results.sent++;
        console.log(`已向 ${subscription.user.email} 发送 ${days} 天续费提醒`);
      } catch (error) {
        results.failed++;
        console.error(`向 ${subscription.user.email} 发送续费提醒失败:`, error.message);
      }
    }

    return results;
  } catch (error) {
    console.error(`发送 ${days} 天续费提醒时发生错误:`, error.message);
    throw error;
  }
};

module.exports = {
  getSubscriptionsExpiringInDays,
  getExpiredSubscriptions,
  processAutoRenewal,
  processExpiredSubscriptions,
  sendRenewalReminders,
};
