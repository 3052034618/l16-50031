const cron = require('node-cron');
const renewalService = require('./renewalService');
const upgradeDowngradeService = require('./upgradeDowngradeService');

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 2 * * *';

const jobs = {
  renewalReminders: null,
  autoRenewal: null,
  gracePeriodCheck: null,
  scheduledDowngrades: null,
};

let isRunning = false;

const getRenewalReminderDays = () => {
  const daysStr = process.env.RENEWAL_REMINDER_DAYS || '7,3,1';
  return daysStr.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d > 0);
};

const setupRenewalReminders = () => {
  if (jobs.renewalReminders) {
    return;
  }

  const reminderDays = getRenewalReminderDays();
  console.log(`[Cron] 续费提醒天数配置: ${reminderDays.join(', ')} 天`);

  jobs.renewalReminders = cron.schedule(CRON_SCHEDULE, async () => {
    console.log(`[Cron][${new Date().toISOString()}] 开始执行续费提醒任务`);

    try {
      for (const days of reminderDays) {
        try {
          const result = await renewalService.sendRenewalReminders(days);
          console.log(`[Cron] ${days}天续费提醒完成: 成功 ${result.sent} 条, 跳过 ${result.skipped} 条, 失败 ${result.failed} 条, 总计 ${result.total} 条`);
          
          if (result.failed > 0) {
            console.warn(`[Cron] ⚠️  ${days}天续费提醒有 ${result.failed} 条失败:`);
            result.failedEmails.forEach(f => {
              console.warn(`  - ${f.userEmail} (${f.subscriptionId}): ${f.error}`);
            });
          }
        } catch (error) {
          console.error(`[Cron] ${days}天续费提醒执行失败:`, error.message);
        }
      }
      console.log('[Cron] 续费提醒任务执行完成');
    } catch (error) {
      console.error('[Cron] 续费提醒任务执行出错:', error.message);
    }
  }, {
    scheduled: false,
    timezone: process.env.TZ || 'Asia/Shanghai',
  });

  console.log('[Cron] 续费提醒定时任务已设置');
};

const setupAutoRenewal = () => {
  if (jobs.autoRenewal) {
    return;
  }

  jobs.autoRenewal = cron.schedule(CRON_SCHEDULE, async () => {
    console.log(`[Cron][${new Date().toISOString()}] 开始执行自动续费任务`);

    try {
      const result = await renewalService.processAutoRenewal();
      console.log(`[Cron] 自动续费完成: 成功 ${result.renewed} 个, 失败 ${result.failed} 个, 生成账单 ${result.invoicesCreated} 张`);
      console.log(`[Cron] 邮件统计 - 支付成功通知: 成功 ${result.invoicePaidEmailsSent}, 跳过 ${result.invoicePaidEmailsSkipped}, 失败 ${result.invoicePaidEmailsFailed}`);
      console.log(`[Cron] 邮件统计 - 宽限期通知: 成功 ${result.gracePeriodEmailsSent}, 跳过 ${result.gracePeriodEmailsSkipped}, 失败 ${result.gracePeriodEmailsFailed}`);
      
      if (result.invoicePaidEmailsFailed > 0) {
        console.warn(`[Cron] ⚠️  ${result.invoicePaidEmailsFailed} 封支付成功通知发送失败:`);
        result.invoicePaidEmailFailures.forEach(f => {
          console.warn(`  - ${f.userEmail} (订阅${f.subscriptionId}, 账单${f.invoiceId}): ${f.error}`);
        });
      }
      if (result.gracePeriodEmailsFailed > 0) {
        console.warn(`[Cron] ⚠️  ${result.gracePeriodEmailsFailed} 封宽限期通知发送失败:`);
        result.gracePeriodEmailFailures.forEach(f => {
          console.warn(`  - ${f.userEmail} (订阅${f.subscriptionId}): ${f.error}`);
        });
      }
    } catch (error) {
      console.error('[Cron] 自动续费任务执行出错:', error.message);
    }
  }, {
    scheduled: false,
    timezone: process.env.TZ || 'Asia/Shanghai',
  });

  console.log('[Cron] 自动续费定时任务已设置');
};

const setupGracePeriodCheck = () => {
  if (jobs.gracePeriodCheck) {
    return;
  }

  jobs.gracePeriodCheck = cron.schedule(CRON_SCHEDULE, async () => {
    console.log(`[Cron][${new Date().toISOString()}] 开始执行宽限期检查任务`);

    try {
      const result = await renewalService.processExpiredSubscriptions();
      console.log(`[Cron] 宽限期检查完成: 进入宽限期 ${result.pastDue} 个, 暂停 ${result.paused} 个, 取消 ${result.cancelled} 个, 过期 ${result.expired} 个`);
      console.log(`[Cron] 通知发送 - 宽限期通知: 成功 ${result.graceNotificationsSent}, 跳过 ${result.graceNotificationsSkipped}, 失败 ${result.graceNotificationsFailed}`);
      console.log(`[Cron] 通知发送 - 暂停通知: 成功 ${result.pauseNotificationsSent}, 跳过 ${result.pauseNotificationsSkipped}, 失败 ${result.pauseNotificationsFailed}`);
      
      if (result.graceNotificationsFailed > 0) {
        console.warn(`[Cron] ⚠️  ${result.graceNotificationsFailed} 封宽限期通知发送失败:`);
        result.graceFailedEmails.forEach(f => {
          console.warn(`  - ${f.userEmail} (订阅${f.subscriptionId}): ${f.error}`);
        });
      }
      if (result.pauseNotificationsFailed > 0) {
        console.warn(`[Cron] ⚠️  ${result.pauseNotificationsFailed} 封暂停通知发送失败:`);
        result.pauseFailedEmails.forEach(f => {
          console.warn(`  - ${f.userEmail} (订阅${f.subscriptionId}): ${f.error}`);
        });
      }
    } catch (error) {
      console.error('[Cron] 宽限期检查任务执行出错:', error.message);
    }
  }, {
    scheduled: false,
    timezone: process.env.TZ || 'Asia/Shanghai',
  });

  console.log('[Cron] 宽限期检查定时任务已设置');
};

const setupScheduledDowngrades = () => {
  if (jobs.scheduledDowngrades) {
    return;
  }

  jobs.scheduledDowngrades = cron.schedule(CRON_SCHEDULE, async () => {
    console.log(`[Cron][${new Date().toISOString()}] 开始执行计划降级检查任务`);

    try {
      const result = await upgradeDowngradeService.applyScheduledDowngrades();
      console.log(`[Cron] 计划降级检查完成: 成功应用 ${result.applied} 个, 失败 ${result.failed} 个`);
    } catch (error) {
      console.error('[Cron] 计划降级检查任务执行出错:', error.message);
    }
  }, {
    scheduled: false,
    timezone: process.env.TZ || 'Asia/Shanghai',
  });

  console.log('[Cron] 计划降级检查定时任务已设置');
};

const start = () => {
  if (isRunning) {
    console.log('[Cron] 定时任务已经在运行中');
    return;
  }

  console.log('[Cron] 正在启动所有定时任务...');
  console.log(`[Cron] 执行时间: 每天 ${CRON_SCHEDULE} (cron 表达式)`);

  setupRenewalReminders();
  setupAutoRenewal();
  setupGracePeriodCheck();
  setupScheduledDowngrades();

  if (jobs.renewalReminders) jobs.renewalReminders.start();
  if (jobs.autoRenewal) jobs.autoRenewal.start();
  if (jobs.gracePeriodCheck) jobs.gracePeriodCheck.start();
  if (jobs.scheduledDowngrades) jobs.scheduledDowngrades.start();

  isRunning = true;
  console.log('[Cron] 所有定时任务已启动');
};

const stop = () => {
  if (!isRunning) {
    console.log('[Cron] 定时任务未在运行');
    return;
  }

  console.log('[Cron] 正在停止所有定时任务...');

  if (jobs.renewalReminders) {
    jobs.renewalReminders.stop();
    jobs.renewalReminders = null;
  }
  if (jobs.autoRenewal) {
    jobs.autoRenewal.stop();
    jobs.autoRenewal = null;
  }
  if (jobs.gracePeriodCheck) {
    jobs.gracePeriodCheck.stop();
    jobs.gracePeriodCheck = null;
  }
  if (jobs.scheduledDowngrades) {
    jobs.scheduledDowngrades.stop();
    jobs.scheduledDowngrades = null;
  }

  isRunning = false;
  console.log('[Cron] 所有定时任务已停止');
};

module.exports = {
  start,
  stop,
  setupRenewalReminders,
  setupAutoRenewal,
  setupGracePeriodCheck,
  setupScheduledDowngrades,
  isRunning: () => isRunning,
};
