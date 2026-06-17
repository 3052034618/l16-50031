const prisma = require('../config/prisma');

const DAYS_PER_CYCLE = {
  monthly: 30,
  yearly: 365,
};

const DOWNGRADE_STATUSES = {
  SCHEDULED: 'scheduled',
  APPLIED: 'applied',
  CANCELLED: 'cancelled',
};

const calculatePrice = (plan, billingCycle) => {
  return billingCycle === 'monthly' ? plan.priceMonthly : plan.priceYearly;
};

const calculateRemainingDays = (currentPeriodEnd) => {
  const now = new Date();
  const end = new Date(currentPeriodEnd);
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

const calculateProratedAmount = (oldPrice, newPrice, remainingDays, billingCycle) => {
  const daysInCycle = DAYS_PER_CYCLE[billingCycle];
  const oldPriceNum = parseFloat(oldPrice);
  const newPriceNum = parseFloat(newPrice);
  const priceDiff = newPriceNum - oldPriceNum;
  const proratedAmount = (priceDiff * remainingDays) / daysInCycle;
  return Math.max(0, parseFloat(proratedAmount.toFixed(2)));
};

const generateInvoiceNumber = () => {
  const date = new Date();
  const timestamp = date.getTime().toString().slice(-8);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `INV-${timestamp}${random}`;
};

const upgradeSubscription = async (subscriptionId, newPlanId, userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
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

  if (subscription.status !== 'active') {
    const error = new Error('仅活跃状态的订阅可以升级');
    error.status = 400;
    throw error;
  }

  const newPlan = await prisma.plan.findUnique({
    where: { id: newPlanId },
  });

  if (!newPlan) {
    const error = new Error('目标订阅计划不存在');
    error.status = 404;
    throw error;
  }

  if (newPlan.status !== 'active') {
    const error = new Error('目标订阅计划不可用');
    error.status = 400;
    throw error;
  }

  const oldPrice = calculatePrice(subscription.plan, subscription.billingCycle);
  const newPrice = calculatePrice(newPlan, subscription.billingCycle);

  if (parseFloat(newPrice) <= parseFloat(oldPrice)) {
    const error = new Error('新计划价格不高于当前计划，不属于升级');
    error.status = 400;
    throw error;
  }

  const remainingDays = calculateRemainingDays(subscription.currentPeriodEnd);

  if (remainingDays <= 0) {
    const error = new Error('当前订阅周期已结束，无法升级');
    error.status = 400;
    throw error;
  }

  const proratedAmount = calculateProratedAmount(
    oldPrice,
    newPrice,
    remainingDays,
    subscription.billingCycle
  );

  const result = await prisma.$transaction(async (tx) => {
    const upgradeRecord = await tx.subscriptionUpgrade.create({
      data: {
        subscriptionId,
        fromPlanId: subscription.planId,
        toPlanId: newPlanId,
        fromPrice: oldPrice,
        toPrice: newPrice,
        proratedAmount,
        remainingDays,
        effectiveDate: new Date(),
      },
    });

    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        planId: newPlanId,
        currentPrice: newPrice,
        nextPlanId: null,
      },
    });

    const invoiceNumber = await tx.invoice.count({
      where: { invoiceNumber: { startsWith: `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}` } },
    }).then(count => {
      const date = new Date();
      const prefix = `INV-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
      return `${prefix}-${String(count + 1).padStart(4, '0')}`;
    });

    const invoice = await tx.invoice.create({
      data: {
        userId: subscription.userId,
        subscriptionId,
        invoiceNumber,
        amount: proratedAmount,
        subtotal: proratedAmount,
        tax: 0,
        discount: 0,
        status: 'pending',
        billingReason: 'subscription_update',
        dueDate: new Date(),
        items: {
          create: {
            description: `订阅升级差价 (${subscription.plan.name} → ${newPlan.name})`,
            quantity: 1,
            unitAmount: proratedAmount,
            amount: proratedAmount,
            periodStart: new Date(),
            periodEnd: subscription.currentPeriodEnd,
          },
        },
      },
      include: {
        items: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    const updatedSubscription = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    return {
      subscription: updatedSubscription,
      upgradeRecord,
      invoice,
      proratedAmount,
      remainingDays,
    };
  });

  if (result.invoice) {
    try {
      const pdfService = require('./pdfService');
      const fs = require('fs');
      const path = require('path');
      const invoicesDir = path.join(process.cwd(), 'invoices');
      if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir, { recursive: true });
      }
      const pdfPath = await pdfService.generateInvoicePdf(result.invoice, result.invoice.items, result.invoice.user);
      await prisma.invoice.update({
        where: { id: result.invoice.id },
        data: { pdfUrl: pdfPath },
      });
      result.invoice.pdfUrl = pdfPath;
    } catch (pdfError) {
      console.error(`[UpgradeDowngrade] 升级账单PDF生成失败:`, pdfError.message);
    }
  }

  return result;
};

const downgradeSubscription = async (subscriptionId, newPlanId, userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
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

  if (subscription.status !== 'active') {
    const error = new Error('仅活跃状态的订阅可以降级');
    error.status = 400;
    throw error;
  }

  const newPlan = await prisma.plan.findUnique({
    where: { id: newPlanId },
  });

  if (!newPlan) {
    const error = new Error('目标订阅计划不存在');
    error.status = 404;
    throw error;
  }

  if (newPlan.status !== 'active') {
    const error = new Error('目标订阅计划不可用');
    error.status = 400;
    throw error;
  }

  const oldPrice = calculatePrice(subscription.plan, subscription.billingCycle);
  const newPrice = calculatePrice(newPlan, subscription.billingCycle);

  if (parseFloat(newPrice) >= parseFloat(oldPrice)) {
    const error = new Error('新计划价格不低于当前计划，不属于降级');
    error.status = 400;
    throw error;
  }

  const existingScheduled = await prisma.subscriptionDowngrade.findFirst({
    where: {
      subscriptionId,
      status: DOWNGRADE_STATUSES.SCHEDULED,
    },
  });

  const result = await prisma.$transaction(async (tx) => {
    if (existingScheduled) {
      await tx.subscriptionDowngrade.update({
        where: { id: existingScheduled.id },
        data: {
          status: DOWNGRADE_STATUSES.CANCELLED,
        },
      });
    }

    const downgradeRecord = await tx.subscriptionDowngrade.create({
      data: {
        subscriptionId,
        fromPlanId: subscription.planId,
        toPlanId: newPlanId,
        scheduledDate: subscription.currentPeriodEnd,
        status: DOWNGRADE_STATUSES.SCHEDULED,
      },
    });

    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        nextPlanId: newPlanId,
      },
    });

    const updatedSubscription = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, nextPlan: true },
    });

    return {
      subscription: updatedSubscription,
      downgradeRecord,
      scheduledDate: subscription.currentPeriodEnd,
    };
  });

  return result;
};

const applyScheduledDowngrades = async () => {
  const now = new Date();
  const results = {
    applied: 0,
    failed: 0,
  };

  const scheduledDowngrades = await prisma.subscriptionDowngrade.findMany({
    where: {
      status: DOWNGRADE_STATUSES.SCHEDULED,
      scheduledDate: {
        lte: now,
      },
    },
    include: {
      subscription: {
        include: {
          plan: true,
        },
      },
      toPlan: true,
    },
  });

  for (const downgrade of scheduledDowngrades) {
    try {
      await prisma.$transaction(async (tx) => {
        const newPrice = calculatePrice(downgrade.toPlan, downgrade.subscription.billingCycle);

        await tx.subscription.update({
          where: { id: downgrade.subscriptionId },
          data: {
            planId: downgrade.toPlanId,
            currentPrice: newPrice,
            nextPlanId: null,
          },
        });

        await tx.subscriptionDowngrade.update({
          where: { id: downgrade.id },
          data: {
            status: DOWNGRADE_STATUSES.APPLIED,
            effectiveDate: now,
          },
        });
      });

      results.applied++;
    } catch (error) {
      results.failed++;
      console.error(`应用降级失败 ${downgrade.id}:`, error.message);
    }
  }

  return results;
};

const cancelScheduledDowngrade = async (subscriptionId, userId) => {
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

  const scheduledDowngrade = await prisma.subscriptionDowngrade.findFirst({
    where: {
      subscriptionId,
      status: DOWNGRADE_STATUSES.SCHEDULED,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!scheduledDowngrade) {
    const error = new Error('没有待生效的降级计划');
    error.status = 400;
    throw error;
  }

  const result = await prisma.$transaction(async (tx) => {
    const cancelledRecord = await tx.subscriptionDowngrade.update({
      where: { id: scheduledDowngrade.id },
      data: {
        status: DOWNGRADE_STATUSES.CANCELLED,
      },
    });

    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        nextPlanId: null,
      },
    });

    const updatedSubscription = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    return {
      subscription: updatedSubscription,
      cancelledRecord,
    };
  });

  return result;
};

module.exports = {
  upgradeSubscription,
  downgradeSubscription,
  applyScheduledDowngrades,
  cancelScheduledDowngrade,
  calculateRemainingDays,
  calculateProratedAmount,
  DOWNGRADE_STATUSES,
};
