# NetChat chat-menu repair and upgrade

## MUST DO: deploy the Firestore rules
`firestore.rules` changed (also copied to `firestore.rules.proposed`). Deploy it, for example
`firebase deploy --only firestore:rules`, or paste it into Firebase Console > Firestore > Rules.
Without it, personal/mutual disappearing messages cannot be saved (the app shows a clear error, never a fake success).

## What was wrong / what changed
- Members button: `blockPanel()` re-showed every header button, including Members, after each block check. Fixed, plus CSS `[hidden]` guard.
- View contact: had no click handler. Now opens the same profile card used for group members (group chats open Group info).
- Mute: live chat state now feeds the notification sound check; menu text toggles Mute/Unmute; options 1 hour, 8 hours, 1 week, Always; per user only.
- Disappearing messages: per-user `disappearingBy.<uid>` (personal), `disappearingRequest` (pending/accepted/rejected/cancelled), `disappearingSeconds` (mutual, only set when the other person accepts). Timer is based on each message timestamp. Chats are never blocked by a pending or rejected request. Groups: personal timer for anyone, group-wide timer for admins only.
- Clear chat: confirm dialog, fade animation, per-user `clearedFor` marker, instant re-render, unread reset.
- Export: HTML (readable page) or ZIP, real downloadable file, only messages the user can see.
- Shortcut: install prompt when the browser offers it, else exact instructions; the address bar points at the chat (`?chat=<id>`) and links open that chat.
- Add to list: lists stored in `user/<uid>/chatLists`, toggle/create, no duplicates, instant UI.
- Report: private and group, reason + details, saved to `reports`, duplicate guard, honest error on failure.
- Themes: existing 16 kept; 45 new themes in 9 categories, 18 with photo backgrounds (mobile-sized, dark overlay, CSS fallback scene).
- Cache busting bumped to `?v=20261111a`.

## Known limits
- Expired mutual messages are hidden for both people (and stay hidden after refresh) but their documents are not physically deleted; that needs a Cloud Function (TTL policy on `expiresAt` works too).
- Photo theme URLs are Unsplash links. If one ever 404s, the CSS scene under it is shown. Edit the ids in the `ALL_THEMES` list in `chat-menu.js`.
- Browsers cannot create a home-screen icon silently; the app uses the install prompt or tells the user the exact steps.
