const refundService = require('../services/refundService');

const createRefundRequest = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { paymentId, amount, reason } = req.body;

    const refund = await refundService.createRefundRequest(
      userId,
      paymentId,
      amount,
      reason
    );

    res.status(201).json({
      data: refund,
      message: '退款申请已提交，请等待审核',
    });
  } catch (error) {
    next(error);
  }
};

const getUserRefunds = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page, limit, status } = req.query;

    const result = await refundService.getUserRefunds(userId, {
      page,
      limit,
      status,
    });

    res.json({
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const getRefundById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';

    const refund = await refundService.getRefundById(id, userId, isAdmin);

    res.json({ data: refund });
  } catch (error) {
    next(error);
  }
};

const listAllRefunds = async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;

    const result = await refundService.listAllRefunds({
      page,
      limit,
      status,
    });

    res.json({
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const approveRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const { adminNote } = req.body;

    const refund = await refundService.approveRefund(id, adminId, adminNote);

    res.json({
      data: refund,
      message: '退款审核通过，已执行退款',
    });
  } catch (error) {
    next(error);
  }
};

const rejectRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const { adminNote } = req.body;

    const refund = await refundService.rejectRefund(id, adminId, adminNote);

    res.json({
      data: refund,
      message: '退款申请已驳回',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createRefundRequest,
  getUserRefunds,
  getRefundById,
  listAllRefunds,
  approveRefund,
  rejectRefund,
};
