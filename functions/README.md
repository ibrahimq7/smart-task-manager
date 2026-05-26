# Cloud Functions for ToDo app

This folder contains a scheduled Cloud Function that sends email reminders for tasks.

Requirements:
- A Firebase project with Cloud Functions enabled.
- A SendGrid API key (or another email provider; modify `index.js` accordingly).

Setup and deploy:

1. Install dependencies:

```bash
cd functions
npm install
```

2. Configure environment variables for functions (use Firebase CLI):

```bash
firebase functions:config:set sendgrid.key="YOUR_SENDGRID_API_KEY" sendgrid.from="no-reply@yourdomain.com"
```

Alternatively, set `SENDGRID_API_KEY` and `FROM_EMAIL` in the Functions runtime environment.

3. Deploy the function:

```bash
firebase deploy --only functions:scheduledNotify
```

Notes:
- The function queries each user's `tasks` subcollection for documents with `nextNotifyAt` <= now and `notifySent == false`.
- The client syncs `nextNotifyAt` and `notifySent` fields when uploading tasks to Firestore.
