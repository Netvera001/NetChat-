# NetChat local repair handoff

## Scope and preservation
This repair is based on the uploaded NetChat project, not a replacement application. The original uploaded ZIP remains unchanged and is the rollback copy. No GitHub push, Netlify deployment, Firebase deployment, or production data operation was performed.

## Changes made in this handoff
- Fixed the concrete `c.f.deleteDoc is not a function` cause: `script.js` exposed a restricted `window.NX.fns` bridge that omitted `deleteDoc`, while `chat-menu.js` preferred that bridge over importing the Firestore module. The bridge now exposes `deleteDoc` and `onSnapshot`; the fallback Firestore import now matches the application's Firebase JS SDK version (12.19.0).
- Added block-state preflight before the conversation view is revealed, made message rendering respect an active blocked panel, and added realtime listeners for both participants' deterministic block documents. Firestore rules already reject direct-message writes and call creation/updates when either participant has blocked the other.
- Added structured report reason choices plus optional explanatory text; retained report-only, report-and-block, and report/block/delete flows.
- Added more visibly distinct per-chat theme choices, a `None` theme, image preview before upload, and explicit no-repeat/center/cover rendering for wallpaper images.
- Added 90-day disappearing-message duration, a shared system notice when the timer changes, and the matching Firestore rule allowlist entry. Existing messages retain their previous expiry values; only newly sent messages receive an expiry based on the active timer.
- Made the existing per-user `clearedFor` marker effective in message rendering, so clearing a chat hides messages at or before the clear timestamp for that user without deleting the other participant's copy.
- Existing archive/list/export/media/search actions were preserved. The chat menu's existing search reads the conversation's full messages subcollection and displays matching results.

## Verified project facts
- Main app uses Firebase JavaScript SDK 12.19.0 modular imports in `script.js`.
- `script.js` initializes Firebase Auth, Firestore and Realtime Database.
- `chat-menu.js` is a classic script loaded after the module scripts in `index.html`; it uses the `window.NX` bridge established by `script.js` at runtime.
- Project already contains `firestore.rules` and `firestore.indexes.json`.
- The current custom wallpaper upload implementation uses Cloudinary (`api.cloudinary.com`), not Firebase Storage. This repair preserves the configured Cloudinary integration rather than silently switching providers or inventing Firebase Storage paths/rules.
- `firebase.json` references a Firebase Functions source directory named `functions`, while the uploaded project has `netlify/functions` and no `functions/` directory. No Firebase Cloud Functions cleanup/TTL backend was fabricated.
- No Firebase Storage rules or storage bucket configuration were present in the supplied project.

## Validation performed
- All 13 `.js` and `.mjs` files pass `node --check`.
- ZIP archive integrity is checked after packaging.
- This environment does not have the user's Firebase credentials, staging project, two test accounts, browser session, or network access to the user's configured Cloudinary service. Therefore no live Firestore/Storage/Realtime Database, calling, upload, or two-account integration test is claimed.

## Important remaining integration work / limitations
1. Run the project locally with the existing Firebase project configured, preferably against a Firebase Emulator or staging project. Test the two-account block/unblock and call/message rejection flows before deploying the revised rules.
2. The app's media uploads and custom chat wallpapers currently use Cloudinary, not Firebase Storage. Storage rules cannot be meaningfully authored without the intended Firebase Storage bucket/path schema and migration plan.
3. Disappearing messages are hidden client-side after their `expiresAt` time. The project has no trusted scheduled cleanup/TTL backend in the uploaded source. A trusted backend cleanup job is still required to guarantee server-side deletion and prevent direct reads of expired documents.
4. User profile documents are broadly readable to authenticated users under the existing schema. Full profile/online/last-seen concealment for a blocked viewer requires a profile data split or trusted privacy projection; changing the broad profile rule blindly could break contact search, group membership, and existing profile consumers.
5. Global theme inheritance and complete cross-device theme gallery persistence are not fully consolidated with the existing `CHAT_THEMES` store. The added theme gallery continues the existing per-conversation preference design.
6. The existing message search is client-side over the Firestore conversation message collection, not a dedicated full-text index. It can search older documents when Firestore permits the full collection read, but large conversations may hit read-volume/performance limits.
7. ZIP export currently depends on browser CORS access to attachment hosts; unavailable attachments may remain as URLs in the media index rather than embedded files.
8. The existing add-to-list action supports creating a list and adding a chat. Full list management (rename/remove/delete/view) is not yet a dedicated interface.
9. Group-specific permissions and disappearing-message settings remain governed by the existing group rules and should be exercised with real group-admin/member accounts.

## Local verification checklist
- Install/use the project as documented in `README.md`; serve it on localhost (ES modules and service workers require an HTTP origin).
- Open DevTools Console and Network tabs; check for Firestore `permission-denied`, failed Cloudinary requests, and stale SDK/cache errors.
- With two staging/emulator users, verify block persistence after refresh/re-login, reverse-block notice, rejected message/call writes, unblock, and per-user chat deletion.
- Verify clear-for-self after refresh; check that the other account still sees its history.
- Verify 24-hour, 7-day, 90-day and Off notices and that pre-existing messages do not receive new expiry values.
- Verify image preview, upload, one-cover-image rendering, theme isolation, search, media filters, ZIP export and chat lists.
