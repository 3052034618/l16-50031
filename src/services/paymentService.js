const prisma = require('../config/prisma');

const PAYMENT_STATUSES = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  PENDING: 'pending',
  REFUNDED: 'refunded',
};

const PAYMENT_METHODS = {
  CARD: 'card',
  BANK_TRANSFER: 'bank_transfer',
};

const processPayment = async (userId, subscription, invoice, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      console.log(`[Payment] ===== 开始处理支付 ====`);
      console.log(`[Payment] 用户ID: ${userId}`);
      console.log(`[Payment] 订阅ID: ${subscription?.id || 'N/A'}`);
      console.log(`[Payment] 账单ID: ${invoice?.id || 'N/A'}`);
      console.log(`[Payment] 账单号: ${invoice?.invoiceNumber || 'N/A'}`);
      console.log(`[Payment] 金额: $${invoice?.amount || subscription?.currentPrice || '0'}`);

      const shouldFail = options.forceFail || (Math.random() < 0.08);

      if (shouldFail) {
        const failureReasons = [
          '信用卡余额不足',
          '信用卡已过期',
          '支付网关网络超时',
          '银行拒绝交易',
          'CVV验证失败',
        ];
        const failureReason = failureReasons[Math.floor(Math.random() * failureReasons.length)];
        console.error(`[Payment] 支付失败: ${failureReason}`);

        const error = new Error(failureReason);
        error.paymentStatus = PAYMENT_STATUSES.FAILED;
        error.failureReason = failureReason;
        reject(error);
        return;
      }

      const mockPaymentId = `pi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const paidAt = new Date();
      const amount = parseFloat(invoice?.amount || subscription?.currentPrice || 0);

      console.log(`[Payment] 支付成功，支付ID: ${mockPaymentId}`);
      console.log(`[Payment] 支付时间: ${paidAt.toISOString()}`);
      console.log(`[Payment] ===== 支付完成 ====`);

      resolve({
        success: true,
        stripePaymentId: mockPaymentId,
        amount,
        paidAt,
        paymentMethod: options.paymentMethod || PAYMENT_METHODS.CARD,
      });
    } catch (error) {
      console.error(`[Payment] 处理支付时发生异常:`, error.message);
      reject(error);
    }
  });
};

const recordPayment = async (paymentData) => {
  const {
    userId,
    subscriptionId = null,
    invoiceId = null,
    amount,
    status = PAYMENT_STATUSES.SUCCEEDED,
    paymentMethod = PAYMENT_METHODS.CARD,
    stripePaymentId = null,
    failureReason = null,
    paidAt = null,
  } = paymentData;

  const payment = await prisma.payment.create({
    data: {
      userId,
      subscriptionId,
      invoiceId,
      amount: parseFloat(amount),
      status,
      paymentMethod,
      stripePaymentId,
      failureReason,
      paidAt: status === PAYMENT_STATUSES.SUCCEEDED ? (paidAt || new Date()) : null,
    },
  });

  console.log(`[Payment] 支付记录已保存: ${payment.id} (${status})`);
  return payment;
};

const processSubscriptionRenewalPayment = async (subscription, invoice) => {
  let paymentResult;
  let paymentRecord;

  try {
    paymentResult = await processPayment(
      subscription.userId,
      subscription,
      invoice
    );

    paymentRecord = await recordPayment({
      userId: subscription.userId,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      amount: paymentResult.amount,
      status: PAYMENT_STATUSES.SUCCEEDED,
      paymentMethod: paymentResult.paymentMethod,
      stripePaymentId: paymentResult.stripePaymentId,
      paidAt: paymentResult.paidAt,
    });

    return {
      success: true,
      payment: paymentRecord,
      paymentResult,
    };
  } catch (paymentError) {
    paymentRecord = await recordPayment({
      userId: subscription.userId,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      amount: invoice.amount,
      status: PAYMENT_STATUSES.FAILED,
      paymentMethod: PAYMENT_METHODS.CARD,
      failureReason: paymentError.failureReason || paymentError.message,
    });

    return {
      success: false,
      payment: paymentRecord,
      error: paymentError,
      failureReason: paymentError.failureReason || paymentError.message,
    };
  }
};

const getPaymentsByUser = async (userId, options = {}) => {
  const { page = 1, limit = 10, status = null } = options;
  const skip = (page - 1) * limit;

  const where = { userId };
  if (status) {
    where.status = status;
  }

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        subscription: { include: { plan: true } },
        invoice: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    data: payments,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

module.exports = {
  processPayment,
  recordPayment,
  processSubscriptionRenewalPayment,
  getPaymentsByUser,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
};
