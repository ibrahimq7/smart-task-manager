const { initFirebaseAdmin } = require('./firebaseAdmin');
const { sendMail } = require('./mailService');

const admin = initFirebaseAdmin();
const db = admin.firestore();

function formatDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'No date set';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function normalizeText(value) {
  return String(value || 'No description provided').trim();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

async function loadUserEmail(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  return userDoc.exists ? (userDoc.data().email || null) : null;
}

async function run() {
  const nowISO = new Date().toISOString();
  console.log('Reminder runner started at', nowISO);
  // Build queries for pre-alerts and due-time alerts (and include legacy nextNotifyAt fallback)
  const now = Date.now();
  const preAlertQuery = db.collectionGroup('tasks')
    .where('completed', '==', false)
    .where('preAlertSent', '==', false)
    .where('preAlertTime', '<=', nowISO)
    .limit(200);

  const dueQuery = db.collectionGroup('tasks')
    .where('completed', '==', false)
    .where('dueSent', '==', false)
    .where('dueTime', '<=', nowISO)
    .limit(200);

  const legacyQuery = db.collectionGroup('tasks')
    .where('completed', '==', false)
    .where('notifySent', '==', false)
    .where('nextNotifyAt', '<=', nowISO)
    .limit(200);

  const [preSnap, dueSnap, legacySnap] = await Promise.all([preAlertQuery.get(), dueQuery.get(), legacyQuery.get()]);

  const docs = new Map();
  function addDocs(snap) {
    if (!snap || snap.empty) return;
    for (const d of snap.docs) docs.set(d.ref.path, d);
  }

  addDocs(preSnap);
  addDocs(dueSnap);
  addDocs(legacySnap);

  if (docs.size === 0) {
    console.log('No pending reminders found.');
    return;
  }

  let sentCount = 0;
  const updatePromises = [];

  for (const [path, taskDoc] of docs.entries()) {
    const task = taskDoc.data();
    const parent = taskDoc.ref.parent.parent;
    if (!parent) {
      console.warn('Skipping task without user parent:', taskDoc.id);
      continue;
    }

    const userId = parent.id;
    const userEmail = task.userEmail || (await loadUserEmail(userId));
    if (!userEmail) {
      console.warn(`Missing user email for ${userId}; skipping task ${taskDoc.id}`);
      continue;
    }

    // Determine which notification to send
    const preAlertTimeVal = task.preAlertTime ? new Date(task.preAlertTime).getTime() : null;
    const dueTimeVal = task.dueTime ? new Date(task.dueTime).getTime() : null;
    const shouldSendPreAlert = preAlertTimeVal && !task.preAlertSent && preAlertTimeVal <= now;
    const shouldSendDue = dueTimeVal && !task.dueSent && dueTimeVal <= now;
    const isLegacy = task.nextNotifyAt && !task.notifySent && new Date(task.nextNotifyAt).getTime() <= now;

    // If both pre-alert and due are due now, prefer sending the due notification and mark pre-alert sent to avoid duplicate emails
    if (shouldSendDue) {
      const subject = `Task Due Now – ${task.title || 'Untitled task'}`;
      const dueDate = task.dueTime ? formatDate(task.dueTime) : 'No date set';
      const textBody = `This task is now due.

Task: ${task.title || 'Untitled task'}
Description: ${normalizeText(task.description || task.notes)}
Scheduled Time: ${dueDate}`;
      const htmlBody = `<p>This task is now due.</p>
        <p><strong>Task:</strong> ${escapeHtml(task.title || 'Untitled task')}</p>
        <p><strong>Description:</strong> ${escapeHtml(normalizeText(task.description || task.notes))}</p>
        <p><strong>Scheduled Time:</strong> ${escapeHtml(dueDate)}</p>`;

      try {
        await sendMail({ to: userEmail, subject, text: textBody, html: htmlBody });
        sentCount += 1;
        const updates = { dueSent: true, lastNotifiedAt: admin.firestore.FieldValue.serverTimestamp() };
        // Also mark preAlertSent to avoid sending a stale pre-alert after due
        if (!task.preAlertSent) updates.preAlertSent = true;
        updatePromises.push(taskDoc.ref.update(updates));
        console.log(`Sent due reminder for task ${taskDoc.id} to ${userEmail}`);
      } catch (err) {
        console.error(`Failed to send due reminder for ${taskDoc.id}:`, err.message || err);
      }
      continue;
    }

    if (shouldSendPreAlert) {
      const subject = `Upcoming Task Reminder – ${task.title || 'Untitled task'}`;
      const dueDate = task.dueTime ? formatDate(task.dueTime) : 'No date set';
      const textBody = `This is a pre-alert for your upcoming task.

Task: ${task.title || 'Untitled task'}
Description: ${normalizeText(task.description || task.notes)}
Scheduled Time: ${dueDate}`;
      const htmlBody = `<p>This is a pre-alert for your upcoming task.</p>
        <p><strong>Task:</strong> ${escapeHtml(task.title || 'Untitled task')}</p>
        <p><strong>Description:</strong> ${escapeHtml(normalizeText(task.description || task.notes))}</p>
        <p><strong>Scheduled Time:</strong> ${escapeHtml(dueDate)}</p>`;

      try {
        await sendMail({ to: userEmail, subject, text: textBody, html: htmlBody });
        sentCount += 1;
        updatePromises.push(taskDoc.ref.update({ preAlertSent: true, lastNotifiedAt: admin.firestore.FieldValue.serverTimestamp() }));
        console.log(`Sent pre-alert for task ${taskDoc.id} to ${userEmail}`);
      } catch (err) {
        console.error(`Failed to send pre-alert for ${taskDoc.id}:`, err.message || err);
      }
      continue;
    }

    // Legacy handling: nextNotifyAt / notifySent
    if (isLegacy) {
      const subject = `Task Reminder – ${task.title || 'Untitled task'}`;
      const dueDate = task.dueTime || task.due || 'No date set';
      const textBody = `This is a reminder for your scheduled task.

Task: ${task.title || 'Untitled task'}
Description: ${normalizeText(task.description || task.notes)}
Scheduled Time: ${dueDate}`;
      const htmlBody = `<p>This is a reminder for your scheduled task.</p>
        <p><strong>Task:</strong> ${escapeHtml(task.title || 'Untitled task')}</p>
        <p><strong>Description:</strong> ${escapeHtml(normalizeText(task.description || task.notes))}</p>
        <p><strong>Scheduled Time:</strong> ${escapeHtml(dueDate)}</p>`;
      try {
        await sendMail({ to: userEmail, subject, text: textBody, html: htmlBody });
        sentCount += 1;
        updatePromises.push(taskDoc.ref.update({ notifySent: true, lastNotifiedAt: admin.firestore.FieldValue.serverTimestamp() }));
        console.log(`Sent legacy reminder for task ${taskDoc.id} to ${userEmail}`);
      } catch (err) {
        console.error(`Failed to send legacy reminder for ${taskDoc.id}:`, err.message || err);
      }
      continue;
    }
    // If none matched, skip
  }

  await Promise.all(updatePromises);
  console.log(`Reminder runner finished. Emails sent: ${sentCount}`);
}

async function runReminders() {
  try {
    await run();
  } catch (error) {
    console.error('Reminder runner error:', error);
    throw error;
  }
}

// Allow running as a standalone script or importing as a module
if (require.main === module) {
  run().catch((error) => {
    console.error('Reminder runner error:', error);
    process.exit(1);
  });
}

module.exports = { runReminders };
