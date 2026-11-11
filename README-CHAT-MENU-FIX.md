# Chat menu repair

## Changes
- Removed the legacy dropdown click handlers from `script.js`; `chat-menu.js` is now the single owner of menu open/close and submenu navigation.
- The menu opens on the first tap and uses the existing `.chat-dropdown.active` CSS state.
- The active chat ID and signed-in user are resolved from NetChat's runtime globals as well as the bridge.
- Chat actions now validate that a database, signed-in user, chat document, and (for direct chats) peer UID exist before using them.
- Added a guard in presence privacy handling so an auth transition cannot dereference `window.netChatAuthUser.uid` while it is null.

## Validation
- Ran `node --check` against all 12 JavaScript files in this project: all passed.
- Confirmed the old `chatMenuBtn` event-handler block was removed from `script.js`; the click handler is registered only in `chat-menu.js`.
- Live Firebase actions still need to be exercised in your local browser with your actual Firebase project and deployed Firestore rules. This archive does not claim a live backend test.
