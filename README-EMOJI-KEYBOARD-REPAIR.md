# Clippardy Emoji Keyboard Layout Repair

This patch is based on the original uploaded project archive. It adds a standalone emoji-picker bridge and keyboard-style layout without changing Firebase configuration or security rules. The existing `#messageInput` and `#emojiBtn` are reused.

The emoji catalogue, category navigation, recents and search are provided by `emoji-picker-element` loaded from jsDelivr. An internet connection is required. The GIF and Stickers tabs are visibly disabled because this source project does not contain a configured GIF provider or sticker library; they are not presented as working features.

Validation performed: JavaScript syntax check, ZIP integrity, presence of exactly one `#messageInput`, and preservation of original Firebase rule files. Device/WebView visual testing has not been performed.
