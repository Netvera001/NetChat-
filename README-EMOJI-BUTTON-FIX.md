# Clippardy emoji button reliability fix

## What changed
- Added `emoji-picker-bridge.js`, a standalone click handler with no Firebase imports. The emoji trigger therefore remains available if a Firebase-dependent enhancement module fails to initialize.
- The handler captures taps on the existing `#emojiBtn`, opens the picker below the existing composer, and keeps the phone keyboard hidden while the picker is open.
- Tapping the existing message input closes the picker so the normal keyboard can appear.
- The bridge loads `emoji-picker-element` lazily and shows a built-in emoji grid if the external library cannot load.
- Removed the old direct emoji-button listener from `netchat-upgrades.js` to prevent duplicate picker instances.
- Added touch target and picker fallback styling. No second message input or messaging architecture was added.

## Validation
- `node --check emoji-picker-bridge.js` passed.
- `node --check netchat-upgrades.js` passed.
- ZIP integrity was checked after packaging.

## Notes
The full searchable emoji library still depends on access to jsDelivr. If that network request fails, the built-in fallback remains usable. This update does not claim to complete the broader sticker studio features.
