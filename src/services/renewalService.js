const prisma = require('../config/prisma');
const subscriptionService = require('./subscriptionService');
const invoiceService = require('./invoiceService');
const emailService = require('./emailService');
const paymentService = require('./paymentService');
const { parseEmailResult } = require('./emailService');

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
    invoicePaidEmailsSent: 0,
    invoicePaidEmailsSkipped: 0,
    invoicePaidEmailsFailed: 0,
    gracePeriodEmailsSent: 0,
    gracePeriodEmailsSkipped: 0,
    gracePeriodEmailsFailed: 0,
    invoicePaidEmailFailures: [],
    gracePeriodEmailFailures: [],
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
          const emailParsed = parseEmailResult(emailResult, user.email, 'invoice_paid');

          if (emailParsed.skipped) {
            results.invoicePaidEmailsSkipped++;
            console.log(`[AutoRenew] 已跳过支付成功通知 ${user.email}（${emailParsed.reason}）`);
          } else if (emailParsed.failed) {
            results.invoicePaidEmailsFailed++;
            results.invoicePaidEmailFailures.push({
              userEmail: user.email,
              subscriptionId,
              invoiceId: invoice.id,
              error: emailParsed.error,
            });
            console.error(`[AutoRenew] 向 ${user.email} 发送支付成功通知失败: ${emailParsed.error}`);
          } else if (emailParsed.success) {
            results.invoicePaidEmailsSent++;
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
              const graceParsed = parseEmailResult(graceEmailResult, user.email, 'grace_period_start');

              if (graceParsed.skipped) {
                results.gracePeriodEmailsSkipped++;
                console.log(`[AutoRenew] 已跳过宽限期通知 ${user.email}（${graceParsed.reason}）`);
              } else if (graceParsed.failed) {
                results.gracePeriodEmailsFailed++;
                results.gracePeriodEmailFailures.push({
                  userEmail: user.email,
                  subscriptionId,
                  error: graceParsed.error,
                });
                console.error(`[AutoRenew] 向 ${user.email} 发送宽限期通知失败: ${graceParsed.error}`);
              } else if (graceParsed.success) {
                results.gracePeriodEmailsSent++;
                console.log(`[AutoRenew] 已向 ${user.email} 发送宽限期通知`);
              }
            } catch (emailErr) {
              console.error(`[AutoRenew] 发送宽限期通知异常:`, emailErr.message);
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
    console.log(`[AutoRenew] 支付成功邮件 - 成功: ${results.invoicePaidEmailsSent}, 跳过: ${results.invoicePaidEmailsSkipped}, 失败: ${results.invoicePaidEmailsFailed}`);
    console.log(`[AutoRenew] 宽限期通知 - 成功: ${results.gracePeriodEmailsSent}, 跳过: ${results.gracePeriodEmailsSkipped}, 失败: ${results.gracePeriodEmailsFailed}`);

    if (results.invoicePaidEmailsFailed > 0 || results.gracePeriodEmailsFailed > 0) {
      console.warn(`[AutoRenew] ⚠️  有 ${results.invoicePaidEmailsFailed + results.gracePeriodEmailsFailed} 封邮件发送失败，请查看失败列表`);
    }

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
    graceNotificationsSkipped: 0,
    graceNotificationsFailed: 0,
    pauseNotificationsSent: 0,
    pauseNotificationsSkipped: 0,
    pauseNotificationsFailed: 0,
    graceFailedEmails: [],
    pauseFailedEmails: [],
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

        const userEmail = sub.user.email;
        const graceResult = await emailService.sendGracePeriodStart(sub.user, sub);
        const parsed = parseEmailResult(graceResult, userEmail, 'grace_period_start');

        results.pastDue++;
        if (parsed.skipped) {
          results.graceNotificationsSkipped++;
          console.log(`[ExpiredCheck] 已跳过宽限期通知 ${userEmail}（${parsed.reason}）`);
        } else if (parsed.failed) {
          results.graceNotificationsFailed++;
          results.graceFailedEmails.push({
            userEmail,
            subscriptionId: sub.id,
            error: parsed.error,
          });
          console.error(`[ExpiredCheck] 向 ${userEmail} 发送宽限期通知失败: ${parsed.error}`);
        } else if (parsed.success) {
          results.graceNotificationsSent++;
          console.log(`[ExpiredCheck] 订阅 ${sub.id} 已进入宽限期，已发送通知`);
        }
      } catch (error) {
        console.error(`[ExpiredCheck] 处理订阅 ${sub.id} 宽限期时出错:`, error.message);
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

        const userEmail = sub.user.email;
        const pauseResult = await emailService.sendSubscriptionPaused(sub.user, sub);
        const parsed = parseEmailResult(pauseResult, userEmail, 'subscription_paused');

        results.paused++;
        if (parsed.skipped) {
          results.pauseNotificationsSkipped++;
          console.log(`[ExpiredCheck] 已跳过暂停通知 ${userEmail}（${parsed.reason}）`);
        } else if (parsed.failed) {
          results.pauseNotificationsFailed++;
          results.pauseFailedEmails.push({
            userEmail,
            subscriptionId: sub.id,
            error: parsed.error,
          });
          console.error(`[ExpiredCheck] 向 ${userEmail} 发送暂停通知失败: ${parsed.error}`);
        } else if (parsed.success) {
          results.pauseNotificationsSent++;
          console.log(`[ExpiredCheck] 订阅 ${sub.id} 宽限期已过，已暂停订阅并发送通知`);
        }
      } catch (error) {
        console.error(`[ExpiredCheck] 暂停订阅 ${sub.id} 时出错:`, error.message);
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
          console.log(`[ExpiredCheck] 订阅 ${sub.id} 暂停超过30天，已标记为过期`);
        }
      } catch (error) {
        console.error(`[ExpiredCheck] 处理过期订阅 ${sub.id} 时出错:`, error.message);
      }
    }

    console.log(`[ExpiredCheck] ===== 过期订阅处理执行总结 =====`);
    console.log(`[ExpiredCheck] 进入宽限期: ${results.pastDue}`);
    console.log(`[ExpiredCheck] 宽限期通知 - 成功: ${results.graceNotificationsSent}, 跳过: ${results.graceNotificationsSkipped}, 失败: ${results.graceNotificationsFailed}`);
    console.log(`[ExpiredCheck] 已暂停: ${results.paused}`);
    console.log(`[ExpiredCheck] 暂停通知 - 成功: ${results.pauseNotificationsSent}, 跳过: ${results.pauseNotificationsSkipped}, 失败: ${results.pauseNotificationsFailed}`);
    console.log(`[ExpiredCheck] 已取消: ${results.cancelled}`);
    console.log(`[ExpiredCheck] 已过期: ${results.expired}`);

    if (results.graceNotificationsFailed > 0 || results.pauseNotificationsFailed > 0) {
      console.warn(`[ExpiredCheck] ⚠️  有 ${results.graceNotificationsFailed + results.pauseNotificationsFailed} 封通知发送失败，请查看失败列表`);
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
    total: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    skippedEmails: [],
    failedEmails: [],
  };

  try {
    const subscriptions = await getSubscriptionsExpiringInDays(days);

    results.total = subscriptions.length;
    console.log(`[RenewalReminder] 找到 ${subscriptions.length} 个将在 ${days} 天后到期的订阅，准备发送提醒`);

    for (const subscription of subscriptions) {
      const userEmail = subscription.user.email;
      const notificationType = `renewal_reminder_${days}d`;

      try {
        const result = await emailService.sendRenewalReminder(
          subscription.user,
          subscription,
          parseInt(days, 10)
        );

        const parsed = parseEmailResult(result, userEmail, notificationType);

        if (parsed.skipped) {
          results.skipped++;
          results.skippedEmails.push({
            userEmail,
            subscriptionId: subscription.id,
            reason: parsed.reason,
          });
          console.log(`[RenewalReminder] 已跳过 ${userEmail}（${parsed.reason}）`);
        } else if (parsed.failed) {
          results.failed++;
          results.failedEmails.push({
            userEmail,
            subscriptionId: subscription.id,
            error: parsed.error,
          });
          console.error(`[RenewalReminder] 向 ${userEmail} 发送续费提醒失败: ${parsed.error}`);
        } else if (parsed.success) {
          results.sent++;
          console.log(`[RenewalReminder] 已向 ${userEmail} 发送 ${days} 天续费提醒`);
        }
      } catch (error) {
        results.failed++;
        results.failedEmails.push({
          userEmail,
          subscriptionId: subscription.id,
          error: error.message,
        });
        console.error(`[RenewalReminder] 向 ${userEmail} 发送续费提醒异常:`, error.message);
      }
    }

    console.log(`[RenewalReminder] ===== ${days}天续费提醒执行总结 =====`);
    console.log(`[RenewalReminder] 总用户数: ${results.total}`);
    console.log(`[RenewalReminder] 成功发送: ${results.sent}`);
    console.log(`[RenewalReminder] 跳过发送: ${results.skipped}`);
    console.log(`[RenewalReminder] 发送失败: ${results.failed}`);

    return results;
  } catch (error) {
    console.error(`[RenewalReminder] 发送 ${days} 天续费提醒时发生错误:`, error.message);
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
