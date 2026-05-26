const nodemailer = require('nodemailer');

const MAIL_PROVIDER = process.env.MAIL_PROVIDER || 'gmail';
const MAIL_FROM = process.env.MAIL_FROM || process.env.GMAIL_USER || 'no-reply@smarttodo.com';

function createGmailTransporter() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPassword) {
    console.error('Gmail SMTP configuration is missing. Set GMAIL_USER and GMAIL_APP_PASSWORD.');
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPassword
    }
  });
}

function getTransporter() {
  if (MAIL_PROVIDER === 'gmail') {
    return createGmailTransporter();
  }

  console.error(`Unsupported MAIL_PROVIDER: ${MAIL_PROVIDER}. Only 'gmail' is currently supported.`);
  return null;
}

async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('Mail transporter is not configured.');
  }

  const message = {
    from: MAIL_FROM,
    to,
    subject,
    text,
    html
  };

  return transporter.sendMail(message);
}

module.exports = { sendMail };
