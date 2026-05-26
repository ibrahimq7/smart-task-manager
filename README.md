# Smart Todo — Enterprise Task Management

Smart Todo is a modern, responsive enterprise-style task management platform. It delivers polished dashboards, Gmail-based reminders, Firestore task storage, and a free scheduler for automated email notifications.

**Author:** Ibrahim Ahmed Qureshi

**Status:** UI redesign complete. Free backend scheduler implemented with Gmail SMTP and GitHub Actions.

## Features
- Responsive dashboard with collapsible sidebar and polished enterprise UI
- Task categories: Ongoing, Pending, Completed, Reports, Community, and more
- Priority labels: Low / Medium / High / Critical
- Drag-and-drop task reordering and Eisenhower matrix support
- Task reminders with Gmail notifications at scheduled time or pre-alert time
- Real-time Firestore sync for tasks and sections
- Free scheduler using GitHub Actions, no paid Firebase Functions required
- Authentication via Gmail sign-in with email verification enforcement

## Technologies Used
- Frontend: Vanilla JavaScript, HTML5, CSS3
- Styling: `css/dashboard.css` and existing style assets
- Backend scheduler: Node.js, `firebase-admin`, `nodemailer`
- Storage: Firebase Firestore
- Automation: GitHub Actions scheduled workflow

## Installation

### 1. Frontend setup
1. Open `html/main1.html` in a browser or host it via Firebase Hosting.
2. Ensure Firebase config is set correctly in `js/firebase-config.js`.
3. Use Gmail sign-in or email sign-up to create user accounts.

### 2. Backend scheduler setup (Vercel)

This project supports running the scheduler on Vercel using serverless API routes and the Vercel Cron Jobs feature.

1. Install dependencies locally (optional):
```powershell
cd c:\Users\IbrahimAhmed Qureshi\Projects\todo
npm install
```

2. Create a Firebase service account for the backend:
   - Open Firebase Console → Project Settings → Service Accounts
   - Generate a new private key (JSON)

3. Add the following environment variables in your Vercel project settings (Dashboard → Settings → Environment Variables):
   - `FIREBASE_SERVICE_ACCOUNT` — copy the entire JSON content (stringified)
   - `GMAIL_USER` — your Gmail address (sender)
   - `GMAIL_APP_PASSWORD` — the 16-character App Password
   - `MAIL_FROM` — optional (defaults to `GMAIL_USER`)
   - `SCHEDULER_TOKEN` — a strong random token used by the scheduler to authenticate calls to the API endpoint

4. Deploy to Vercel:
   - Connect the repo to Vercel and import the project (Vercel detects `package.json` and `api/` routes)
   - Ensure `vercel.json` is present (included in this repo)

5. Configure Vercel Cron Job:
   - In the Vercel dashboard, go to **Jobs** → **Create Job**
   - Set the schedule to run every minute (cron expression: `* * * * *`)
   - Set the request URL to: `https://<your-deployment>/api/send-reminders`
   - Add the HTTP header: `x-scheduler-token: <your SCHEDULER_TOKEN>`

6. (Optional) Test the API route manually:
```powershell
# Call the test email route with the token
curl -X POST "https://<your-deployment>/api/test-email?to=you@example.com&token=<SCHEDULER_TOKEN>"
```

Vercel will now run the scheduler regularly and send Gmail reminders using the serverless API route. No Firebase Cloud Functions or paid services are required.

## Backend details
The backend scheduler lives in `backend/sendReminders.js`.
It connects to Firestore, finds tasks with:
- `completed == false`
- `notifySent == false`
- `nextNotifyAt <= now`

Then it sends a Gmail notification containing:
- Task title
- Task description
- Scheduled date and time

### Run manually
From the project root:
```powershell
cd backend
npm run send-reminders
```

### GitHub Actions scheduler
A free scheduler has been added at `.github/workflows/send-reminders.yml`.
It runs every 15 minutes and invokes the reminder script automatically.

## Firebase indexes
A Firestore index is needed for the reminder query. The index file is `firestore.indexes.json`.
Deploy it with:
```powershell
firebase deploy --only firestore:indexes
```

## Notes
- No paid Firebase Blaze plan is required.
- No SendGrid or paid email services are required.
- Email notifications use Gmail SMTP via Nodemailer.

## Screenshots
- Add screenshots under `screenshots/` and update this section.

## Future Improvements
- Add real-time chat presence and typing indicators
- Implement role-based access and admin monitoring pages
- Add mobile-specific animations and navigation
- Add calendar sync and AI productivity suggestions

## Author
Ibrahim Ahmed Qureshi
