# NetChat branded password reset page

This package adds a NetChat-branded password reset handler at `reset-password.html`.
It verifies Firebase's one-time `oobCode`, lets the account owner enter and confirm a
new password, and calls Firebase Authentication's `confirmPasswordReset`. Invalid,
expired, or previously used links show a clear recovery message.

## Required Firebase Console setup (one-time)

The website code cannot change Firebase's email sender identity or email template.
After deploying these files to the same NetChat website origin:

1. Open Firebase Console and select project `example-48a2b`.
2. Go to **Authentication → Templates → Password reset**.
3. Set the sender display name to **NetChat** (if the template editor offers it),
   and use the subject **Reset your NetChat password**.
4. Customize the email message with NetChat wording while preserving Firebase's
   supplied password-reset action link placeholder.
5. In the password-reset template's **Customize action URL** setting, set the
   action handler URL to `https://YOUR-NETCHAT-DOMAIN/reset-password.html`.
   Replace `YOUR-NETCHAT-DOMAIN` with the actual deployed domain; do not include
   a guessed domain.
6. In **Authentication → Settings → Authorized domains**, confirm that the exact
   NetChat hosting domain is listed. Add it if needed.
7. Save, then request a fresh reset email and test the new link. Old links sent
   before this change may still open Firebase's default handler.

## Notes

- The custom page uses the same Firebase web configuration already present in
  `auth.js` and the Firebase JS SDK version 12.19.0.
- The reset code is read from Firebase's `mode` and `oobCode` URL parameters;
  it is never written to Firestore or local storage by this page.
- The post-reset return link is `auth.html#login`.
- Firebase Console sender/template branding and the action URL must be configured
  by a project owner. This ZIP cannot perform those cloud-console changes.
- Test with a newly generated email. Firebase reset links are one-time and expire.
