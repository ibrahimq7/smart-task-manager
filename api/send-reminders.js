const { runReminders } = require('../backend/sendReminders');

// Simple protection token to prevent public abuse. Set in Vercel env as SCHEDULER_TOKEN
const SCHEDULER_TOKEN = process.env.SCHEDULER_TOKEN || '';

module.exports = async (req, res) => {
  // Only allow POST or GET from cron
  const token = req.headers['x-scheduler-token'] || req.query.token;
  if (!SCHEDULER_TOKEN || token !== SCHEDULER_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    await runReminders();
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-reminders API error:', err);
    res.status(500).json({ error: String(err) });
  }
};
