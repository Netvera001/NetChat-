# NetChat privacy-status / authentication fix

## What was changed

- `chat-menu.js` now checks the authenticated Firebase user exposed by the main app (`window.netChatAuthUser` / `window.netChatAuth.currentUser`) before legacy aliases.
- The active conversation ID is obtained from `window.netChatGetActiveConversation()` and the chat screen's `data-conversation-id` attribute before older fallback globals.
- A privacy refresh during startup when no conversation is open now returns `no-chat` without replacing the messages area with the privacy-unavailable panel.
- Removed the unconditional DOM-ready privacy refresh and guarded the delayed refresh so it only runs for an active conversation.
- Block-state checks remain in place; the change does not bypass block checks or alter Firestore security rules.

## Install

1. Back up the current project/repository.
2. Extract this ZIP.
3. Replace the project files with these files (or at minimum replace `chat-menu.js` and `script.js`).
4. Commit and deploy using your existing hosting workflow.
5. On the device/browser, refresh NetChat fully. If an old service worker is serving cached files, update/reload the installed web app.

## Note

This ZIP contains the project files provided in the uploaded archive plus the targeted repair. Firebase behavior still depends on the deployed Firebase configuration and Firestore rules. Test with two accounts: an unblocked conversation, a conversation blocked by the current user, and a conversation blocked by the other user.
