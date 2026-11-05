# Clippardy emoji picker update

## What changed
- Replaced the four small hard-coded fallback emoji groups with a retryable load-error state.
- Uses `emoji-picker-element` from jsDelivr to provide the full Unicode emoji catalogue, category navigation, search, and scrolling.
- Increased the picker board's usable height and improved its header, spacing, and touch targets.
- Keeps the existing single composer docked directly above the picker with side insets and rounded styling.
- Preserves cursor-position insertion and keeps the phone keyboard closed while browsing.

## Network requirement
The full emoji catalogue is loaded from `https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js`. The app needs internet access and a WebView/browser that permits ES module imports from jsDelivr. If the CDN is blocked, the picker displays a retry action rather than pretending a tiny hard-coded sample is the full emoji set.

## Verification
JavaScript syntax and ZIP integrity were checked. This environment cannot verify rendering inside the user's Android WebView or connectivity to the user's deployment/CDN.
