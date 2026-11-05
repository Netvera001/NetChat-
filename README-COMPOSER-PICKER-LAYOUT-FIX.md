# Clippardy composer / emoji picker layout correction

This update corrects the mobile layout shown in the supplied screenshot.

- Reuses the existing `#messageInput` and `.chat-input-bar` only; no second composer is created.
- While the emoji picker is open, the existing composer is docked immediately above the picker.
- The picker is docked to the bottom edge and uses a responsive height based on the visible viewport.
- Closing the picker restores the composer's original inline style.
- Tapping the existing message textarea closes the picker; the textarea can then receive focus normally.
- The emoji insertion point is preserved, and multiple emoji selections do not close the picker.

The update does not add Firebase services or change Firestore / Storage rules.

## Verification

`emoji-picker-bridge.js` passes `node --check`. ZIP integrity should be checked after packaging. A real-device browser test is still required to confirm behavior on the target Android WebView/browser.
