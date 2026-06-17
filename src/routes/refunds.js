const express = require('express');
const router = express.Router();

const { authenticate, requireAdmin } = require('../middleware/authMiddleware');
const { requireFree, requireBasic } = require('../middleware/featureAccess');
const {
  createRefundSchema,
  refundIdSchema,
  getRefundsSchema,
  reviewRefundSchema,
  validate,
  validateParams,
  validateQuery,
} = require('../validations/refundValidation');
const {
  createRefundRequest,
  getUserRefunds,
  getRefundById,
  listAllRefunds,
  approveRefund,
  rejectRefund,
} = require('../controllers/refundController');

router.post('/', requireBasic, validate(createRefundSchema), createRefundRequest);

router.get('/', requireFree, validateQuery(getRefundsSchema), getUserRefunds);

router.get('/admin/all', authenticate, requireAdmin, validateQuery(getRefundsSchema), listAllRefunds);

router.get('/:id', requireFree, validateParams(refundIdSchema), getRefundById);

router.post('/:id/approve', authenticate, requireAdmin, validateParams(refundIdSchema), validate(reviewRefundSchema), approveRefund);

router.post('/:id/reject', authenticate, requireAdmin, validateParams(refundIdSchema), validate(reviewRefundSchema), rejectRefund);

module.exports = router;
