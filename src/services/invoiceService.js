const prisma = require('../config/prisma');
const { generateInvoicePdf: generatePdf } = require('./pdfService');

const INVOICE_STATUSES = {
  DRAFT: 'draft',
  PENDING: 'pending',
  PAID: 'paid',
  VOID: 'void',
  UNCOLLECTIBLE: 'uncollectible',
};

const BILLING_REASONS = {
  SUBSCRIPTION_CREATE: 'subscription_create',
  SUBSCRIPTION_CYCLE: 'subscription_cycle',
  SUBSCRIPTION_UPDATE: 'subscription_update',
  MANUAL: 'manual',
};

const generateInvoiceNumber = async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;

  const todayInvoices = await prisma.invoice.findMany({
    where: {
      invoiceNumber: {
        startsWith: `INV-${datePrefix}-`,
      },
    },
    orderBy: {
      invoiceNumber: 'desc',
    },
    take: 1,
  });

  let sequence = 1;
  if (todayInvoices.length > 0) {
    const lastNumber = todayInvoices[0].invoiceNumber;
    const parts = lastNumber.split('-');
    if (parts.length === 3) {
      sequence = parseInt(parts[2], 10) + 1;
    }
  }

  const sequenceStr = String(sequence).padStart(4, '0');
  return `INV-${datePrefix}-${sequenceStr}`;
};

const generateInvoice = async (userId, subscriptionId, amount, billingReason, options = {}) => {
  const {
    items = [],
    subtotal = amount,
    tax = 0,
    discount = 0,
    couponId = null,
    dueDate = null,
    status = INVOICE_STATUSES.PENDING,
    description = null,
    periodStart = null,
    periodEnd = null,
    autoGeneratePdf = false,
    paid = false,
  } = options;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const error = new Error('用户不存在');
    error.status = 404;
    throw error;
  }

  const invoiceNumber = await generateInvoiceNumber();

  const invoiceData = {
    userId,
    subscriptionId,
    invoiceNumber,
    amount: parseFloat(amount),
    subtotal: parseFloat(subtotal),
    tax: parseFloat(tax),
    discount: parseFloat(discount),
    couponId,
    status: paid ? INVOICE_STATUSES.PAID : status,
    billingReason,
    dueDate: dueDate ? new Date(dueDate) : null,
    paidAt: paid ? new Date() : null,
  };

  let invoiceItems = [];
  if (items.length > 0) {
    invoiceItems = items.map((item) => ({
      description: item.description,
      quantity: item.quantity || 1,
      unitAmount: parseFloat(item.unitAmount),
      amount: parseFloat(item.amount),
      periodStart: item.periodStart ? new Date(item.periodStart) : null,
      periodEnd: item.periodEnd ? new Date(item.periodEnd) : null,
    }));
  } else {
    invoiceItems.push({
      description: description || billingReason,
      quantity: 1,
      unitAmount: parseFloat(subtotal),
      amount: parseFloat(subtotal),
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
    });
  }

  let invoice = await prisma.invoice.create({
    data: {
      ...invoiceData,
      items: {
        create: invoiceItems,
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
      subscription: {
        include: {
          plan: true,
        },
      },
    },
  });

  if (autoGeneratePdf) {
    try {
      const { generateInvoicePdf: generatePdf } = require('./pdfService');
      const invoicesDir = require('path').join(process.cwd(), 'invoices');
      if (!require('fs').existsSync(invoicesDir)) {
        require('fs').mkdirSync(invoicesDir, { recursive: true });
      }
      const pdfPath = await generatePdf(invoice, invoice.items, invoice.user);
      invoice = await prisma.invoice.update({
        where: { id: invoice.id },
        data: { pdfUrl: pdfPath },
        include: {
          items: true,
          user: { select: { id: true, email: true, name: true } },
          subscription: { include: { plan: true } },
        },
      });
    } catch (pdfError) {
      console.error(`[InvoiceService] 自动生成PDF失败 ${invoice.invoiceNumber}:`, pdfError.message);
    }
  }

  return invoice;
};

const generateSubscriptionInvoice = async (subscription, billingReason = BILLING_REASONS.SUBSCRIPTION_CYCLE, options = {}) => {
  const { autoGeneratePdf = false, paid = false } = options;

  if (!subscription) {
    const error = new Error('订阅不存在');
    error.status = 404;
    throw error;
  }

  const user = await prisma.user.findUnique({ where: { id: subscription.userId } });
  if (!user) {
    const error = new Error('用户不存在');
    error.status = 404;
    throw error;
  }

  const plan = subscription.plan || await prisma.plan.findUnique({ where: { id: subscription.planId } });
  if (!plan) {
    const error = new Error('订阅计划不存在');
    error.status = 404;
    throw error;
  }

  const amount = parseFloat(subscription.currentPrice);
  const subtotal = amount;
  const tax = 0;
  const discount = 0;

  let description = '';
  if (billingReason === BILLING_REASONS.SUBSCRIPTION_CREATE) {
    description = `${plan.name} - New Subscription`;
  } else if (billingReason === BILLING_REASONS.SUBSCRIPTION_CYCLE) {
    description = `${plan.name} - Renewal`;
  } else if (billingReason === BILLING_REASONS.SUBSCRIPTION_UPDATE) {
    description = `${plan.name} - Plan Update`;
  } else {
    description = plan.name;
  }

  const invoice = await generateInvoice(
    subscription.userId,
    subscription.id,
    amount,
    billingReason,
    {
      subtotal,
      tax,
      discount,
      couponId: subscription.couponId || null,
      description,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      status: paid ? INVOICE_STATUSES.PAID : INVOICE_STATUSES.PENDING,
      paid,
      autoGeneratePdf,
    }
  );

  return invoice;
};

const getInvoiceById = async (id, userId = null) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: true,
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

  if (!invoice) {
    const error = new Error('账单不存在');
    error.status = 404;
    throw error;
  }

  if (userId && invoice.userId !== userId) {
    const error = new Error('无权访问此账单');
    error.status = 403;
    throw error;
  }

  return invoice;
};

const getUserInvoices = async (userId, options = {}) => {
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

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        items: true,
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
    prisma.invoice.count({ where }),
  ]);

  return {
    data: invoices,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const markInvoicePaid = async (invoiceId, paymentId = null) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    const error = new Error('账单不存在');
    error.status = 404;
    throw error;
  }

  if (invoice.status === INVOICE_STATUSES.PAID) {
    return invoice;
  }

  if (invoice.status === INVOICE_STATUSES.VOID) {
    const error = new Error('已作废的账单无法标记为已支付');
    error.status = 400;
    throw error;
  }

  const updatedInvoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: INVOICE_STATUSES.PAID,
      paidAt: new Date(),
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

  return updatedInvoice;
};

const voidInvoice = async (invoiceId) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    const error = new Error('账单不存在');
    error.status = 404;
    throw error;
  }

  if (invoice.status === INVOICE_STATUSES.VOID) {
    return invoice;
  }

  if (invoice.status === INVOICE_STATUSES.PAID) {
    const error = new Error('已支付的账单无法作废');
    error.status = 400;
    throw error;
  }

  const updatedInvoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: INVOICE_STATUSES.VOID,
    },
    include: {
      items: true,
    },
  });

  return updatedInvoice;
};

const generateInvoicePdf = async (invoiceId) => {
  const invoice = await getInvoiceById(invoiceId);
  const user = invoice.user;
  const items = invoice.items;

  const filePath = await generatePdf(invoice, items, user);

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      pdfUrl: filePath,
    },
  });

  return filePath;
};

module.exports = {
  generateInvoice,
  generateSubscriptionInvoice,
  getInvoiceById,
  getUserInvoices,
  markInvoicePaid,
  voidInvoice,
  generateInvoicePdf,
  INVOICE_STATUSES,
  BILLING_REASONS,
  generateInvoiceNumber,
};
