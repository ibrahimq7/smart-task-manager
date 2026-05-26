const { initFirebaseAdmin } = require('../backend/firebaseAdmin');

const SCHEDULER_TOKEN = process.env.SCHEDULER_TOKEN || '';
const admin = initFirebaseAdmin();
const db = admin.firestore();

module.exports = async (req, res) => {
  const token = req.headers['x-scheduler-token'] || req.query.token;
  if (!SCHEDULER_TOKEN || token !== SCHEDULER_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const uid = req.body?.uid || req.query.uid;
  const email = req.body?.email || req.query.email;
  const title = req.body?.title || req.query.title || 'Test reminder task';
  const description = req.body?.description || req.query.description || 'This is a scheduled reminder task generated for testing.';
  const dueMinutes = Number(req.body?.dueMinutes ?? req.query.dueMinutes ?? 10);
  const preAlertMinutes = Number(req.body?.preAlertMinutes ?? req.query.preAlertMinutes ?? 5);

  if (!uid || !email) {
    res.status(400).json({ error: 'Missing uid or email. Provide uid and email in body or query.' });
    return;
  }

  const dueDate = new Date(Date.now() + Math.max(1, dueMinutes) * 60000);
  const dueTime = admin.firestore.Timestamp.fromDate(dueDate);
  const preAlertTime = preAlertMinutes > 0
    ? admin.firestore.Timestamp.fromDate(new Date(dueDate.getTime() - preAlertMinutes * 60000))
    : null;

  const taskId = `test-${Date.now()}`;
  const taskRef = db.collection('users').doc(uid).collection('tasks').doc(taskId);
  const userRef = db.collection('users').doc(uid);

  await userRef.set({ email }, { merge: true });
  await taskRef.set({
    title,
    description,
    dueTime,
    preAlertTime,
    notify: preAlertMinutes > 0 ? preAlertMinutes : 0,
    userEmail: email,
    preAlertSent: false,
    dueSent: false,
    completed: false,
    priority: 'medium',
    ownerId: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  res.status(200).json({
    ok: true,
    taskId,
    uid,
    email,
    dueTime: dueDate.toISOString(),
    preAlertTime: preAlertTime ? preAlertTime.toDate().toISOString() : null
  });
};
