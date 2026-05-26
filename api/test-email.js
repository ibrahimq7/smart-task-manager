const { sendMail } = require('../backend/mailService');

const SCHEDULER_TOKEN = process.env.SCHEDULER_TOKEN || '';

module.exports = async (req, res) => {
  const token = req.headers['x-scheduler-token'] || req.query.token;
  if (!SCHEDULER_TOKEN || token !== SCHEDULER_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const to = req.body?.to || req.query.to || process.env.GMAIL_USER;
  if (!to) return res.status(400).json({ error: 'No recipient specified' });

  try {
    const info = await sendMail({
      to,
      subject: 'Smart Todo — Test email (via Vercel API)',
      text: 'This is a test email from Smart Todo via Vercel API route.'
    });
    res.status(200).json({ ok: true, info });
  } catch (err) {
    console.error('test-email error:', err);
    res.status(500).json({ error: String(err) });
  }
};
