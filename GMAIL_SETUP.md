# Gmail SMTP Setup for Task Reminders

This guide helps you configure Gmail SMTP for sending task reminder emails using Nodemailer and the free scheduler.

## Prerequisites
- Google account with Gmail
- Gmail enabled for your account
- 2-Step Verification enabled on your Google account

## Step 1: Enable 2-Step Verification
1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable "2-Step Verification" if not already enabled

## Step 2: Create an App Password
1. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
2. Select:
   - App: Mail
   - Device: Other (custom name)
   - Name: Smart Todo
3. Copy the generated 16-character password.

> Use this App Password in place of your Gmail account password. Do not use your actual Gmail login password.

## Step 3: Configure the Backend

Set the following environment variables in your scheduler environment (GitHub Actions or local development):

```powershell
$env:MAIL_PROVIDER = "gmail"
$env:GMAIL_USER = "your-email@gmail.com"
$env:GMAIL_APP_PASSWORD = "abcdefghijklmnop"
$env:MAIL_FROM = "your-email@gmail.com"
```

## Step 4: Connect Firebase Admin

Create a Firebase service account key:
1. Open Firebase Console > Project Settings > Service Accounts
2. Generate a new private key
3. Store the JSON securely

For GitHub Actions, add the full JSON as a repository secret named `FIREBASE_SERVICE_ACCOUNT`.

## Step 5: Run the Scheduler Locally

From the backend folder:

```powershell
cd c:\Users\IbrahimAhmed Qureshi\Projects\todo\backend
npm install
npm run send-reminders
```

This runs the reminder script immediately and sends Gmail notifications for due tasks.

## Step 6: Use the GitHub Actions Scheduler

The workflow file is at `.github/workflows/send-reminders.yml`.
It runs every 15 minutes by default and sends emails automatically.

### Required GitHub secrets
- `FIREBASE_SERVICE_ACCOUNT`
- `MAIL_PROVIDER` = `gmail`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `MAIL_FROM` (optional, defaults to `GMAIL_USER`)

## Testing Reminder Emails
1. Sign in to the app
2. Create a task with:
   - a Gmail account
   - a due date in the near future
   - `notify` set to `0` or a pre-alert value
3. Save the task
4. Let the scheduler run or execute `npm run send-reminders`

The backend will send an email with the task title, description, and scheduled time.

## Troubleshooting
- Check GitHub Action logs for any scheduler errors
- Verify `GMAIL_APP_PASSWORD` is correct and 2FA is enabled
- Confirm `FIREBASE_SERVICE_ACCOUNT` JSON is valid
- Make sure each `users/{uid}` document includes a valid `email` field

## Future Provider Support
This architecture is modular. You can later add providers such as SendGrid by extending `backend/mailService.js`.
