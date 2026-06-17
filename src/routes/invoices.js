const express = require('express');
const router = express.Router();

const { requireFree } = require('../middleware/featureAccess');
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

router.get('/', requireFree, validateQuery(getInvoicesSchema), getUserInvoices);

router.get('/:id', requireFree, validateParams(invoiceIdSchema), getInvoiceById);

router.get('/:id/pdf', requireFree, validateParams(invoiceIdSchema), downloadInvoicePdf);

module.exports = router;
