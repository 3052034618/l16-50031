const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/authMiddleware');
const {
  invoiceIdSchema,
  getInvoicesSchema,
  validateParams,
  validateQuery,
} = require('../validations/invoiceValidation');
const {
  getUserInvoices,
  getInvoiceById,
  downloadInvoicePdf,
} = require('../controllers/invoiceController');

router.use(authenticate);

router.get('/', validateQuery(getInvoicesSchema), getUserInvoices);

router.get('/:id', validateParams(invoiceIdSchema), getInvoiceById);

router.get('/:id/pdf', validateParams(invoiceIdSchema), downloadInvoicePdf);

module.exports = router;
