# NetChat repair package notes

This archive retains the full project structure and existing Firebase configuration/rules. The targeted changes are in:

- `emoji-picker-bridge.js`: pinned emoji library/data source; reliable GIF/sticker handoff to the existing composer; composer is temporarily reparented for reliable mobile fixed positioning and restored on close.
- `netchat-upgrades.css`: Android-friendly media file controls and picker status styling.
- `script.js`: Firestore-safe broadcast delivery updates.
- `README-EMOJI-KEYBOARD-REPAIR.md` and `README-EMOJI-GIF-STICKER-FIX.md`: current behavior and limitations.

## Deployment

1. Back up the currently deployed NetChat folder.
2. Replace the project files with the contents of this archive, preserving the directory structure.
3. Deploy the full folder (not only the changed JavaScript file).
4. Hard-refresh the app or clear the site's cached files on the Android device.
5. Test emoji search/categories, choose a GIF, add and select a sticker, and send each in a private chat. Then test broadcast delivery with two test accounts.

## Important

- Full emoji search needs internet access to jsDelivr.
- GIFs are selected from the device; no online GIF search provider is configured.
- Personal stickers are stored locally on that device/browser and do not sync to other devices.
- Firebase and Cloudinary live operations cannot be verified from static project files alone. Test with your own deployed credentials before production use.
