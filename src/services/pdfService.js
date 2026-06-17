const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const COMPANY_INFO = {
  name: process.env.COMPANY_NAME || 'TechCorp Inc.',
  address: process.env.COMPANY_ADDRESS || '123 Tech Street, Silicon Valley, CA 94000',
  phone: process.env.COMPANY_PHONE || '+1 (555) 123-4567',
  email: process.env.COMPANY_EMAIL || 'billing@techcorp.com',
  website: process.env.COMPANY_WEBSITE || 'www.techcorp.com',
  taxId: process.env.COMPANY_TAX_ID || '12-3456789',
};

const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatCurrency = (amount) => {
  const num = parseFloat(amount) || 0;
  return `$${num.toFixed(2)}`;
};

const generateInvoicePdf = (invoice, items, user) => {
  return new Promise((resolve, reject) => {
    try {
      const invoicesDir = path.join(process.cwd(), 'invoices');
      if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir, { recursive: true });
      }

      const fileName = `invoice-${invoice.invoiceNumber}.pdf`;
      const filePath = path.join(invoicesDir, fileName);

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
      });

      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      doc.fontSize(24).font('Helvetica-Bold');
      doc.fillColor('#1a1a2e').text('INVOICE', 50, 50, { align: 'right' });

      doc.fontSize(10).font('Helvetica');
      doc.fillColor('#666666');
      doc.text(`Invoice #: ${invoice.invoiceNumber}`, 50, 85, { align: 'right' });
      doc.text(`Date: ${formatDate(invoice.createdAt)}`, 50, 100, { align: 'right' });
      doc.text(`Due Date: ${formatDate(invoice.dueDate || invoice.createdAt)}`, 50, 115, { align: 'right' });

      doc.fillColor('#1a1a2e');
      doc.fontSize(14).font('Helvetica-Bold');
      doc.text(COMPANY_INFO.name, 50, 50);

      doc.fontSize(9).font('Helvetica');
      doc.fillColor('#666666');
      doc.text(COMPANY_INFO.address, 50, 72);
      doc.text(`Phone: ${COMPANY_INFO.phone}`, 50, 92);
      doc.text(`Email: ${COMPANY_INFO.email}`, 50, 105);
      doc.text(`Website: ${COMPANY_INFO.website}`, 50, 118);
      doc.text(`Tax ID: ${COMPANY_INFO.taxId}`, 50, 131);

      doc.moveDown(2);

      doc.fillColor('#1a1a2e');
      doc.fontSize(11).font('Helvetica-Bold');
      doc.text('Bill To:', 50, 180);

      doc.fontSize(10).font('Helvetica');
      doc.fillColor('#333333');
      doc.text(user.name || user.email, 50, 198);
      doc.text(user.email, 50, 213);

      const statusY = 180;
      doc.fontSize(11).font('Helvetica-Bold');
      doc.text('Status:', 400, statusY, { align: 'right' });

      let statusColor = '#f39c12';
      let statusText = invoice.status.toUpperCase();
      if (invoice.status === 'paid') {
        statusColor = '#27ae60';
      } else if (invoice.status === 'void') {
        statusColor = '#95a5a6';
      } else if (invoice.status === 'uncollectible') {
        statusColor = '#e74c3c';
      }

      doc.fillColor(statusColor);
      doc.text(statusText, 400, statusY + 18, { align: 'right' });

      doc.moveDown(3);

      const tableTop = 260;
      const col1X = 50;
      const col2X = 300;
      const col3X = 370;
      const col4X = 430;
      const col5X = 490;

      doc.fillColor('#1a1a2e');
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Description', col1X, tableTop);
      doc.text('Qty', col2X, tableTop, { width: 60, align: 'right' });
      doc.text('Unit Price', col3X, tableTop, { width: 60, align: 'right' });
      doc.text('Amount', col5X - 10, tableTop, { width: 60, align: 'right' });

      doc.strokeColor('#e0e0e0');
      doc.lineWidth(1);
      doc.moveTo(50, tableTop + 18).lineTo(545, tableTop + 18).stroke();

      let currentY = tableTop + 30;
      doc.fontSize(10).font('Helvetica');
      doc.fillColor('#333333');

      items.forEach((item) => {
        doc.text(item.description, col1X, currentY, { width: 240 });
        doc.text(String(item.quantity || 1), col2X, currentY, { width: 60, align: 'right' });
        doc.text(formatCurrency(item.unitAmount), col3X, currentY, { width: 60, align: 'right' });
        doc.text(formatCurrency(item.amount), col5X - 10, currentY, { width: 60, align: 'right' });
        currentY += 20;
      });

      doc.moveDown(1);
      currentY += 10;

      doc.strokeColor('#e0e0e0');
      doc.lineWidth(0.5);
      doc.moveTo(350, currentY).lineTo(545, currentY).stroke();
      currentY += 10;

      doc.fontSize(10).font('Helvetica');
      doc.fillColor('#666666');
      doc.text('Subtotal:', 400, currentY, { width: 100, align: 'right' });
      doc.fillColor('#333333');
      doc.text(formatCurrency(invoice.subtotal), 490, currentY, { width: 60, align: 'right' });
      currentY += 20;

      if (invoice.discount && parseFloat(invoice.discount) > 0) {
        doc.fillColor('#666666');
        doc.text('Discount:', 400, currentY, { width: 100, align: 'right' });
        doc.fillColor('#e74c3c');
        doc.text(`-${formatCurrency(invoice.discount)}`, 490, currentY, { width: 60, align: 'right' });
        currentY += 20;
      }

      doc.fillColor('#666666');
      doc.text('Tax:', 400, currentY, { width: 100, align: 'right' });
      doc.fillColor('#333333');
      doc.text(formatCurrency(invoice.tax), 490, currentY, { width: 60, align: 'right' });
      currentY += 20;

      doc.strokeColor('#e0e0e0');
      doc.lineWidth(0.5);
      doc.moveTo(350, currentY).lineTo(545, currentY).stroke();
      currentY += 10;

      doc.fontSize(12).font('Helvetica-Bold');
      doc.fillColor('#1a1a2e');
      doc.text('Total:', 400, currentY, { width: 100, align: 'right' });
      doc.text(formatCurrency(invoice.amount), 490, currentY, { width: 60, align: 'right' });

      doc.moveDown(3);

      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#999999');
        doc.text(
          `Page ${i + 1} of ${pageCount}`,
          50,
          doc.page.height - 50,
          { align: 'center', width: doc.page.width - 100 }
        );
      }

      doc.end();

      writeStream.on('finish', () => {
        resolve(filePath);
      });

      writeStream.on('error', (err) => {
        reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = {
  generateInvoicePdf,
  formatDate,
  formatCurrency,
  COMPANY_INFO,
};
