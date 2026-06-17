const prisma = require('../config/prisma');

const getPlans = async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) {
      where.status = status;
    }

    const [plans, total] = await Promise.all([
      prisma.plan.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { sortOrder: 'asc' },
          { createdAt: 'desc' },
        ],
      }),
      prisma.plan.count({ where }),
    ]);

    res.json({
      data: plans,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getPlanById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const plan = await prisma.plan.findUnique({
      where: { id },
    });

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({ data: plan });
  } catch (error) {
    next(error);
  }
};

const createPlan = async (req, res, next) => {
  try {
    const plan = await prisma.plan.create({
      data: req.body,
    });

    res.status(201).json({ data: plan });
  } catch (error) {
    next(error);
  }
};

const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existingPlan = await prisma.plan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = await prisma.plan.update({
      where: { id },
      data: req.body,
    });

    res.json({ data: plan });
  } catch (error) {
    next(error);
  }
};

const deletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existingPlan = await prisma.plan.findUnique({
      where: { id },
    });

    if (!existingPlan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const activeSubscriptions = await prisma.subscription.count({
      where: {
        planId: id,
        status: { in: ['active', 'pending_upgrade', 'past_due'] },
      },
    });

    if (activeSubscriptions > 0) {
      return res.status(400).json({
        error: 'Cannot delete plan with active subscriptions',
      });
    }

    await prisma.plan.delete({
      where: { id },
    });

    res.json({ message: 'Plan deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
};
