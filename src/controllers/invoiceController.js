const invoiceService = require('../services/invoiceService');
const fs = require('fs');
const path = require('path');

const getUserInvoices = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page, limit, status } = req.query;

    const result = await invoiceService.getUserInvoices(userId, {
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

const getInvoiceById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const invoice = userRole === 'admin'
      ? await invoiceService.getInvoiceById(id)
      : await invoiceService.getInvoiceById(id, userId);

    res.json({ data: invoice });
  } catch (error) {
    next(error);
  }
};

const downloadInvoicePdf = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const invoice = userRole === 'admin'
      ? await invoiceService.getInvoiceById(id)
      : await invoiceService.getInvoiceById(id, userId);

    let pdfPath = invoice.pdfUrl;

    if (!pdfPath || !fs.existsSync(pdfPath)) {
      pdfPath = await invoiceService.generateInvoicePdf(id);
    }

    const fileName = `invoice-${invoice.invoiceNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserInvoices,
  getInvoiceById,
  downloadInvoicePdf,
};
