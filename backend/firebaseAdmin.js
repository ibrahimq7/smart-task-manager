const admin = require('firebase-admin');

function initFirebaseAdmin() {
  if (admin.apps.length) {
    return admin;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
    return admin;
  }

  const keyValue = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!keyValue) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is required to initialize Firebase Admin.');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(keyValue);
  } catch (err) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT contains invalid JSON.');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  return admin;
}

module.exports = { initFirebaseAdmin };
