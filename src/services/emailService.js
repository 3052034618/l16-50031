
/**
 * 邮件服务模块
 * 提供各类邮件通知的发送功能
 * 使用 nodemailer 发送邮件
 * 使用 Prisma 记录邮件发送日志
 */

const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');
const {
  renewalReminderTemplate,
  gracePeriodTemplate,
  subscriptionPausedTemplate,
  subscriptionExpiredTemplate,
  invoicePaidTemplate,
  refundProcessedTemplate,
} = require('../templates/emailTemplates');

/**
 * 邮件通知类型枚举
 * 用于标识不同类型的通知邮件
 */
const EMAIL_TYPES = {
  RENEWAL_REMINDER_7D: 'renewal_reminder_7d',
  RENEWAL_REMINDER_3D: 'renewal_reminder_3d',
  RENEWAL_REMINDER_1D: 'renewal_reminder_1d',
  GRACE_PERIOD_START: 'grace_period_start',
  SUBSCRIPTION_PAUSED: 'subscription_paused',
  SUBSCRIPTION_EXPIRED: 'subscription_expired',
  INVOICE_PAID: 'invoice_paid',
  REFUND_PROCESSED: 'refund_processed',
};

/**
 * 创建 SMTP 传输器
 * 懒加载模式，首次使用时创建
 */
let transporter = null;

/**
 * 获取或创建 SMTP 传输器
 * @returns {Object} nodemailer 传输器实例
 */
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: parseInt(process.env.SMTP_PORT, 10) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

/**
 * 获取当天的开始和结束时间
 * 用于判断当天是否已发送过某类通知
 * @returns {Object} 包含 startOfDay 和 endOfDay 的对象
 */
const getDayRange = () => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { startOfDay, endOfDay };
};

/**
 * 检查当天是否已发送过该类型通知
 * @param {string} userId - 用户ID
 * @param {string} type - 通知类型
 * @param {Date} [date] - 检查的日期，默认为今天
 * @returns {Promise<boolean>} 是否已发送过
 */
const hasSentNotification = async (userId, type, date = null) => {
  try {
    let startOfDay, endOfDay;

    if (date) {
      const d = new Date(date);
      startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    } else {
      const range = getDayRange();
      startOfDay = range.startOfDay;
      endOfDay = range.endOfDay;
    }

    const notification = await prisma.emailNotification.findFirst({
      where: {
        userId,
        type,
        status: 'sent',
        sentAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
    });

    return !!notification;
  } catch (error) {
    console.error('[EmailService] 检查通知发送状态失败:', error.message);
    return false;
  }
};

/**
 * 记录邮件发送日志
 * @param {string} userId - 用户ID
 * @param {string} type - 通知类型
 * @param {string} subject - 邮件主题
 * @param {string} status - 发送状态 (sent/failed)
 * @param {string} [failureReason] - 失败原因
 * @returns {Promise<Object>} 创建的通知记录
 */
const logEmailNotification = async (userId, type, subject, status, failureReason = null) => {
  try {
    return await prisma.emailNotification.create({
      data: {
        userId,
        type,
        subject,
        status,
        failureReason,
      },
    });
  } catch (error) {
    console.error('[EmailService] 记录邮件日志失败:', error.message);
    return null;
  }
};

/**
 * 通用邮件发送函数
 * @param {string} to - 收件人邮箱
 * @param {string} subject - 邮件主题
 * @param {string} html - HTML 邮件内容
 * @param {string} text - 纯文本邮件内容
 * @param {Object} [options] - 可选配置
 * @param {string} [options.userId] - 用户ID，用于记录发送日志
 * @param {string} [options.type] - 通知类型，用于记录发送日志
 * @returns {Promise<Object>} 发送结果
 */
const sendEmail = async (to, subject, html, text, options = {}) => {
  const { userId = null, type = null } = options;

  try {
    if (!to || !subject) {
      throw new Error('收件人和主题不能为空');
    }

    const transporter = getTransporter();

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      text,
    };

    const info = await transporter.sendMail(mailOptions);

    if (userId && type) {
      await logEmailNotification(userId, type, subject, 'sent');
    }

    console.log(`[EmailService] 邮件发送成功: ${to} - ${subject}`);

    return {
      success: true,
      messageId: info.messageId,
      info,
    };
  } catch (error) {
    console.error(`[EmailService] 邮件发送失败: ${to} - ${subject}`, error.message);

    if (userId && type) {
      await logEmailNotification(userId, type, subject, 'failed', error.message);
    }

    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * 发送续费提醒邮件
 * 根据到期天数发送不同的提醒内容
 * 支持7天、3天、1天提醒
 * @param {Object} user - 用户对象
 * @param {Object} subscription - 订阅对象
 * @param {number} daysUntilRenewal - 距离续费的天数
 * @returns {Promise<Object>} 发送结果
 */
const sendRenewalReminder = async (user, subscription, daysUntilRenewal) => {
  try {
    if (!user || !user.email) {
      console.warn('[EmailService] 用户邮箱不存在，跳过续费提醒邮件');
      return { success: false, error: '用户邮箱不存在' };
    }

    const plan = subscription.plan || await prisma.plan.findUnique({
      where: { id: subscription.planId },
    });

    if (!plan) {
      console.warn('[EmailService] 订阅计划不存在，跳过续费提醒邮件');
      return { success: false, error: '订阅计划不存在' };
    }

    let emailType;
    let subject;

    if (daysUntilRenewal === 7) {
      emailType = EMAIL_TYPES.RENEWAL_REMINDER_7D;
      subject = '【续费提醒】您的订阅将在一周后续费';
    } else if (daysUntilRenewal === 3) {
      emailType = EMAIL_TYPES.RENEWAL_REMINDER_3D;
      subject = '【续费提醒】您的订阅将在3天后续费';
    } else if (daysUntilRenewal === 1) {
      emailType = EMAIL_TYPES.RENEWAL_REMINDER_1D;
      subject = '【紧急提醒】您的订阅明天即将续费';
    } else {
      emailType = `renewal_reminder_${daysUntilRenewal}d`;
      subject = `【续费提醒】您的订阅将在${daysUntilRenewal}天后续费`;
    }

    const alreadySent = await hasSentNotification(user.id, emailType);
    if (alreadySent) {
      console.log(`[EmailService] 今天已发送过续费提醒 (${daysUntilRenewal}天) 给用户 ${user.id}，跳过重复发送`);
      return { success: true, skipped: true, reason: 'already_sent_today' };
    }

    const { html, text } = renewalReminderTemplate(
      daysUntilRenewal,
      plan.name,
      subscription.currentPrice,
      subscription.currentPeriodEnd
    );

    const result = await sendEmail(user.email, subject, html, text, {
      userId: user.id,
      type: emailType,
    });

    return result;
  } catch (error) {
    console.error('[EmailService] 发送续费提醒邮件异常:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 发送宽限期开始通知
 * @param {Object} user - 用户对象
 * @param {Object} subscription - 订阅对象
 * @returns {Promise<Object>} 发送结果
 */
const sendGracePeriodStart = async (user, subscription) => {
  try {
    if (!user || !user.email) {
      console.warn('[EmailService] 用户邮箱不存在，跳过宽限期开始通知');
      return { success: false, error: '用户邮箱不存在' };
    }

    const plan = subscription.plan || await prisma.plan.findUnique({
      where: { id: subscription.planId },
    });

    if (!plan) {
      console.warn('[EmailService] 订阅计划不存在，跳过宽限期开始通知');
      return { success: false, error: '订阅计划不存在' };
    }

    const alreadySent = await hasSentNotification(user.id, EMAIL_TYPES.GRACE_PERIOD_START);
    if (alreadySent) {
      console.log(`[EmailService] 今天已发送过宽限期开始通知给用户 ${user.id}，跳过重复发送`);
      return { success: true, skipped: true, reason: 'already_sent_today' };
    }

    const graceDays = parseInt(process.env.GRACE_PERIOD_DAYS || '7', 10);

    const subject = '【重要通知】您的账户已进入宽限期';
    const { html, text } = gracePeriodTemplate(plan.name, graceDays);

    const result = await sendEmail(user.email, subject, html, text, {
      userId: user.id,
      type: EMAIL_TYPES.GRACE_PERIOD_START,
    });

    return result;
  } catch (error) {
    console.error('[EmailService] 发送宽限期开始通知异常:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 发送订阅暂停通知
 * @param {Object} user - 用户对象
 * @param {Object} subscription - 订阅对象
 * @returns {Promise<Object>} 发送结果
 */
const sendSubscriptionPaused = async (user, subscription) => {
  try {
    if (!user || !user.email) {
      console.warn('[EmailService] 用户邮箱不存在，跳过订阅暂停通知');
      return { success: false, error: '用户邮箱不存在' };
    }

    const plan = subscription.plan || await prisma.plan.findUnique({
      where: { id: subscription.planId },
    });

    if (!plan) {
      console.warn('[EmailService] 订阅计划不存在，跳过订阅暂停通知');
      return { success: false, error: '订阅计划不存在' };
    }

    const alreadySent = await hasSentNotification(user.id, EMAIL_TYPES.SUBSCRIPTION_PAUSED);
    if (alreadySent) {
      console.log(`[EmailService] 今天已发送过订阅暂停通知给用户 ${user.id}，跳过重复发送`);
      return { success: true, skipped: true, reason: 'already_sent_today' };
    }

    const subject = '【通知】您的订阅已暂停';
    const { html, text } = subscriptionPausedTemplate(plan.name);

    const result = await sendEmail(user.email, subject, html, text, {
      userId: user.id,
      type: EMAIL_TYPES.SUBSCRIPTION_PAUSED,
    });

    return result;
  } catch (error) {
    console.error('[EmailService] 发送订阅暂停通知异常:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 发送订阅过期通知
 * @param {Object} user - 用户对象
 * @param {Object} subscription - 订阅对象
 * @returns {Promise<Object>} 发送结果
 */
const sendSubscriptionExpired = async (user, subscription) => {
  try {
    if (!user || !user.email) {
      console.warn('[EmailService] 用户邮箱不存在，跳过订阅过期通知');
      return { success: false, error: '用户邮箱不存在' };
    }

    const plan = subscription.plan || await prisma.plan.findUnique({
      where: { id: subscription.planId },
    });

    if (!plan) {
      console.warn('[EmailService] 订阅计划不存在，跳过订阅过期通知');
      return { success: false, error: '订阅计划不存在' };
    }

    const alreadySent = await hasSentNotification(user.id, EMAIL_TYPES.SUBSCRIPTION_EXPIRED);
    if (alreadySent) {
      console.log(`[EmailService] 今天已发送过订阅过期通知给用户 ${user.id}，跳过重复发送`);
      return { success: true, skipped: true, reason: 'already_sent_today' };
    }

    const subject = '【通知】您的订阅已过期';
    const { html, text } = subscriptionExpiredTemplate(plan.name);

    const result = await sendEmail(user.email, subject, html, text, {
      userId: user.id,
      type: EMAIL_TYPES.SUBSCRIPTION_EXPIRED,
    });

    return result;
  } catch (error) {
    console.error('[EmailService] 发送订阅过期通知异常:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 发送账单支付成功通知
 * @param {Object} user - 用户对象
 * @param {Object} invoice - 账单对象
 * @returns {Promise<Object>} 发送结果
 */
const sendInvoicePaid = async (user, invoice) => {
  try {
    if (!user || !user.email) {
      console.warn('[EmailService] 用户邮箱不存在，跳过账单支付成功通知');
      return { success: false, error: '用户邮箱不存在' };
    }

    let planName = '订阅服务';
    if (invoice.subscription && invoice.subscription.plan) {
      planName = invoice.subscription.plan.name;
    } else if (invoice.subscriptionId) {
      const subscription = await prisma.subscription.findUnique({
        where: { id: invoice.subscriptionId },
        include: { plan: true },
      });
      if (subscription && subscription.plan) {
        planName = subscription.plan.name;
      }
    }

    const subject = '【支付成功】感谢您的支付';
    const { html, text } = invoicePaidTemplate(
      invoice.invoiceNumber,
      invoice.amount,
      planName
    );

    const result = await sendEmail(user.email, subject, html, text, {
      userId: user.id,
      type: EMAIL_TYPES.INVOICE_PAID,
    });

    return result;
  } catch (error) {
    console.error('[EmailService] 发送账单支付成功通知异常:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 发送退款处理完成通知
 * @param {Object} user - 用户对象
 * @param {Object} refund - 退款对象
 * @returns {Promise<Object>} 发送结果
 */
const sendRefundProcessed = async (user, refund) => {
  try {
    if (!user || !user.email) {
      console.warn('[EmailService] 用户邮箱不存在，跳过退款处理完成通知');
      return { success: false, error: '用户邮箱不存在' };
    }

    const alreadySent = await hasSentNotification(user.id, EMAIL_TYPES.REFUND_PROCESSED);
    if (alreadySent) {
      console.log(`[EmailService] 今天已发送过退款通知给用户 ${user.id}，跳过重复发送`);
      return { success: true, skipped: true, reason: 'already_sent_today' };
    }

    const subject = '【退款通知】您的退款已处理完成';
    const { html, text } = refundProcessedTemplate(
      refund.id,
      refund.amount,
      refund.reason
    );

    const result = await sendEmail(user.email, subject, html, text, {
      userId: user.id,
      type: EMAIL_TYPES.REFUND_PROCESSED,
    });

    return result;
  } catch (error) {
    console.error('[EmailService] 发送退款处理完成通知异常:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendEmail,
  sendRenewalReminder,
  sendGracePeriodStart,
  sendSubscriptionPaused,
  sendSubscriptionExpired,
  sendInvoicePaid,
  sendRefundProcessed,
  hasSentNotification,
  EMAIL_TYPES,
  logEmailNotification,
};
