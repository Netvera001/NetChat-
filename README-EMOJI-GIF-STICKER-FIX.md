# Clippardy Emoji / GIF / Sticker repair

## Fixed
- Removed the invalid `data-source="unicode"` attribute. The emoji-picker-element component now uses its supported default Unicode data source, which resolves the `unicode: 404` request.
- Emoji picker search/categories are provided by emoji-picker-element. Internet access is required for the CDN module and its default data source.
- GIF tab supports choosing an animated GIF from the device and adding it to the existing chat media composer. Online GIF discovery is not enabled because a provider API key/backend has not been configured.
- Stickers tab supports importing image stickers, saving up to 60 optimized WebP stickers in this browser/device, selecting them into the existing chat media composer, and deleting them. These personal stickers are local to this browser; cloud sync/sharing is not included.
- Existing `#messageInput`, `#emojiBtn`, and `window.netChatSetComposerMedia` are reused. Firebase configuration and security rules are unchanged.

## Notes
The GIF and sticker send actions reuse the existing attachment/message send flow. The selected GIF/sticker appears as media in the composer and must be sent using the existing send button. This patch does not implement a remote GIF search provider or Firebase sticker-pack synchronization.

## Validation
Run `node --check` on all JavaScript files and verify the ZIP archive. Real Android WebView and live Firebase send testing still need to be performed in the target deployment.
