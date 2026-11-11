# NetChat chat-menu and broadcast repair

This repair updates the existing NetChat project rather than replacing its UI.

## Included changes

- **Mute notifications:** offers 1 hour, 8 hours, 1 week, or always; saves the per-user mute expiry in `chats/{chatId}.muteUntil`; updates `mutedBy`; and suppresses the app's received/typing sound while muted.
- **Disappearing messages:** offers off, 1 hour, 24 hours, or 7 days. The setting is saved on the chat and new messages receive an `expiresAt` timestamp. Expired messages are hidden by the chat renderer.
- **Chat theme:** opens the existing theme selector, applies the selected theme, and saves it per conversation on the device.
- **Report:** submits to the central top-level `reports` collection and also keeps a copy in the reporter's private `user/{uid}/reports` collection. Client access to the central moderation inbox is create-only.
- **Block:** saves the blocked contact and closes the chat. Firestore rules now deny direct messages, contact requests, and call creation/updates if either person has blocked the other.
- **Clear chat:** confirms first, then hides the messages from the current user's view and resets their unread count. It does not delete messages for the other participant.
- **Export chat:** downloads a JSON file containing the conversation messages and export metadata.
- **Add shortcut:** adds a web-app manifest, app icons, service worker registration, and the browser install prompt handler. Browser installation still depends on HTTPS and the browser's installability requirements.
- **Add to list:** lets the user choose an existing personal list or create a new one, then saves the conversation ID in `user/{uid}/chatLists/{listId}`.
- **Media, links, and docs:** the chat menu now separates photos/videos, detected links, and document/audio attachments.
- **Broadcast:** creates a missing direct-chat parent document first with sorted participants; validates existing participants; creates the message; then updates only permitted chat preview/unread fields. It no longer overwrites the participants array on existing chats.

## Required deployment

Deploy the updated project files to the same HTTPS hosting location, then deploy the updated Firestore rules:

```bash
firebase deploy --only firestore:rules
```

The updated `firestore.rules` is required for timed mute settings, private chat lists, central reports, and server-enforced blocking. Deploying only the JavaScript files will leave those operations subject to the old permissions.

## Important behavior and limitations

- Disappearing messages are hidden after `expiresAt`. For permanent server-side deletion of expired message documents, enable a Firestore TTL policy for the `expiresAt` field on the `messages` collection group in the Firebase project. TTL configuration is a Firebase project setting and cannot be activated by this static client bundle.
- The supplied project has in-app sound cues but no Firebase Cloud Messaging token/subscription and push-delivery backend. Mute therefore suppresses the app's in-app received/typing sounds and stores the per-chat preference; it cannot cancel an OS push notification sent by a separate push system that is not included here.
- Central reports are write-only from the client. A trusted moderation dashboard or backend using Firebase Admin SDK is needed to review the top-level `reports` collection.
- The Add shortcut prompt appears automatically only when the browser supports the install prompt and the site meets installability requirements. Otherwise Android Chrome provides **Install app** or **Add to Home screen** in its browser menu.
- The broadcast repair is based on the supplied Firestore rules and client flow. It was syntax-checked, but live Firebase delivery cannot be verified without access to the user's Firebase project or emulator.
