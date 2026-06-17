
/**
 * 邮件模板模块
 * 提供各类通知邮件的 HTML 和纯文本模板
 */

/**
 * 格式化日期为易读格式
 * @param {Date|string} date - 日期对象或日期字符串
 * @returns {string} 格式化后的日期字符串
 */
const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * 格式化金额为货币格式
 * @param {number|string} amount - 金额
 * @param {string} currency - 货币符号，默认为 $
 * @returns {string} 格式化后的金额字符串
 */
const formatAmount = (amount, currency = '$') => {
  const num = parseFloat(amount);
  return `${currency}${num.toFixed(2)}`;
};

/**
 * 生成基础 HTML 邮件包装
 * @param {string} content - 邮件主体内容 HTML
 * @returns {string} 完整的 HTML 邮件
 */
const baseHtmlTemplate = (content) => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>邮件通知</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f7fa;
    }
    .email-wrapper {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .email-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 8px 8px 0 0;
      text-align: center;
    }
    .email-header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .email-body {
      background-color: #ffffff;
      padding: 30px;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
    }
    .email-body p {
      margin: 0 0 16px 0;
      font-size: 14px;
      color: #555;
    }
    .highlight {
      background-color: #f0f4ff;
      border-left: 4px solid #667eea;
      padding: 16px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .highlight p {
      margin: 0;
    }
    .amount {
      font-size: 28px;
      font-weight: 700;
      color: #667eea;
      margin: 10px 0;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 20px 0;
    }
    .info-item {
      background-color: #f9fafb;
      padding: 12px;
      border-radius: 6px;
    }
    .info-label {
      font-size: 12px;
      color: #999;
      margin-bottom: 4px;
    }
    .info-value {
      font-size: 14px;
      font-weight: 600;
      color: #333;
    }
    .btn {
      display: inline-block;
      padding: 12px 32px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      text-align: center;
      margin: 20px 0;
    }
    .btn:hover {
      opacity: 0.9;
    }
    .email-footer {
      text-align: center;
      padding: 20px;
      color: #999;
      font-size: 12px;
    }
    .email-footer p {
      margin: 4px 0;
    }
    .warning {
      background-color: #fff7ed;
      border-left: 4px solid #f59e0b;
      padding: 16px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .warning p {
      margin: 0;
      color: #92400e;
    }
    .danger {
      background-color: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 16px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .danger p {
      margin: 0;
      color: #991b1b;
    }
    .success {
      background-color: #f0fdf4;
      border-left: 4px solid #22c55e;
      padding: 16px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .success p {
      margin: 0;
      color: #166534;
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    ${content}
    <div class="email-footer">
      <p>此邮件由系统自动发送，请勿直接回复。</p>
      <p>如有疑问，请联系客服支持。</p>
    </div>
  </div>
</body>
</html>
`;

/**
 * 续费提醒邮件模板
 * @param {number} daysLeft - 距离续费还有多少天
 * @param {string} planName - 订阅计划名称
 * @param {number|string} amount - 续费金额
 * @param {Date|string} renewalDate - 续费日期
 * @returns {Object} 包含 html 和 text 属性的对象
 */
const renewalReminderTemplate = (daysLeft, planName, amount, renewalDate) => {
  const formattedAmount = formatAmount(amount);
  const formattedDate = formatDate(renewalDate);

  let urgencyLevel = 'info';
  let headerText = '订阅即将到期';
  let reminderText = '';

  if (daysLeft === 7) {
    urgencyLevel = 'info';
    headerText = '一周后续费提醒';
    reminderText = '您的订阅还有一周即将到期，为避免服务中断，请确保支付方式有效。';
  } else if (daysLeft === 3) {
    urgencyLevel = 'warning';
    headerText = '三天后续费提醒';
    reminderText = '您的订阅还有三天即将到期，请及时处理续费事宜，避免服务受到影响。';
  } else if (daysLeft === 1) {
    urgencyLevel = 'danger';
    headerText = '明天即将续费';
    reminderText = '您的订阅明天就要到期了！请立即检查支付方式，确保订阅顺利续期。';
  } else {
    headerText = `订阅将在 ${daysLeft} 天后到期`;
    reminderText = `您的订阅还有 ${daysLeft} 天即将到期，请留意续费时间。`;
  }

  const htmlContent = `
    <div class="email-header">
      <h1>${headerText}</h1>
    </div>
    <div class="email-body">
      <p>您好，</p>
      <p>${reminderText}</p>
      
      <div class="${urgencyLevel}">
        <p><strong>重要提示：</strong>请确保您的支付方式有效，以避免订阅中断。</p>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">订阅计划</div>
          <div class="info-value">${planName}</div>
        </div>
        <div class="info-item">
          <div class="info-label">续费金额</div>
          <div class="info-value">${formattedAmount}</div>
        </div>
        <div class="info-item">
          <div class="info-label">续费日期</div>
          <div class="info-value">${formattedDate}</div>
        </div>
        <div class="info-item">
          <div class="info-label">剩余天数</div>
          <div class="info-value">${daysLeft} 天</div>
        </div>
      </div>

      <a href="${process.env.APP_URL || '#'}/dashboard/subscription" class="btn">管理我的订阅</a>

      <p>如果您不想继续订阅，可以在订阅设置中取消自动续费。</p>
    </div>
  `;

  const textContent = `
${headerText}

您好，

${reminderText}

【订阅详情】
- 订阅计划：${planName}
- 续费金额：${formattedAmount}
- 续费日期：${formattedDate}
- 剩余天数：${daysLeft} 天

请确保您的支付方式有效，以避免订阅中断。

管理我的订阅：${process.env.APP_URL || '#'}/dashboard/subscription

如果您不想继续订阅，可以在订阅设置中取消自动续费。

此邮件由系统自动发送，请勿直接回复。
  `.trim();

  return {
    html: baseHtmlTemplate(htmlContent),
    text: textContent,
  };
};

/**
 * 宽限期开始通知模板
 * @param {string} planName - 订阅计划名称
 * @param {number} graceDays - 宽限期天数
 * @returns {Object} 包含 html 和 text 属性的对象
 */
const gracePeriodTemplate = (planName, graceDays) => {
  const htmlContent = `
    <div class="email-header">
      <h1>宽限期已开始</h1>
    </div>
    <div class="email-body">
      <p>您好，</p>
      <p>我们注意到您的订阅续费未能成功完成。您的账户现已进入宽限期。</p>
      
      <div class="warning">
        <p><strong>宽限期说明：</strong>在宽限期内，您仍可正常使用服务。请在 ${graceDays} 天内完成支付，以免订阅被暂停。</p>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">订阅计划</div>
          <div class="info-value">${planName}</div>
        </div>
        <div class="info-item">
          <div class="info-label">宽限期天数</div>
          <div class="info-value">${graceDays} 天</div>
        </div>
      </div>

      <a href="${process.env.APP_URL || '#'}/dashboard/billing" class="btn">立即支付</a>

      <p>请尽快完成支付，以确保您的服务不被中断。</p>
    </div>
  `;

  const textContent = `
宽限期已开始

您好，

我们注意到您的订阅续费未能成功完成。您的账户现已进入宽限期。

【宽限期说明】
在宽限期内，您仍可正常使用服务。请在 ${graceDays} 天内完成支付，以免订阅被暂停。

【订阅详情】
- 订阅计划：${planName}
- 宽限期天数：${graceDays} 天

立即支付：${process.env.APP_URL || '#'}/dashboard/billing

请尽快完成支付，以确保您的服务不被中断。

此邮件由系统自动发送，请勿直接回复。
  `.trim();

  return {
    html: baseHtmlTemplate(htmlContent),
    text: textContent,
  };
};

/**
 * 订阅暂停通知模板
 * @param {string} planName - 订阅计划名称
 * @returns {Object} 包含 html 和 text 属性的对象
 */
const subscriptionPausedTemplate = (planName) => {
  const htmlContent = `
    <div class="email-header">
      <h1>订阅已暂停</h1>
    </div>
    <div class="email-body">
      <p>您好，</p>
      <p>由于宽限期已过且续费仍未完成，您的订阅已被暂停。</p>
      
      <div class="danger">
        <p><strong>注意：</strong>订阅暂停后，您将无法使用相关服务。完成支付后，订阅将自动恢复。</p>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">订阅计划</div>
          <div class="info-value">${planName}</div>
        </div>
        <div class="info-item">
          <div class="info-label">当前状态</div>
          <div class="info-value">已暂停</div>
        </div>
      </div>

      <a href="${process.env.APP_URL || '#'}/dashboard/billing" class="btn">恢复订阅</a>

      <p>如果您有任何疑问或需要帮助，请联系客服支持。</p>
    </div>
  `;

  const textContent = `
订阅已暂停

您好，

由于宽限期已过且续费仍未完成，您的订阅已被暂停。

【注意】
订阅暂停后，您将无法使用相关服务。完成支付后，订阅将自动恢复。

【订阅详情】
- 订阅计划：${planName}
- 当前状态：已暂停

恢复订阅：${process.env.APP_URL || '#'}/dashboard/billing

如果您有任何疑问或需要帮助，请联系客服支持。

此邮件由系统自动发送，请勿直接回复。
  `.trim();

  return {
    html: baseHtmlTemplate(htmlContent),
    text: textContent,
  };
};

/**
 * 订阅过期通知模板
 * @param {string} planName - 订阅计划名称
 * @returns {Object} 包含 html 和 text 属性的对象
 */
const subscriptionExpiredTemplate = (planName) => {
  const htmlContent = `
    <div class="email-header">
      <h1>订阅已过期</h1>
    </div>
    <div class="email-body">
      <p>您好，</p>
      <p>很遗憾地通知您，您的订阅已过期。</p>
      
      <div class="danger">
        <p><strong>重要提示：</strong>订阅过期后，您的账户将降级为免费版，部分功能将受到限制。</p>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">过期订阅</div>
          <div class="info-value">${planName}</div>
        </div>
        <div class="info-item">
          <div class="info-label">当前状态</div>
          <div class="info-value">已过期</div>
        </div>
      </div>

      <a href="${process.env.APP_URL || '#'}/dashboard/plans" class="btn">重新订阅</a>

      <p>如果您想继续使用我们的服务，可以随时重新订阅。</p>
      <p>感谢您一直以来的支持，期待您的回归。</p>
    </div>
  `;

  const textContent = `
订阅已过期

您好，

很遗憾地通知您，您的订阅已过期。

【重要提示】
订阅过期后，您的账户将降级为免费版，部分功能将受到限制。

【订阅详情】
- 过期订阅：${planName}
- 当前状态：已过期

重新订阅：${process.env.APP_URL || '#'}/dashboard/plans

如果您想继续使用我们的服务，可以随时重新订阅。

感谢您一直以来的支持，期待您的回归。

此邮件由系统自动发送，请勿直接回复。
  `.trim();

  return {
    html: baseHtmlTemplate(htmlContent),
    text: textContent,
  };
};

/**
 * 账单支付成功通知模板
 * @param {string} invoiceNumber - 账单编号
 * @param {number|string} amount - 支付金额
 * @param {string} planName - 订阅计划名称
 * @returns {Object} 包含 html 和 text 属性的对象
 */
const invoicePaidTemplate = (invoiceNumber, amount, planName) => {
  const formattedAmount = formatAmount(amount);

  const htmlContent = `
    <div class="email-header">
      <h1>支付成功</h1>
    </div>
    <div class="email-body">
      <p>您好，</p>
      <p>感谢您的支付！您的账单已成功支付。</p>
      
      <div class="success">
        <p><strong>支付已确认：</strong>您的订阅已成功续期，服务将继续正常提供。</p>
      </div>

      <div class="amount">${formattedAmount}</div>

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">账单编号</div>
          <div class="info-value">${invoiceNumber}</div>
        </div>
        <div class="info-item">
          <div class="info-label">订阅计划</div>
          <div class="info-value">${planName}</div>
        </div>
        <div class="info-item">
          <div class="info-label">支付金额</div>
          <div class="info-value">${formattedAmount}</div>
        </div>
        <div class="info-item">
          <div class="info-label">支付状态</div>
          <div class="info-value">已支付</div>
        </div>
      </div>

      <a href="${process.env.APP_URL || '#'}/dashboard/invoices" class="btn">查看账单详情</a>

      <p>感谢您对我们服务的信任与支持！</p>
    </div>
  `;

  const textContent = `
支付成功

您好，

感谢您的支付！您的账单已成功支付。

【支付已确认】
您的订阅已成功续期，服务将继续正常提供。

【账单详情】
- 账单编号：${invoiceNumber}
- 订阅计划：${planName}
- 支付金额：${formattedAmount}
- 支付状态：已支付

查看账单详情：${process.env.APP_URL || '#'}/dashboard/invoices

感谢您对我们服务的信任与支持！

此邮件由系统自动发送，请勿直接回复。
  `.trim();

  return {
    html: baseHtmlTemplate(htmlContent),
    text: textContent,
  };
};

/**
 * 退款处理完成通知模板
 * @param {string} refundId - 退款申请编号
 * @param {number|string} amount - 退款金额
 * @param {string} reason - 退款原因
 * @returns {Object} 包含 html 和 text 属性的对象
 */
const refundProcessedTemplate = (refundId, amount, reason) => {
  const formattedAmount = formatAmount(amount);

  const htmlContent = `
    <div class="email-header">
      <h1>退款已处理</h1>
    </div>
    <div class="email-body">
      <p>您好，</p>
      <p>您的退款申请已处理完成。</p>
      
      <div class="success">
        <p><strong>退款已发起：</strong>款项将在 3-10 个工作日内原路退回您的支付账户，具体到账时间取决于银行处理速度。</p>
      </div>

      <div class="amount">${formattedAmount}</div>

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">退款编号</div>
          <div class="info-value">${refundId}</div>
        </div>
        <div class="info-item">
          <div class="info-label">退款金额</div>
          <div class="info-value">${formattedAmount}</div>
        </div>
        <div class="info-item">
          <div class="info-label">退款原因</div>
          <div class="info-value">${reason}</div>
        </div>
        <div class="info-item">
          <div class="info-label">处理状态</div>
          <div class="info-value">已处理</div>
        </div>
      </div>

      <a href="${process.env.APP_URL || '#'}/dashboard/refunds" class="btn">查看退款详情</a>

      <p>如果您在退款过程中有任何疑问，请随时联系我们的客服团队。</p>
    </div>
  `;

  const textContent = `
退款已处理

您好，

您的退款申请已处理完成。

【退款说明】
款项将在 3-10 个工作日内原路退回您的支付账户，具体到账时间取决于银行处理速度。

【退款详情】
- 退款编号：${refundId}
- 退款金额：${formattedAmount}
- 退款原因：${reason}
- 处理状态：已处理

查看退款详情：${process.env.APP_URL || '#'}/dashboard/refunds

如果您在退款过程中有任何疑问，请随时联系我们的客服团队。

此邮件由系统自动发送，请勿直接回复。
  `.trim();

  return {
    html: baseHtmlTemplate(htmlContent),
    text: textContent,
  };
};

module.exports = {
  renewalReminderTemplate,
  gracePeriodTemplate,
  subscriptionPausedTemplate,
  subscriptionExpiredTemplate,
  invoicePaidTemplate,
  refundProcessedTemplate,
  formatDate,
  formatAmount,
};
