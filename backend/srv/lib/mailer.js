const nodemailer = require('nodemailer');
const cds = require('@sap/cds');
const LOG = cds.log('mailer');

async function sendInvoiceEmail(pdfBuffer, email, invoiceNo) {
    if (!email) {
        throw new Error("Customer has no email address.");
    }

    // Try to get test account, or create one on the fly if no env vars are present
    let authOptions = {};
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        authOptions = {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        };
    } else {
        // Automatically generate a test account if no credentials are provided (useful for development)
        const testAccount = await nodemailer.createTestAccount();
        authOptions = {
            user: testAccount.user,
            pass: testAccount.pass
        };
    }

    let transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.ethereal.email",
        port: process.env.SMTP_PORT || 587,
        secure: false, // true for 465, false for other ports
        auth: authOptions,
    });

    let info = await transporter.sendMail({
        from: '"Northwind Order Hub" <billing@northwind.com>',
        to: email,
        subject: `Invoice ${invoiceNo}`,
        text: `Dear Customer,\n\nPlease find attached your invoice ${invoiceNo}.\n\nThank you for your business!\n\nBest regards,\nNorthwind Traders`,
        html: `<p>Dear Customer,</p><p>Please find attached your invoice <b>${invoiceNo}</b>.</p><p>Thank you for your business!</p><br><p>Best regards,<br>Northwind Traders</p>`,
        attachments: [
            {
                filename: `${invoiceNo}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }
        ]
    });

    LOG.info('Message sent:', info.messageId);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) LOG.info('Preview URL:', previewUrl);
    return info;
}

module.exports = {
    sendInvoiceEmail
};
