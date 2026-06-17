const prisma = require('../config/prisma');
const subscriptionService = require('./subscriptionService');
const invoiceService = require('./invoiceService');
const emailService = require('./emailService');
const paymentService = require('./paymentService');

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
    total: 0,
    renewed: 0,
    failed: 0,
    invoicesCreated: 0,
    invoicesPaid: 0,
    emailsSent: 0,
    failures: [],
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

    results.total = subscriptionsToRenew.length;
    console.log(`[AutoRenew] 找到 ${subscriptionsToRenew.length} 个需要自动续费的订阅`);

    for (const subscription of subscriptionsToRenew) {
      const subscriptionId = subscription.id;
      const user = subscription.user;

      try {
        console.log(`[AutoRenew] 处理订阅 ${subscriptionId}，用户: ${user.email}`);

        const invoice = await invoiceService.generateSubscriptionInvoice(
          subscription,
          invoiceService.BILLING_REASONS.SUBSCRIPTION_CYCLE,
          { autoGeneratePdf: true, paid: false }
        );
        results.invoicesCreated++;
        console.log(`[AutoRenew] 已生成续费账单: ${invoice.invoiceNumber}, 金额: $${invoice.amount}`);

        const paymentResult = await paymentService.processSubscriptionRenewalPayment(
          subscription,
          invoice
        );

        if (paymentResult.success) {
          console.log(`[AutoRenew] 订阅 ${subscriptionId} 支付成功: ${paymentResult.payment.stripePaymentId}`);

          const renewedSubscription = await subscriptionService.renewSubscription(subscriptionId);
          console.log(`[AutoRenew] 订阅 ${subscriptionId} 周期已更新，新截止日: ${renewedSubscription.currentPeriodEnd.toISOString().split('T')[0]}`);

          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              status: invoiceService.INVOICE_STATUSES.PAID,
              paidAt: new Date(),
            },
          });
          results.invoicesPaid++;

          try {
            const paidInvoice = await invoiceService.getInvoiceById(invoice.id);
            const pdfPath = await invoiceService.generateInvoicePdf(invoice.id);
            console.log(`[AutoRenew] 已重新生成已支付状态的PDF: ${pdfPath}`);
          } catch (pdfErr) {
            console.error(`[AutoRenew] 重新生成PDF失败:`, pdfErr.message);
          }

          const emailResult = await emailService.sendInvoicePaid(user, invoice);
          if (emailResult && emailResult.success && !emailResult.skipped) {
            results.emailsSent++;
            console.log(`[AutoRenew] 已向 ${user.email} 发送支付成功通知`);
          }

          results.renewed++;
        } else {
          console.warn(`[AutoRenew] 订阅 ${subscriptionId} 支付失败: ${paymentResult.failureReason}`);
          console.log(`[AutoRenew] 订阅 ${subscriptionId} 支付失败，账单 ${invoice.invoiceNumber} 保持 pending 状态，不发送支付成功通知`);

          const now = new Date();
          const gracePeriodEnd = new Date(subscription.currentPeriodEnd);
          gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

          if (subscription.status !== SUBSCRIPTION_STATUSES.PAST_DUE) {
            await prisma.subscription.update({
              where: { id: subscriptionId },
              data: {
                status: SUBSCRIPTION_STATUSES.PAST_DUE,
                gracePeriodEndsAt: gracePeriodEnd,
              },
            });
            console.log(`[AutoRenew] 订阅 ${subscriptionId} 已进入宽限期，截止: ${gracePeriodEnd.toISOString().split('T')[0]}`);

            try {
              const graceEmailResult = await emailService.sendGracePeriodStart(user, {
                ...subscription,
                gracePeriodEndsAt: gracePeriodEnd,
              });
              if (graceEmailResult && graceEmailResult.success && !graceEmailResult.skipped) {
                console.log(`[AutoRenew] 已向 ${user.email} 发送宽限期通知`);
              }
            } catch (emailErr) {
              console.error(`[AutoRenew] 发送宽限期通知失败:`, emailErr.message);
            }
          }

          results.failed++;
          results.failures.push({
            subscriptionId,
            userEmail: user.email,
            reason: paymentResult.failureReason,
            invoiceId: invoice.id,
            paymentId: paymentResult.payment?.id,
          });
        }
      } catch (error) {
        console.error(`[AutoRenew] 订阅 ${subscriptionId} 处理异常:`, error.message);
        results.failed++;
        results.failures.push({
          subscriptionId,
          userEmail: user.email,
          reason: `系统异常: ${error.message}`,
        });
      }
    }

    console.log(`[AutoRenew] ===== 自动续费执行总结 =====`);
    console.log(`[AutoRenew] 总订阅数: ${results.total}`);
    console.log(`[AutoRenew] 续费成功: ${results.renewed}`);
    console.log(`[AutoRenew] 续费失败: ${results.failed}`);
    console.log(`[AutoRenew] 生成账单: ${results.invoicesCreated}`);
    console.log(`[AutoRenew] 已支付账单: ${results.invoicesPaid}`);
    console.log(`[AutoRenew] 发送成功邮件: ${results.emailsSent}`);

    return results;
  } catch (error) {
    console.error('[AutoRenew] 处理自动续费时发生错误:', error.message);
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

        const graceResult = await emailService.sendGracePeriodStart(sub.user, sub);

        results.pastDue++;
        if (graceResult && graceResult.success && !graceResult.skipped) {
          results.graceNotificationsSent++;
        }
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

        const pauseResult = await emailService.sendSubscriptionPaused(sub.user, sub);

        results.paused++;
        if (pauseResult && pauseResult.success && !pauseResult.skipped) {
          results.pauseNotificationsSent++;
        }
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
