# NetChat settings refresh

This pass improves the existing settings implementation without replacing the app's Firebase architecture.

## Changes
- Storage Usage now shows a media breakdown by image, video, audio and other attachment metadata, including known byte totals and unknown-size counts.
- Added an honest note that attachment metadata is not a measurement of device free space and does not delete cloud files.
- Added Help Center content and support/report forms that prepare an email for the user to review and send.
- Improved local preference application for notification toggles, font size, vibration, auto-download and data mode through persisted settings and document-level preference attributes.
- Cache clearing now reports how many Cache Storage entries were removed.

## Important validation still required
- Test all settings while signed in with real Firebase accounts and production Firestore/Realtime Database rules.
- Confirm the existing archived-chat implementation end-to-end. This pass deliberately does not rewrite archive routing or message subscriptions without verifying the app's canonical chat-list renderer and archive schema.
- Auto-download/data-saver settings are persisted and exposed as document-level preferences; the existing media upload/download pipeline must read those preferences before they can enforce network transfer policy.
- Storage reporting depends on `media` attachment metadata (`bytes`, `mimeType`/`type`) in each chat's `messages` subcollection. It does not estimate missing sizes or delete remote media.
- Support opens the device's configured email application; no support email address is fabricated.
