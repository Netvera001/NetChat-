# NetChat integrated repair

This package repairs the supplied NetChat application in place. It preserves the vanilla JavaScript architecture, Firebase modular SDK, existing Firebase client configuration, Cloudinary upload flow, dark/neon visual system, and the single existing expandable composer.

**Entry point:** `index.html`  
**Authentication entry point:** `auth.html`  
**No build step or new application dependency is required.**

## Important release status

The source-level repairs, syntax checks, local asset checks, and isolated stubbed browser interaction checks described below were completed. The final Firestore rules revision could not be compiled in this environment because Firebase CLI/emulator tooling was unavailable. The real Firebase project, Cloudinary account, deployed rules, two-device message delivery, and real WebRTC calls were **not** live-tested. Do not treat this package as production-verified until the rules compile and the manual matrix has been run with test accounts and non-production data.

The included security rules are proposed replacement rules. They must be reviewed and deployed separately; changing client files does not enforce permissions.

## What was repaired

- One canonical conversation-opening path for chat-list entries, user search, group members, and community chats.
- Deterministic direct-chat IDs and parent-first initialization for a new private conversation.
- Optimistic pending messages, immediate rendering, failed-draft retry, listener cleanup, and sensible scroll preservation.
- Group sender profiles, real member/online counts, live group typing, responsive group header, and a working Members panel.
- Persisted group info, stored admin roles, member management, admin-only messaging, and client permission states backed by proposed Firestore rules.
- Group/community use of the existing `#messageInput`; no second composer was added.
- Gallery, camera, document, audio, voice-note, emoji, and poll composer flows with Cloudinary metadata and upload progress.
- Live poll voting and custom voice-note playback controls.
- Per-user archive, restore, mute, pin, read/unread, delete-for-me, swipe, long-press, and context-menu actions.
- Returning-user login, password reset, real settings persistence, honest storage metadata, avatar fallbacks, and loading/busy states.
- Two-party voice/video call repairs, including microphone-only voice calls and ICE restart handling.
- Honest security wording: the app no longer claims end-to-end encryption that the supplied architecture does not provide.
- Bottom navigation now routes Communities and Calls to their real feature screens.

## Files

### Complete replacement files changed from the supplied project

- `index.html`
- `script.js`
- `menu.js`
- `netchat-upgrades.js`
- `netchat-upgrades.css`
- `auth.html`
- `auth.js`
- `auth.css`
- `firestore.rules`

### New files

- `database.rules.json` — proposed Realtime Database presence/typing rules.
- `firebase.json` — points Firebase CLI at both rules files; it contains no hosting configuration.
- `default-avatar.png` — local image fallback; this asset was referenced but absent from the upload.
- `css/material-icons.css` — compatibility entry for the referenced local stylesheet; Material Symbols remain loaded by the HTML.
- `README.md` — this guide.

### Included unchanged supporting files

- `style.css`
- `voice-note-fix.css`

### Removed from the deliverable

- `group.html` was an unreferenced, hard-coded visual demonstration. It was not the application's Firebase group screen and has been removed so sample members/messages cannot be mistaken for live data.

## Setup

1. **Back up first.** Copy the entire existing project and export/download the current Firestore and Realtime Database rules. Back up Firebase data using the project's normal export process. Also retain the current hosting/version snapshot so rollback does not depend on this ZIP.
2. Extract this package into a separate working copy, preserving all paths.
3. Compare the Firebase client configuration in `script.js` and `auth.js` with the deployed project before replacing files. The supplied configuration was intentionally preserved.
4. Serve the directory over HTTP or HTTPS; do not open it with `file://`. For a local static check, run:
   ```sh
   python3 -m http.server 8080
   ```
   Then open `http://localhost:8080/auth.html`.
5. Use HTTPS or localhost for camera, microphone, voice recording, and WebRTC permissions.
6. Deploy the rules only after reviewing the existing schema and completing a backup. Test with disposable accounts before a production rollout.

No npm install or bundling is needed for the application itself.

## Cloudinary requirements

The existing Cloudinary account and presets are preserved:

- Cloud name: `haludoui`
- Profile preset: `My_NetChat_profile`
- Chat and fallback preset: `My_NetChat_chat`

Verify in Cloudinary that unsigned uploads are permitted for the intended presets and that the presets allow the required resource types:

- Images use `image/upload`.
- Video and audio use `video/upload`.
- Generic documents use `raw/upload`.

Client limits are 5 MB for profile/group images, 10 MB for chat images, and 25 MB for video, audio, and documents. Cloudinary account/preset restrictions may be stricter. A failed upload is shown as an error; it is not reported as a successful message. Cloudinary media deletion/lifecycle management is not added by this repair.

## Firebase rules deployment

Review `firestore.rules` and `database.rules.json` against the live project. If the existing Realtime Database contains other paths, merge those existing rules instead of blindly replacing them.

With Firebase CLI installed and authenticated:

```sh
firebase login
firebase use --add
firebase deploy --only firestore:rules
firebase deploy --only database
```

Select the existing NetChat project when prompted. `firebase.json` contains only the rules mappings. To deploy both in one reviewed release:

```sh
firebase deploy --only firestore:rules,database
```

The Firestore rules cover participants, stored group roles, admin-only message creation, group info/member updates, per-user state, polls, communities, contact requests, and two-party call signaling. They do not trust a browser-supplied role string.

**Realtime Database limitation:** its rules cannot directly query Firestore chat membership. The supplied RTDB rules therefore allow authenticated presence/typing reads and restrict writes to the authenticated user's own UID. They are not a substitute for private per-conversation authorization. Stronger typing/presence read isolation requires a trusted backend, custom claims, duplicated membership data with a careful security model, or moving those signals to an appropriately ruled Firestore schema.

Ensure any indexes required by existing chat/community queries remain deployed. If Firebase returns an index-required error, review and create the exact index through the provided Firebase error link; do not weaken rules to bypass it.

## Data compatibility and rollback

This repair uses additive fields and per-user documents; it does not include a destructive migration. Existing collection names and the supplied Firebase project ID are preserved. Older clients may not understand new poll/group-permission fields, so coordinate client and rules rollout.

To roll back:

1. Restore the complete original source snapshot.
2. Redeploy the previously saved Firestore and Realtime Database rules.
3. Keep backups of data created during the repaired version. Additive fields can normally remain harmlessly, but older code must be checked before reuse.
4. Do not delete Cloudinary assets or Firestore documents as part of a source rollback.
5. If a group parent document was deleted, its old messages cannot be made readable merely by rolling back client code; restore from backup if required.

Group deletion is not a complete backend cleanup operation. Orphaned message subcollections and Cloudinary objects may remain and require an authorized administrative cleanup process.

## Architecture limits and unimplemented items

- **True multi-party group calls are not implemented.** The supplied signaling is two-party. Group call controls explain this instead of displaying a fake group call. A real group call requires multi-peer topology or an SFU, per-participant signaling, participant lifecycle, and two-device/multi-device testing.
- **Join approval and public invite-link infrastructure were not added.** Existing public/private communities and UID invitations are retained.
- **Important-message pinning inside a group was not added.** Per-user chat pinning is implemented.
- **No new push-notification/service-worker backend was added.** Existing notification surfaces and configurable in-app sound cues are used.
- **Automatic server-side deletion of group subcollections and Cloudinary media is not implemented.** It requires trusted administrative credentials and must not be performed with client-wide authority.
- Device-local preferences remain in this browser's local storage; they do not sync across devices and disappear if site data is cleared. Account/privacy data uses Firestore.

## Verification actually performed

- `node --check` passed for `script.js`, `menu.js`, `auth.js`, and `netchat-upgrades.js`.
- HTML parsing found no duplicate IDs or missing referenced local assets. `index.html` contains exactly one `#messageInput`.
- `database.rules.json` and `firebase.json` parse as JSON. CSS brace counts are balanced.
- The final isolated Playwright run passed **36 of 36 checks** against local fixture data, intercepted Firebase callbacks, a fake microphone, and a mocked Cloudinary response. It covered group sender names/avatars, real fixture member/online counts, date and system messages, audio/document/poll rendering, poll-vote payloads, Group Info, member search, admin-setting writes, member-role writes, group-photo removal, Escape behavior, microphone/send switching, six attachment choices, recording cancellation without a send, voice-note send payloads, typing, admin-only composer restriction/restoration, private-chat switching with the same composer, and horizontal overflow at 320, 375, 390, and 1280 px.
- That final run produced no uncaught page errors, console errors, or local asset HTTP errors. Mobile and desktop group chat, Group Info, typing, and attachment-sheet captures were visually inspected. Group Info scroll restoration was corrected and the full suite was rerun successfully.
- The updated `firestore.rules` was **not compiled in the final pass**: an attempt to install isolated Firebase CLI tooling timed out. No rules were deployed and no authorization behavior suite was run.

The stubs verify DOM behavior and write/upload payloads only. They do not prove live Firestore writes, Cloudinary uploads, cross-client synchronization, security authorization, real microphone/camera hardware behavior, or WebRTC calls.

## Manual release test matrix

Unless a row explicitly says “Checked locally,” the implementation is **not live-tested**. Run these checks against test data after rules deployment.

| Area | Required live test | Status in this package |
|---|---|---|
| Returning user | Sign in with valid/invalid credentials; send reset email; verify recovery email | UI checked locally; Firebase not live-tested |
| New private chat from search | Search a second test user, open Message, send “Hi”; confirm immediate pending/ready bubble without reopening | Implemented; not live-tested |
| Existing private-chat reuse | Open the same member from search, chat list, and group member sheet; confirm one canonical conversation and no duplicates | Implemented; not live-tested |
| Private receive/retry | Receive on a second device; go offline during send; confirm failed draft remains and Retry works | Implemented; not live-tested |
| Listener cleanup | Switch repeatedly among private/group/community chats; confirm no cross-chat messages or duplicate listeners | Implemented; not live-tested |
| Group creation | Create with/without photo; double-click Create; verify one group, progress, and restored button after failure | Implemented; not live-tested |
| Group delivery | Send text/reply/media from two members; confirm sender names, avatars, timestamps, previews, unread counts, and receipts | Implemented; not live-tested |
| Member profile actions | Open avatar/name; view profile, request contact, message privately, and start two-party calls | Implemented; not live-tested |
| Group info/roles | Edit name/description/photo; promote/demote; remove member; leave/delete with confirmation; verify last-admin/owner protection | Implemented; rules updated; compilation pending; behavior not live-tested |
| Admin-only messages | Enable as admin; verify ordinary member composer/attachments disable in real time and direct unauthorized writes are denied | Implemented; rules updated; compilation pending; authorization not live-tested |
| Member permissions | Test member add/edit-info toggles as owner, admin, ordinary member, and nonmember | Implemented; rules updated; compilation pending; authorization not live-tested |
| Polls | Create 2–8 options; vote from two users; test single/multiple selection, closing time, and live tallies | Payload checked locally; backend/voting not live-tested |
| Gallery/camera/document/audio | Upload each supported type; verify progress, secure URL, metadata, immediate rendering, failure, and retry | UI entry points checked locally; Cloudinary not live-tested |
| Voice notes | Record, cancel, stop at two-minute cap, upload, play/pause, seek/progress, and change speed | Recording/payload checked locally; upload/playback not live-tested |
| Typing/presence/privacy | Verify real names/counts, six-second typing expiry, mute/privacy behavior, and own-UID RTDB writes | Implemented; not live-tested |
| Sounds | Toggle sent/received/typing/call cues; verify autoplay restrictions, throttling, mute, and persistence after reload | Implemented; not live-tested |
| Archive/gestures | Archive by swipe and long-press; restore; verify ordinary scroll/open still work and archive is per-user | Implemented; not live-tested |
| Chat actions | Mute, pin, mark read/unread, delete for me, clear, and confirm destructive dialogs | Implemented; not live-tested |
| Communities | Create/join/invite/accept/decline; create a community group; open its chat; test unread counts and member permissions | Implemented; not live-tested |
| Calls | Complete two-party voice and video calls; deny permissions; test answer/reject/hang-up/ICE failure/stale calls | Implemented; not live-tested |
| Avatar/offline fallback | Test missing, broken, and temporarily unreachable photos; confirm no repeated broken-image loop and valid photos return | Implemented; fallback logic checked locally; offline backend not live-tested |
| Settings persistence | Change profile/privacy/theme/accent/font/wallpaper/media/sound options; reload and verify correct local/Firestore persistence | Implemented; not live-tested |
| Mobile alignment | Repeat at 320/360/375/390 px and with browser keyboard; verify last message, safe areas, touch targets, and no overflow | 320/375/390 px and desktop overflow checked locally; real keyboard/device testing remains |
| Rules negative tests | Attempt nonmember reads/writes, ordinary-member admin changes, forged admin arrays, another user's poll vote, and non-admin posts in admin-only mode | Rules updated; compilation and authorization behavior not live-tested |

## Recommended rollout order

1. Deploy to a separate Firebase test project or a disposable test dataset.
2. Run security negative tests before inviting users.
3. Run two-account/two-device messaging and permission tests.
4. Verify every Cloudinary resource type and failure path.
5. Test real voice/video calls on HTTPS.
6. Back up production, deploy rules and clients together, monitor permission-denied errors, and keep the previous source/rules snapshot ready for rollback.


## Emoji, GIF and sticker picker configuration

The updated picker reuses the single `#messageInput` and existing `netChatSetComposerMedia` attachment-preview pipeline. It loads the searchable emoji database from `emoji-picker-element` (CDN) once per open picker, queries Tenor through a Netlify Function, and stores personal stickers locally with an account-scoped Firestore copy when signed in.

Add these server-side Netlify environment variables to enable the optional services (never put the values in frontend code):

- `TENOR_API_KEY` — enables GIF search at `/.netlify/functions/gifs`.
- `REMOVE_BG_API_KEY` — enables automatic background removal through remove.bg at `/.netlify/functions/sticker-background`.

Without `REMOVE_BG_API_KEY`, the sticker creator explicitly reports that automatic removal is unavailable and keeps the manual square crop/text/outline editor usable. Without `TENOR_API_KEY`, local GIF selection remains available and GIF search shows a configuration message. Personal sticker cloud sync requires the signed-in user's Firestore rules to include the owner-only `/user/{userId}/stickers/{stickerId}` rule supplied in `firestore.rules`; review and deploy the rules separately.

The GIF provider and background-removal endpoints require a deployed Netlify Functions environment. Test them with non-production keys and sample images before release.
