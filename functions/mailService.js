/**
 * Mail Service Abstraction
 * Supports multiple providers: Gmail SMTP (Nodemailer), SendGrid, etc.
 * Provider selection via MAIL_PROVIDER env var (default: 'gmail')
 */

const nodemailer = require('nodemailer');

/**
 * Initialize mail service based on provider
 * Providers: 'gmail' | 'sendgrid'
 */
function initMailService() {
  const provider = process.env.MAIL_PROVIDER || 'gmail';
  
  if (provider === 'gmail') {
    return createGmailTransport();
  } else if (provider === 'sendgrid') {
    return createSendGridTransport();
  } else {
    console.warn(`Unknown MAIL_PROVIDER: ${provider}, defaulting to gmail`);
    return createGmailTransport();
  }
}

/**
 * Gmail SMTP Transport (Nodemailer)
 * Uses Gmail SMTP server with App Password
 * Env vars required:
 *   GMAIL_USER (your Gmail address)
 *   GMAIL_APP_PASSWORD (Gmail App Password, not account password)
 */
function createGmailTransport() {
  const gmailUser = process.env.GMAIL_USER || '';
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD || '';

  if (!gmailUser || !gmailAppPassword) {
    console.warn(
      'Gmail SMTP: GMAIL_USER and GMAIL_APP_PASSWORD env vars not set. ' +
      'Emails will not be sent. Set them to enable Gmail SMTP.'
    );
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailAppPassword
    }
  });
}

/**
 * SendGrid Transport (for future use)
 * Env vars required:
 *   SENDGRID_API_KEY
 *   SENDGRID_FROM_EMAIL
 */
function createSendGridTransport() {
  const sgApiKey = process.env.SENDGRID_API_KEY || '';
  const sgFromEmail = process.env.SENDGRID_FROM_EMAIL || '';

  if (!sgApiKey) {
    console.warn('SendGrid: SENDGRID_API_KEY not set. Emails will not be sent.');
    return null;
  }

  // SendGrid requires sgMail library; stub here for reference
  // In production, use: const sgMail = require('@sendgrid/mail');
  console.warn('SendGrid provider requires @sendgrid/mail. Install it and update this file.');
  return null;
}

/**
 * Send email using configured provider
 * @param {Object} mailOptions - { to, subject, text, html }
 * @returns {Promise}
 */
async function sendMail(mailOptions) {
  const transporter = initMailService();

  if (!transporter) {
    console.warn('Mail service not configured. Email not sent:', mailOptions.subject);
    return { success: false, error: 'Mail service not initialized' };
  }

  const fromEmail = process.env.GMAIL_USER || process.env.SENDGRID_FROM_EMAIL || 'no-reply@smarttodo.com';

  const message = {
    from: fromEmail,
    to: mailOptions.to,
    subject: mailOptions.subject,
    text: mailOptions.text || '',
    html: mailOptions.html || ''
  };

  try {
    const result = await transporter.sendMail(message);
    console.log('Email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Failed to send email:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendMail,
  initMailService
};
