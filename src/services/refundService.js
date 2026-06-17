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

const processRefund = async (payment, amount) => {
  try {
    console.log(`[Refund] 模拟调用 Stripe 退款接口`);
    console.log(`  - 支付ID: ${payment.id}`);
    console.log(`  - Stripe支付ID: ${payment.stripePaymentId || 'N/A'}`);
    console.log(`  - 退款金额: ${amount}`);

    const mockRefundId = `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`  - 模拟退款成功，退款ID: ${mockRefundId}`);

    return {
      success: true,
      stripeRefundId: mockRefundId,
      amount: parseFloat(amount),
      refundedAt: new Date(),
    };
  } catch (error) {
    console.error(`[Refund] 退款接口调用失败:`, error);
    throw new Error('支付网关退款失败');
  }
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

  const updatedRefund = await prisma.$transaction(async (tx) => {
    const approvedRefund = await tx.refund.update({
      where: { id: refundId },
      data: {
        status: REFUND_STATUSES.APPROVED,
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

    let refundResult;
    try {
      refundResult = await processRefund(refund.payment, refund.amount);
    } catch (refundError) {
      await tx.refund.update({
        where: { id: refundId },
        data: {
          status: REFUND_STATUSES.FAILED,
          failureReason: refundError.message,
        },
      });
      throw refundError;
    }

    const finalRefund = await tx.refund.update({
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
      },
    });

    await tx.payment.update({
      where: { id: refund.paymentId },
      data: {
        status: PAYMENT_STATUSES.REFUNDED,
      },
    });

    return finalRefund;
  });

  return updatedRefund;
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
};
