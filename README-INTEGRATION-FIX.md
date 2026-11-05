# NetChat group-suite integration fix

## What this package changes

- `index.html`: loads `group-suite.css` and `group-suite.js`, which existed in the uploaded project but were not referenced by the supplied HTML.
- `group-suite.js`: listens for the `netchat:group-open` and `netchat:private-open` events already emitted by `script.js`; sets/clears group styling and passes the active conversation into the suite state.
- `script.js`: passes Firestore message snapshots to the suite's message-notification hook so the suite can track new incoming messages and play its configured receive cue.
- `netchat-upgrades.js`: included as the newest uploaded version (54 KB) to match the uploaded `script.js` revision.
- `group-suite.css`: included because `index.html` now loads it.

## Installation

1. Back up the current local project folder.
2. Copy the files in this package over the matching files in the NetChat project folder.
3. Keep your existing `auth.html`, `auth.js`, `auth.css`, `menu.js`, `style.css`, `voice-note-fix.css`, Firebase configuration, and Cloudinary configuration.
4. Reload the local app with a hard refresh, then sign in and open a group and a private chat.

## Static checks performed

- `node --check` passed for `script.js`, `group-suite.js`, and `netchat-upgrades.js`.
- The updated `index.html` parsed successfully with Python's HTML parser.

## Important limitations

This is an integration repair, not a claim that every NetChat feature is fixed. It has not been live-tested against the user's Firebase project or on two signed-in devices. It does not change Firestore rules or data, and it does not independently verify message delivery, community permissions, group creation, calls, or Cloudinary upload presets. Test these before deploying to production.

## Quick verification checklist

- Open a private chat, then a group chat; confirm the group theme and member count are applied only to groups.
- Send a text message in a group and confirm it appears once and reaches a second member's device.
- Receive a new message after the initial message snapshot; check that the receive sound plays unless sounds/chat notifications are muted.
- Type a message and confirm the existing send button sends it; clear the input and confirm the microphone button starts recording.
- Open group info, change a permitted setting, and confirm the UI reflects the saved value after reload.
- Test all group actions using a non-owner member as well as the owner; client-side UI restrictions must also be enforced by Firestore rules.
