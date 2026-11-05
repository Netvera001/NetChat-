# NetChat profile, pending-message and archive improvements

## Included
- New account profiles receive the editable default bio: "Hi, I'm using NetChat."
- An offline send failure is kept in the current chat as a pending message with a clock-style status and "Waiting for connection" label.
- When connectivity returns during the same open chat session, pending messages are automatically retried.
- A deliberate left swipe archives a chat directly with a smooth slide-away animation; no archive action tab is shown.
- Existing long-press chat actions and the Archived Chats restore screen remain available.

## Notes
- The pending retry currently lives in the active browser session. A durable outbox that survives closing/restarting the app, including queued media uploads, requires a separate IndexedDB-backed queue.
- Firestore security rules already permit the signed-in owner to create/read/delete documents in `user/{uid}/archivedChats` in this project. If your deployed rules differ, publish the included `firestore.rules`.
- The default bio is applied only when creating a new profile; existing user bios are not overwritten.
