# Smart Task Manager - Implementation Guide

This guide walks you through configuring authentication, email notifications, and deploying the app.

---

## 1. Firebase Console Configuration

### 1.1 Enable Authentication Methods

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **smart-task-manager-12a2a**
3. Navigate to **Authentication** → **Sign-in method**
4. **Enable these providers:**
   - **Google** - Enable, save
   - **Email/Password** - Enable, save

### 1.2 Configure Authorized Domains

Under **Authentication** → **Sign-in method** → **Authorized domains**, add:

```
localhost
127.0.0.1
your-production-domain.com (when you have one)
```

This fixes the error: *"127.0.0.1 is not enabled for sign-in yet."*

### 1.3 Set Up Google OAuth Credentials (if not already done)

1. Go to **APIs & Services** → **Credentials**
2. Look for an OAuth 2.0 Client ID for **Web application**
3. If not present, create one:
   - Click **Create Credentials** → **OAuth client ID**
   - Choose **Web application**
   - Add authorized origins:
     - `http://localhost`
     - `http://127.0.0.1:8000` (or your dev server port)
     - Your production domain when ready
   - Add authorized redirect URIs:
     - `https://smart-task-manager-12a2a.firebaseapp.com/__/auth/handler`
     - `http://localhost/__/auth/handler`
   - Save and copy the Client ID (already in `firebase-config.js`)

---

## 2. Email Notifications Setup

### 2.1 SendGrid Configuration

The app uses SendGrid to send task reminder emails. **You must configure SendGrid before emails will be sent.**

#### Get SendGrid API Key

1. Create a [SendGrid account](https://sendgrid.com/) (free tier available)
2. Go to **Settings** → **API Keys**
3. Create a new **Full Access** API key
4. Copy the key (you'll need it in the next step)

#### Configure Verified Sender Email

1. In SendGrid, go to **Sender Authentication** → **Single Sender Verification**
2. Add your sender email (e.g., `noreply@yourdomain.com` or a Gmail address you control)
3. Verify the email by clicking the confirmation link in your inbox

### 2.2 Deploy Cloud Functions with SendGrid

#### Prerequisites

- [Node.js](https://nodejs.org/) 16+ installed
- [Firebase CLI](https://firebase.google.com/docs/cli) installed and authenticated

```bash
npm install -g firebase-tools
firebase login
```

#### Deploy the Function

From the project root:

```bash
cd functions
npm install
```

Set SendGrid credentials:

```bash
firebase functions:config:set sendgrid.key="YOUR_SENDGRID_API_KEY" sendgrid.from="noreply@yourdomain.com"
```

Deploy:

```bash
firebase deploy --only functions:scheduledNotify
```

**Verify deployment:**

Go to Firebase Console → **Functions** → **scheduledNotify** → **Logs** tab. You should see the function running every minute.

---

## 3. How Authentication Works

### Google Sign-In
- User clicks "Sign in with Google"
- Browser redirects to Google OAuth consent screen
- User logs in with their Gmail
- User is created in Firebase and `users/{uid}` doc is created in Firestore
- Stored fields: `email`, `displayName`, `photoURL`, `emailVerified`, `providerIds`, `lastLoginAt`

### Email/Password Sign-Up
- User enters Gmail and password, clicks "Sign up"
- Account created in Firebase
- Verification email sent (user checks Inbox/Spam/Promotions)
- User verifies email by clicking link in email
- User can now sign in with that email/password

### Email/Password Sign-In (with provider check)
- User enters Gmail and password
- App checks what authentication methods exist for that account
- **If only Google is linked:** Shows error: *"This account was created using Google Sign-In. Please continue using Google Login instead of password login."*
- **If password is linked:** Allows sign-in

### Persistent Login (Browser-Based)
- Uses `browserLocalPersistence` — user stays signed in on that device/browser
- Sign out needed to switch accounts or reset
- No cross-device automatic login (by design — requires additional server-side device tracking)

---

## 4. Task Reminder Emails

### How It Works

1. **User creates task with due date and alert time**
   - Example: Task due 26 May 2026 at 8:00 PM, alert 15 minutes before
   - Client calculates: `nextNotifyAt` = 7:45 PM on 26 May 2026
   - Task synced to Firestore with `notifySent: false`

2. **Cloud Function runs every 1 minute**
   - Queries each user's tasks where `nextNotifyAt <= now` and `notifySent == false`
   - Sends professional email via SendGrid
   - Marks task `notifySent: true` and records `lastNotifiedAt`

3. **Email contains:**
   - Task title
   - Task description
   - Scheduled date and time
   - Professional HTML and plain text formats

### Example Email

**Subject:** Task Reminder – Meeting with Team

**Body:**
```
This is a reminder for your scheduled task.

Task: Meeting with Team
Description: Discuss UI and Firebase integration updates.
Scheduled Time: 26 May 2026, 8:00 PM

Please log in to your account to mark this task as complete or update it as needed.

Best regards,
Smart Task Manager Team
```

### Troubleshooting Emails

- **Emails not sending?**
  - Check Cloud Function logs: Firebase Console → **Functions** → **scheduledNotify** → **Logs**
  - Ensure SendGrid API key is set correctly
  - Verify sender email is verified in SendGrid
  - Check that task has `notify` (minutes) value > 0

- **Emails going to spam?**
  - Verify sender email domain in SendGrid (SPF/DKIM records)
  - Use a verified domain instead of Gmail if possible
  - Ask users to mark as "Not spam" when emails arrive

---

## 5. Local Development

### 1. Install Dependencies

```bash
# No npm/yarn needed for frontend (uses CDN imports)
# For Cloud Functions:
cd functions
npm install
cd ..
```

### 2. Start a Local Server

```bash
# Using Python 3
python -m http.server 8000 --directory .

# Or using Node.js http-server
npx http-server . -p 8000
```

Open: `http://localhost:8000/html/main1.html`

### 3. Test Google Sign-In

1. First time? You'll see: *"127.0.0.1 is not enabled for sign-in yet. Add 127.0.0.1 to the Authorized domains list in Firebase Console."*
2. Go to Firebase Console → **Authentication** → **Sign-in method** → **Authorized domains**
3. Add `127.0.0.1`
4. Refresh, try again

### 4. Test Email/Password

1. Sign up with email + password (verification email sent)
2. Check your Gmail Inbox/Spam/Promotions for verification link
3. Click link to verify
4. Sign out, sign in with email/password (should work now)

### 5. Create a Task & Test Notifications

1. Sign in with Google or Email/Password
2. Click "Add task"
3. Enter:
   - Title: "Test reminder"
   - Description: "This is a test"
   - Due date/time: Pick a time 2 minutes from now
   - Notify: "15" (minutes before)
4. Save task
5. Task syncs to Firestore (check Cloud Firestore in Console)
6. Wait for the scheduled time — email should arrive (check Inbox/Spam)

---

## 6. Production Deployment

### Option A: Firebase Hosting

```bash
firebase deploy
```

This deploys your HTML/CSS/JS and Cloud Functions.

### Option B: Custom Server

1. Build/copy all files to your server
2. Serve `html/main1.html` from your domain
3. Ensure domain is added to **Authorized domains** in Firebase
4. Cloud Functions still deploy via `firebase deploy --only functions`

### Security Checklist

- [ ] Add your production domain to Firestore security rules
- [ ] Add your production domain to **Authorized domains** in Firebase Auth
- [ ] Update `FROM_EMAIL` in Cloud Functions to a verified sending domain
- [ ] Set strong Firestore rules (see `firestore.rules`)
- [ ] Enable HTTPS (required for OAuth)
- [ ] Use environment variables for secrets (SendGrid key, etc.)

---

## 7. Firebase Security Rules

Edit `firestore.rules` to match your security requirements. Example:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
      // Tasks subcollection
      match /tasks/{taskId} {
        allow read, write: if request.auth.uid == uid;
      }
    }
    // Community messages
    match /community/{document=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

Deploy rules:

```bash
firebase deploy --only firestore:rules
```

---

## 8. Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| "127.0.0.1 is not enabled for sign-in yet" | Add 127.0.0.1 to Authorized domains in Firebase Console → Authentication → Sign-in method |
| "This account was created using Google Sign-In" | User tried email login on a Google-only account; must use Google Sign-In |
| Email verification not arriving | Check spam/promotions folders; verify sender email in SendGrid |
| Task reminders not emailing | Check Cloud Function logs; ensure SendGrid key is set; verify task has `notify` > 0 |
| Sign-in popup blocked | Allow popups for your domain in browser settings |

---

## 9. Next Steps

1. **Configure Firebase Console** (§1)
2. **Set up SendGrid** (§2.1)
3. **Deploy Cloud Functions** (§2.2)
4. **Test locally** (§5)
5. **Deploy to production** (§6)

Questions? Check the logs in Firebase Console → **Functions** → **Logs** or **Cloud Firestore** → **Rules** for detailed errors.
