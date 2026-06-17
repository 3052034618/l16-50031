const prisma = require('../config/prisma');

// 优惠码类型常量
const COUPON_TYPES = {
  PERCENTAGE: 'percentage', // 百分比折扣
  FIXED: 'fixed',           // 固定金额减免
};

// 优惠码适用范围常量
const APPLIES_TO = {
  ALL: 'all',                 // 所有计划
  SPECIFIC_PLANS: 'specific_plans', // 指定计划
};

/**
 * 创建优惠码（管理员）
 * @param {Object} couponData - 优惠码数据
 * @param {string} couponData.code - 优惠码编码
 * @param {string} couponData.type - 优惠码类型 (percentage/fixed)
 * @param {number} couponData.value - 折扣值（百分比或固定金额）
 * @param {string} [couponData.currency] - 货币（fixed类型必需）
 * @param {number} [couponData.maxUses] - 最大使用次数
 * @param {Date} couponData.validFrom - 生效时间
 * @param {Date} [couponData.validTo] - 过期时间
 * @param {string} couponData.appliesTo - 适用范围 (all/specific_plans)
 * @param {string[]} [couponData.planIds] - 适用计划ID列表
 * @param {string} [couponData.description] - 描述
 * @returns {Object} 创建的优惠码
 */
const createCoupon = async (couponData) => {
  const {
    code,
    type,
    value,
    currency,
    maxUses,
    validFrom,
    validTo,
    appliesTo,
    planIds,
    description,
  } = couponData;

  // 检查优惠码是否已存在
  const existingCoupon = await prisma.coupon.findUnique({
    where: { code },
  });

  if (existingCoupon) {
    const error = new Error('优惠码已存在');
    error.status = 400;
    throw error;
  }

  // fixed类型必须指定货币
  if (type === COUPON_TYPES.FIXED && !currency) {
    const error = new Error('固定金额类型的优惠码必须指定货币');
    error.status = 400;
    throw error;
  }

  // 指定计划范围必须提供计划ID列表
  if (appliesTo === APPLIES_TO.SPECIFIC_PLANS && (!planIds || planIds.length === 0)) {
    const error = new Error('指定计划范围的优惠码必须提供计划ID列表');
    error.status = 400;
    throw error;
  }

  // 创建优惠码，如果是指定计划范围，同时创建关联关系
  const coupon = await prisma.coupon.create({
    data: {
      code,
      type,
      value,
      currency,
      maxUses,
      validFrom: new Date(validFrom),
      validTo: validTo ? new Date(validTo) : null,
      appliesTo,
      description,
      plans: appliesTo === APPLIES_TO.SPECIFIC_PLANS
        ? {
            create: planIds.map((planId) => ({
              plan: { connect: { id: planId } },
            })),
          }
        : undefined,
    },
    include: {
      plans: true,
    },
  });

  return coupon;
};

/**
 * 根据优惠码编码获取优惠码
 * @param {string} code - 优惠码编码
 * @returns {Object|null} 优惠码对象或null
 */
const getCouponByCode = async (code) => {
  const coupon = await prisma.coupon.findUnique({
    where: { code },
    include: {
      plans: true,
    },
  });

  return coupon;
};

/**
 * 根据ID获取优惠码
 * @param {string} id - 优惠码ID
 * @returns {Object} 优惠码对象
 * @throws {Error} 优惠码不存在时抛出错误
 */
const getCouponById = async (id) => {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: {
      plans: true,
      _count: {
        select: { usages: true },
      },
    },
  });

  if (!coupon) {
    const error = new Error('优惠码不存在');
    error.status = 404;
    throw error;
  }

  return coupon;
};

/**
 * 验证优惠码是否可用
 * 检查项：
 * 1. 优惠码是否存在
 * 2. 优惠码是否激活
 * 3. 有效期检查（生效时间和过期时间）
 * 4. 使用次数是否达上限
 * 5. 是否适用于指定计划
 * 6. 用户是否已使用过（同一用户不能重复使用同一优惠码）
 * @param {string} code - 优惠码编码
 * @param {string} planId - 订阅计划ID
 * @param {string} [userId] - 用户ID（可选，用于检查用户是否已使用）
 * @returns {Object} 优惠码对象
 * @throws {Error} 验证失败时抛出错误
 */
const validateCoupon = async (code, planId, userId) => {
  // 1. 检查优惠码是否存在
  const coupon = await getCouponByCode(code);

  if (!coupon) {
    const error = new Error('优惠码不存在');
    error.status = 400;
    throw error;
  }

  // 2. 检查优惠码是否激活
  if (!coupon.isActive) {
    const error = new Error('优惠码已停用');
    error.status = 400;
    throw error;
  }

  const now = new Date();

  // 3. 检查生效时间
  if (coupon.validFrom > now) {
    const error = new Error('优惠码尚未生效');
    error.status = 400;
    throw error;
  }

  // 4. 检查过期时间
  if (coupon.validTo && coupon.validTo < now) {
    const error = new Error('优惠码已过期');
    error.status = 400;
    throw error;
  }

  // 5. 检查使用次数是否达上限
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    const error = new Error('优惠码使用次数已达上限');
    error.status = 400;
    throw error;
  }

  // 6. 检查是否适用于指定计划
  if (coupon.appliesTo === APPLIES_TO.SPECIFIC_PLANS) {
    const planMatch = coupon.plans.some((cp) => cp.planId === planId);
    if (!planMatch) {
      const error = new Error('该优惠码不适用于此订阅计划');
      error.status = 400;
      throw error;
    }
  }

  // 7. 检查用户是否已使用过该优惠码（如果提供了userId）
  if (userId) {
    const userUsage = await prisma.couponUsage.findFirst({
      where: {
        couponId: coupon.id,
        userId,
      },
    });

    if (userUsage) {
      const error = new Error('您已使用过此优惠码');
      error.status = 400;
      throw error;
    }
  }

  return coupon;
};

/**
 * 计算折扣金额
 * - percentage类型：originalAmount * (value / 100)
 * - fixed类型：value（不超过原价）
 * @param {Object} coupon - 优惠码对象
 * @param {number} originalAmount - 原始金额
 * @returns {number} 折扣金额
 */
const calculateDiscount = (coupon, originalAmount) => {
  const amount = parseFloat(originalAmount);

  // 百分比折扣：原价 * (折扣百分比 / 100)
  if (coupon.type === COUPON_TYPES.PERCENTAGE) {
    const discount = amount * (parseFloat(coupon.value) / 100);
    return Math.min(discount, amount); // 折扣不超过原价
  }

  // 固定金额减免：直接减免固定金额
  if (coupon.type === COUPON_TYPES.FIXED) {
    const discount = parseFloat(coupon.value);
    return Math.min(discount, amount); // 折扣不超过原价
  }

  return 0;
};

/**
 * 应用优惠码（使用优惠码）
 * 1. 创建CouponUsage使用记录
 * 2. 增加优惠码的usedCount计数
 * 使用数据库事务保证数据一致性
 * @param {string} couponId - 优惠码ID
 * @param {string} userId - 用户ID
 * @param {string} [subscriptionId] - 订阅ID
 * @param {string} [invoiceId] - 发票ID
 * @param {number} discountAmount - 折扣金额
 * @returns {Object} 使用记录
 * @throws {Error} 应用失败时抛出错误
 */
const applyCoupon = async (couponId, userId, subscriptionId, invoiceId, discountAmount) => {
  // 获取优惠码信息
  const coupon = await getCouponById(couponId);

  // 再次验证优惠码状态（双重检查）
  if (!coupon.isActive) {
    const error = new Error('优惠码已停用');
    error.status = 400;
    throw error;
  }

  // 再次检查使用次数（防止并发问题）
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    const error = new Error('优惠码使用次数已达上限');
    error.status = 400;
    throw error;
  }

  // 检查用户是否已使用过该优惠码
  const existingUsage = await prisma.couponUsage.findFirst({
    where: {
      couponId,
      userId,
    },
  });

  if (existingUsage) {
    const error = new Error('该用户已使用过此优惠码');
    error.status = 400;
    throw error;
  }

  // 使用事务保证创建使用记录和增加计数的原子性
  const usage = await prisma.$transaction(async (tx) => {
    // 1. 创建优惠码使用记录
    const newUsage = await tx.couponUsage.create({
      data: {
        couponId,
        userId,
        subscriptionId,
        invoiceId,
        discountAmount,
      },
    });

    // 2. 增加优惠码使用次数
    await tx.coupon.update({
      where: { id: couponId },
      data: {
        usedCount: { increment: 1 },
      },
    });

    return newUsage;
  });

  return usage;
};

/**
 * 获取优惠码列表（管理员，支持分页、状态过滤）
 * @param {Object} options - 查询选项
 * @param {number} [options.page=1] - 页码
 * @param {number} [options.limit=10] - 每页数量
 * @param {string} [options.status] - 状态过滤 (active/inactive)
 * @param {string} [options.type] - 类型过滤 (percentage/fixed)
 * @param {string} [options.search] - 搜索关键词
 * @returns {Object} 包含数据和分页信息的对象
 */
const listCoupons = async (options = {}) => {
  const {
    page = 1,
    limit = 10,
    status,
    type,
    search,
  } = options;

  const where = {};

  // 状态过滤
  if (status === 'active') {
    where.isActive = true;
  } else if (status === 'inactive') {
    where.isActive = false;
  }

  // 类型过滤
  if (type) {
    where.type = type;
  }

  // 关键词搜索（优惠码编码或描述）
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const skip = (page - 1) * limit;

  // 并行查询列表和总数，提高性能
  const [coupons, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        plans: true,
        _count: {
          select: { usages: true },
        },
      },
    }),
    prisma.coupon.count({ where }),
  ]);

  return {
    data: coupons,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * 更新优惠码（管理员）
 * @param {string} id - 优惠码ID
 * @param {Object} data - 更新数据
 * @returns {Object} 更新后的优惠码
 */
const updateCoupon = async (id, data) => {
  // 确认优惠码存在
  const coupon = await getCouponById(id);

  const { planIds, ...updateData } = data;

  // 如果更新了code，检查新code是否已被使用
  if (updateData.code && updateData.code !== coupon.code) {
    const existingCoupon = await prisma.coupon.findUnique({
      where: { code: updateData.code },
    });

    if (existingCoupon) {
      const error = new Error('优惠码已存在');
      error.status = 400;
      throw error;
    }
  }

  // 日期格式转换
  if (updateData.validFrom) {
    updateData.validFrom = new Date(updateData.validFrom);
  }

  if (updateData.validTo !== undefined) {
    updateData.validTo = updateData.validTo ? new Date(updateData.validTo) : null;
  }

  // 使用事务处理更新，确保计划关联关系同步更新
  const updatedCoupon = await prisma.$transaction(async (tx) => {
    // 更新优惠码基本信息
    const updated = await tx.coupon.update({
      where: { id },
      data: updateData,
      include: {
        plans: true,
        _count: {
          select: { usages: true },
        },
      },
    });

    // 如果提供了planIds，更新适用计划关联
    if (planIds !== undefined) {
      // 先删除所有旧的关联
      await tx.couponPlan.deleteMany({
        where: { couponId: id },
      });

      // 再创建新的关联
      if (planIds.length > 0) {
        await tx.couponPlan.createMany({
          data: planIds.map((planId) => ({
            couponId: id,
            planId,
          })),
        });
      }
    }

    return updated;
  });

  // 重新查询获取完整数据（包含更新后的计划关联）
  const result = await getCouponById(id);
  return result;
};

/**
 * 删除/停用优惠码（管理员）
 * 采用软删除方式，将isActive设为false
 * @param {string} id - 优惠码ID
 * @returns {Object} 停用后的优惠码
 */
const deleteCoupon = async (id) => {
  // 确认优惠码存在
  const coupon = await getCouponById(id);

  // 软删除：将isActive设为false
  const updated = await prisma.coupon.update({
    where: { id },
    data: { isActive: false },
    include: {
      plans: true,
    },
  });

  return updated;
};

module.exports = {
  createCoupon,
  validateCoupon,
  applyCoupon,
  getCouponByCode,
  getCouponById,
  listCoupons,
  updateCoupon,
  deleteCoupon,
  calculateDiscount,
  COUPON_TYPES,
  APPLIES_TO,
};
