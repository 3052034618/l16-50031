const express = require('express');
const router = express.Router();

const { authenticate, requireAdmin } = require('../middleware/authMiddleware');
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

router.use(authenticate);

router.post('/', validate(createRefundSchema), createRefundRequest);

router.get('/', validateQuery(getRefundsSchema), getUserRefunds);

router.get('/admin/all', requireAdmin, validateQuery(getRefundsSchema), listAllRefunds);

router.get('/:id', validateParams(refundIdSchema), getRefundById);

router.post('/:id/approve', requireAdmin, validateParams(refundIdSchema), validate(reviewRefundSchema), approveRefund);

router.post('/:id/reject', requireAdmin, validateParams(refundIdSchema), validate(reviewRefundSchema), rejectRefund);

module.exports = router;
