# NetChat repair package

This package was reviewed for JavaScript syntax errors, Firebase initialization resilience,
chat/group/community wiring, and deployment files.

## Important

The browser code can be repaired locally, but no code-only change can guarantee a live
Firebase project is correctly configured or that Firestore rules have been deployed.
The supplied `firestore.rules` must be deployed to the Firebase project used by the app.

## Deploy

From the project directory:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

If Firebase CLI is not installed:

```bash
npm install -g firebase-tools
firebase login
firebase use <YOUR_FIREBASE_PROJECT_ID>
firebase deploy --only firestore:rules,firestore:indexes
```

Do not replace the Firebase configuration in `script.js`/`auth.js` unless your actual
Firebase project uses different credentials.

## What was repaired

- Firestore startup now falls back to normal Firestore when persistent IndexedDB cache
  is unavailable.
- Profile/cache read failure no longer leaves feature modules waiting forever.
- Added runtime error/unhandled-promise logging to make remaining live backend problems
  visible in the browser console.
- Added Firebase deployment configuration and a community composite index.
- Existing group/community/chat code and security rules were retained rather than
  rewriting working features blindly.

## Validation performed

All JavaScript files pass Node syntax checking after the repair.

## Vera backend update

A Netlify Function backend was added under `netlify/functions/vera.js` so Vera can use Gemini without requiring Firebase Cloud Functions/Blaze. Configure `GEMINI_API_KEY` in Netlify environment variables and put the deployed function URL in `vera-config.js`.
