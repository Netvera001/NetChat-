# NetChat email verification and account recovery fixes

## What changed
- Registration saves a minimal pending profile locally before requesting a verification email, so a mail/network failure does not lose the new Firebase Authentication account's profile details on that device.
- The Auth user's display name and profile photo URL are also updated as a fallback, allowing profile creation after verification on another device when Auth metadata was successfully saved.
- Firestore profile documents are still created only after Firebase reports `emailVerified === true`.
- Existing email registration errors now explain that the email is already registered and direct the user to log in, verify/resend, or use Forgot password.
- Network, invalid email, weak password, wrong credentials, rate limit, and email quota errors have clearer messages.
- Resend verification re-authenticates the account owner, reloads the Auth user, sends a fresh verification message, and reports success/failure.
- Forgot password sends the Firebase reset email with a NetChat continuation URL. The Firebase Authentication email template's custom Action URL must point to the deployed `reset-password.html` handler.
- The shared reset page handles both `resetPassword` and `verifyEmail` action codes.
- Avatar upload shows an in-avatar spinner and a status message: blue while uploading, green on success, red on failure. Toasts now distinguish success and error colors.

## Firebase Console setup required
1. Authentication -> Settings -> Authorized domains: add `netvera001.github.io` if it is not already present.
2. Authentication -> Templates -> Password reset -> Customize action URL: set
   `https://netvera001.github.io/NetChat-/reset-password.html`
3. Authentication -> Templates -> Email address verification: use the same custom Action URL if the UI exposes a separate per-template action URL. If the project uses the shared Action URL dialog, the same reset-password page handles both verification and reset action codes.
4. Save the email templates. Sender name should be `NetChat`.
5. Confirm Email/Password is enabled under Authentication -> Sign-in method.
6. Deploy the updated project files to GitHub Pages.

## Test plan
1. Register with an email address you control. Confirm a verification email arrives.
2. Before verifying, attempt to log in. NetChat must deny access and show the resend option.
3. Tap Resend verification with the same email and password. Confirm a fresh email arrives.
4. Open the newest verification email. It should open `reset-password.html` and show a successful verification state.
5. Log in. NetChat should create the Firestore `user/{uid}` profile after verification, then open the chat app.
6. Try registering the same email again. It should say the email is already registered and offer login/recovery guidance.
7. Use Forgot password. Confirm the email arrives and opens the branded reset page with a new-password form.
8. Test an invalid email, wrong password, disabled network, and profile upload failure to confirm the messages are specific.

## Data behavior
Unverified users exist in Firebase Authentication because Firebase needs an account to send and validate the verification link. This is expected. Their NetChat Firestore profile is not created until they verify and successfully sign in. The minimal pending profile is kept in browser localStorage on the registration device and Auth displayName/photoURL are used as a fallback. Do not store passwords or verification codes in Firestore or localStorage.
