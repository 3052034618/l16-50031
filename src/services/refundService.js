const prisma = require('../config/prisma');

const REFUND_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REFUNDED: 'refunded',
  FAILED: 'failed',
};

const PAYMENT_STATUSES = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  PENDING: 'pending',
  REFUNDED: 'refunded',
};

const INVOICE_STATUSES = {
  DRAFT: 'draft',
  PENDING: 'pending',
  PAID: 'paid',
  VOID: 'void',
  UNCOLLECTIBLE: 'uncollectible',
  REFUNDED: 'refund',
};

const processRefund = async (payment, amount) => {
  return new Promise((resolve, reject) => {
    try {
      console.log(`[Refund] ===== 开始调用支付网关退款 ====`);
      console.log(`[Refund] 支付ID: ${payment.id}`);
      console.log(`[Refund] Stripe支付ID: ${payment.stripePaymentId || 'N/A'}`);
      console.log(`[Refund] 退款金额: ${amount}`);
      console.log(`[Refund] 支付金额: ${payment.amount}`);

      const shouldFail = Math.random() < 0.05;
      if (shouldFail) {
        console.error(`[Refund] 支付网关返回错误：余额不足或网络超时`);
        reject(new Error('支付网关退款失败：网络超时，请稍后重试'));
        return;
      }

      const mockRefundId = `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`[Refund] 支付网关退款成功，退款ID: ${mockRefundId}`);
      console.log(`[Refund] ===== 退款完成 ====`);

      resolve({
        success: true,
        stripeRefundId: mockRefundId,
        amount: parseFloat(amount),
        refundedAt: new Date(),
      });
    } catch (error) {
      console.error(`[Refund] 调用退款接口异常:`, error);
      reject(error);
    }
  });
};

const createRefundRequest = async (userId, paymentId, amount, reason) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      invoice: true,
      subscription: true,
    },
  });

  if (!payment) {
    const error = new Error('支付记录不存在');
    error.status = 404;
    throw error;
  }

  if (payment.userId !== userId) {
    const error = new Error('无权对此支付申请退款');
    error.status = 403;
    throw error;
  }

  if (payment.status !== PAYMENT_STATUSES.SUCCEEDED) {
    const error = new Error('只有支付状态不支持退款');
    error.status = 400;
    throw error;
  }

  const refundAmount = parseFloat(amount);
  const paymentAmount = parseFloat(payment.amount);
  if (refundAmount <= 0) {
    const error = new Error('退款金额必须大于0');
    error.status = 400;
    throw error;
  }
  if (refundAmount > paymentAmount) {
    const error = new Error('退款金额不能超过支付金额');
    error.status = 400;
    throw error;
  }

  const existingPendingRefund = await prisma.refund.findFirst({
    where: {
      paymentId,
      status: {
      in: [REFUND_STATUSES.PENDING, REFUND_STATUSES.APPROVED],
      },
    },
  });

  if (existingPendingRefund) {
    const error = new Error('该支付已有待处理的退款申请');
    error.status = 400;
    throw error;
  }

  const refundedTotal = await prisma.refund.aggregate({
    _sum: {
      amount: true,
    },
    where: {
      paymentId,
      status: {
        in: [REFUND_STATUSES.REFUNDED, REFUND_STATUSES.APPROVED],
      },
    },
  });

  const alreadyRefunded = parseFloat(refundedTotal._sum.amount || 0);
  if (alreadyRefunded + refundAmount > paymentAmount) {
    const error = new Error('退款总金额不能超过支付金额');
    error.status = 400;
    throw error;
  }

  const refund = await prisma.refund.create({
    data: {
      userId,
      paymentId,
      invoiceId: payment.invoiceId || null,
      subscriptionId: payment.subscriptionId || null,
      amount: refundAmount,
      reason,
      status: REFUND_STATUSES.PENDING,
      requestedBy: 'user',
    },
    include: {
      payment: true,
      invoice: true,
      subscription: {
        include: {
          plan: true,
        },
      },
    },
  });

  return refund;
};

const approveRefund = async (refundId, adminId, adminNote = '') => {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: {
      payment: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      subscription: true,
      invoice: true,
    },
  });

  if (!refund) {
    const error = new Error('退款申请不存在');
    error.status = 404;
    throw error;
  }

  if (refund.status !== REFUND_STATUSES.PENDING) {
    const error = new Error('只有待审核的退款申请才能通过审核');
    error.status = 400;
    throw error;
  }

  let finalRefund;
  let refundResult = null;

  await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refundId },
      data: {
        status: REFUND_STATUSES.APPROVED,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        adminNote,
      },
    });
  });

  try {
    refundResult = await processRefund(refund.payment, refund.amount);
  } catch (refundError) {
    await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: REFUND_STATUSES.FAILED,
        failureReason: refundError.message,
      },
    });

    console.error(`[Refund] 退款单 ${refundId} 支付网关退款失败:`, refundError.message);
    const error = new Error(`退款失败：${refundError.message}，退款单已标记为失败状态，请稍后重试`);
    error.status = 502;
    error.refundStatus = REFUND_STATUSES.FAILED;
    throw error;
  }

  try {
    finalRefund = await prisma.$transaction(async (tx) => {
      const updatedRefund = await tx.refund.update({
        where: { id: refundId },
        data: {
          status: REFUND_STATUSES.REFUNDED,
          stripeRefundId: refundResult.stripeRefundId,
          refundedAt: refundResult.refundedAt,
        },
        include: {
          payment: true,
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          subscription: true,
          invoice: true,
        },
      });

      await tx.payment.update({
        where: { id: refund.paymentId },
        data: {
          status: PAYMENT_STATUSES.REFUNDED,
        },
      });

      if (refund.invoiceId) {
        await tx.invoice.update({
          where: { id: refund.invoiceId },
          data: {
            status: INVOICE_STATUSES.VOID,
          },
        });
      }

      if (refund.subscriptionId) {
        const subscription = await tx.subscription.findUnique({
          where: { id: refund.subscriptionId },
          include: { plan: true },
        });

        if (subscription && subscription.status !== 'cancelled') {
          const refundRatio = parseFloat(refund.amount) / parseFloat(refund.payment.amount);
          const now = new Date();

          if (refundRatio >= 0.9) {
            await tx.subscription.update({
              where: { id: refund.subscriptionId },
              data: {
                status: 'cancelled',
                cancelAtPeriodEnd: true,
                endsAt: now,
              },
            });
            console.log(`[Refund] 订阅 ${refund.subscriptionId} 已因全额退款而取消`);
          } else if (refundRatio >= 0.5) {
            await tx.subscription.update({
              where: { id: refund.subscriptionId },
              data: {
                cancelAtPeriodEnd: true,
                endsAt: subscription.currentPeriodEnd,
              },
            });
            console.log(`[Refund] 订阅 ${refund.subscriptionId} 已设置为到期取消（部分退款）`);
          }
        }
      }

      return updatedRefund;
    });
  } catch (dbError) {
    console.error(`[Refund] 退款成功但同步状态失败 ${refundId}:`, dbError.message);

    if (refundResult) {
      await prisma.refund.update({
        where: { id: refundId },
        data: {
          status: REFUND_STATUSES.REFUNDED,
          stripeRefundId: refundResult.stripeRefundId,
          refundedAt: refundResult.refundedAt,
        },
      });
      await prisma.payment.update({
        where: { id: refund.paymentId },
        data: { status: PAYMENT_STATUSES.REFUNDED },
      });
      if (refund.invoiceId) {
        await prisma.invoice.update({
          where: { id: refund.invoiceId },
          data: { status: INVOICE_STATUSES.VOID },
        });
      }
    }

    finalRefund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: true,
        user: { select: { id: true, email: true, name: true } },
        subscription: true,
        invoice: true,
      },
    });
  }

  try {
    const emailService = require('./emailService');
    if (finalRefund && finalRefund.user && finalRefund.user.email) {
      await emailService.sendRefundProcessed(finalRefund.user, finalRefund);
    }
  } catch (emailError) {
    console.error(`[Refund] 退款通知邮件发送失败 ${refundId}:`, emailError.message);
  }

  return finalRefund;
};

const rejectRefund = async (refundId, adminId, adminNote = '') => {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
  });

  if (!refund) {
    const error = new Error('退款申请不存在');
    error.status = 404;
    throw error;
  }

  if (refund.status !== REFUND_STATUSES.PENDING) {
    const error = new Error('只有待审核的退款申请才能驳回');
    error.status = 400;
    throw error;
  }

  const updatedRefund = await prisma.refund.update({
    where: { id: refundId },
    data: {
      status: REFUND_STATUSES.REJECTED,
      reviewedBy: adminId,
      reviewedAt: new Date(),
      adminNote,
    },
    include: {
      payment: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  return updatedRefund;
};

const getRefundById = async (id, userId = null, isAdmin = false) => {
  const refund = await prisma.refund.findUnique({
    where: { id },
    include: {
      payment: true,
      invoice: true,
      subscription: {
        include: {
          plan: true,
        },
      },
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  if (!refund) {
    const error = new Error('退款记录不存在');
    error.status = 404;
    throw error;
  }

  if (!isAdmin && userId && refund.userId !== userId) {
    const error = new Error('无权访问此退款记录');
    error.status = 403;
    throw error;
  }

  return refund;
};

const getUserRefunds = async (userId, options = {}) => {
  const {
    page = 1,
    limit = 10,
    status = null,
  } = options;

  const skip = (page - 1) * limit;

  const where = { userId };
  if (status) {
    where.status = status;
  }

  const [refunds, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      include: {
        payment: true,
        subscription: {
          include: {
            plan: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.refund.count({ where }),
  ]);

  return {
    data: refunds,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const listAllRefunds = async (options = {}) => {
  const {
    page = 1,
    limit = 10,
    status = null,
  } = options;

  const skip = (page - 1) * limit;

  const where = {};
  if (status) {
    where.status = status;
  }

  const [refunds, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      include: {
        payment: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        subscription: {
          include: {
            plan: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.refund.count({ where }),
  ]);

  return {
    data: refunds,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

module.exports = {
  createRefundRequest,
  approveRefund,
  rejectRefund,
  getRefundById,
  getUserRefunds,
  listAllRefunds,
  processRefund,
  REFUND_STATUSES,
  PAYMENT_STATUSES,
  INVOICE_STATUSES,
};
