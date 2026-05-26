const { sendMail } = require('./mailService');

async function test() {
  const to = process.env.TEST_TO || process.env.GMAIL_USER;
  if (!to) {
    console.error('No recipient specified. Set TEST_TO or GMAIL_USER environment variable.');
    process.exit(1);
  }

  const subject = 'Smart Todo — Test Email';
  const text = 'This is a test email sent from Smart Todo backend using Gmail SMTP.';
  const html = `<p>This is a test email sent from <strong>Smart Todo</strong> backend using Gmail SMTP.</p>`;

  try {
    const info = await sendMail({ to, subject, text, html });
    console.log('Email sent:', info.messageId || info.response || info);
    process.exit(0);
  } catch (err) {
    console.error('Failed to send test email:', err);
    process.exit(1);
  }
}

test();
