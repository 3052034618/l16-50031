const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('开始播种数据...');

  const adminPassword = await bcrypt.hash('admin123', 10);
  const userPassword = await bcrypt.hash('user123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: '系统管理员',
      passwordHash: adminPassword,
      role: 'admin',
      isActive: true,
    },
  });
  console.log('管理员用户创建/更新:', admin.email);

  const user1 = await prisma.user.upsert({
    where: { email: 'user1@example.com' },
    update: {},
    create: {
      email: 'user1@example.com',
      name: '测试用户1',
      passwordHash: userPassword,
      role: 'user',
      isActive: true,
    },
  });
  console.log('测试用户1创建/更新:', user1.email);

  const user2 = await prisma.user.upsert({
    where: { email: 'user2@example.com' },
    update: {},
    create: {
      email: 'user2@example.com',
      name: '测试用户2',
      passwordHash: userPassword,
      role: 'user',
      isActive: true,
    },
  });
  console.log('测试用户2创建/更新:', user2.email);

  const plans = [
    {
      name: '基础版',
      description: '适合个人用户的基础功能',
      priceMonthly: 29.00,
      priceYearly: 290.00,
      billingCycle: 'monthly',
      features: {
        projects: 5,
        storage: '10GB',
        support: 'email',
        features: ['基础分析', 'API访问', '社区支持']
      },
      status: 'active',
      sortOrder: 1,
    },
    {
      name: '专业版',
      description: '适合专业人士的高级功能',
      priceMonthly: 99.00,
      priceYearly: 990.00,
      billingCycle: 'monthly',
      features: {
        projects: -1,
        storage: '100GB',
        support: 'priority',
        features: ['高级分析', '优先支持', '团队协作', '自定义报表', 'API访问']
      },
      status: 'active',
      sortOrder: 2,
    },
    {
      name: '企业版',
      description: '适合企业的全方位解决方案',
      priceMonthly: 299.00,
      priceYearly: 2990.00,
      billingCycle: 'monthly',
      features: {
        projects: -1,
        storage: '1TB',
        support: 'dedicated',
        features: ['企业级分析', '专属客户经理', 'SLA保障', '自定义集成', '高级安全', 'SSO单点登录']
      },
      status: 'active',
      sortOrder: 3,
    },
  ];

  for (const planData of plans) {
    const plan = await prisma.plan.upsert({
      where: { name: planData.name },
      update: planData,
      create: planData,
    });
    console.log('订阅计划创建/更新:', plan.name, '月付$', plan.priceMonthly, '年付$', plan.priceYearly);
  }

  const basicPlan = await prisma.plan.findUnique({ where: { name: '基础版' } });
  const proPlan = await prisma.plan.findUnique({ where: { name: '专业版' } });

  const coupons = [
    {
      code: 'WELCOME10',
      type: 'percentage',
      value: 10,
      maxUses: 100,
      validFrom: new Date('2024-01-01'),
      validTo: new Date('2026-12-31'),
      isActive: true,
      description: '新用户首单9折优惠',
      appliesTo: 'all',
    },
    {
      code: 'SAVE50',
      type: 'fixed',
      value: 50,
      currency: 'usd',
      maxUses: 200,
      validFrom: new Date('2024-01-01'),
      validTo: new Date('2026-12-31'),
      isActive: true,
      description: '立减50美元优惠码',
      appliesTo: 'all',
    },
    {
      code: 'PRO20',
      type: 'percentage',
      value: 20,
      maxUses: 50,
      validFrom: new Date('2024-01-01'),
      validTo: new Date('2026-12-31'),
      isActive: true,
      description: '专业版专属8折优惠',
      appliesTo: 'specific_plans',
      planIds: proPlan ? [proPlan.id] : [],
    },
  ];

  for (const couponData of coupons) {
    const { planIds, ...couponInfo } = couponData;
    const existingCoupon = await prisma.coupon.findUnique({ where: { code: couponData.code } });
    
    if (!existingCoupon) {
      const coupon = await prisma.coupon.create({
        data: {
          ...couponInfo,
          plans: planIds && planIds.length > 0
            ? {
                create: planIds.map(planId => ({
                  plan: { connect: { id: planId } }
                }))
              }
            : undefined,
        },
      });
      console.log('优惠码创建:', coupon.code, coupon.type, coupon.value);
    } else {
      console.log('优惠码已存在:', couponData.code);
    }
  }

  await prisma.systemConfig.upsert({
    where: { key: 'grace_period_days' },
    update: { value: '7', description: '宽限期天数' },
    create: { key: 'grace_period_days', value: '7', description: '宽限期天数' },
  });

  await prisma.systemConfig.upsert({
    where: { key: 'renewal_reminder_days' },
    update: { value: '7,3,1', description: '续费提醒天数（逗号分隔）' },
    create: { key: 'renewal_reminder_days', value: '7,3,1', description: '续费提醒天数（逗号分隔）' },
  });

  console.log('系统配置创建完成');
  console.log('播种数据完成！');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
