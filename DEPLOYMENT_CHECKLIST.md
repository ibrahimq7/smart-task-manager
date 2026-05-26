# Smart Todo Deployment Checklist

## Fix `auth/unauthorized-domain`

This error happens when the current website domain is not allowed for Google sign-in.

In Firebase Console:

1. Open your project: `smart-task-manager-12a2a`
2. Go to Authentication.
3. Open Settings.
4. Open Authorized domains.
5. Add every domain you will use:
   - `localhost`
   - `127.0.0.1`
   - `smart-task-manager-12a2a.firebaseapp.com`
   - `smart-task-manager-12a2a.web.app`
   - Your final custom domain, for example `tasks.yourcompany.com`

For local testing, prefer:

```txt
http://localhost:8000/html/main1.html
```

If you open the app with `127.0.0.1`, that exact domain must also be authorized.

## Authentication Setup

Enable these providers:

- Google
- Email/Password

Keep email verification enabled for email/password accounts.

## Firestore Setup

1. Create a Firestore database.
2. Deploy `firestore.rules`.
3. Confirm these collections work:
   - `users/{uid}`
   - `users/{uid}/tasks`
   - `community/global/messages`

## Customer Launch Requirements

- Add your production domain to authorized domains before launch.
- Use HTTPS only in production.
- Enable App Check before public release.
- Add custom claims for admin and manager roles.
- Add Cloud Functions for immutable audit logs and manager report delivery.
- Add phone verification only with a backend provider that can score risky, disposable, or VoIP numbers.
