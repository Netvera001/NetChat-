# NetChat final fix: "Privacy status unavailable"

Causes fixed:
1. chat-menu.js treated any error as a privacy failure and wiped the chat. A brand-new conversation has no `chats/<id>` document yet, so it threw "conversation could not be found". It now builds the context from the open conversation.
2. Auth was checked once, instantly. It now waits for Firebase to restore the session, then retries 3 times with an 8 s timeout.
3. On failure the chat is no longer hidden. A small "Retry" notice appears and the composer and call buttons stay visible. Blocks are still enforced by Firestore rules.
4. script.js can no longer leave the chat screen hidden if the check fails.
5. Cache busting: index.html loads files with `?v=20261110a` and sw.js is now `netchat-shell-v2`. Your error's line numbers did not match the previous chat-menu.js, so the browser was running a cached old copy.

After installing: stop and restart your local server, then on the phone open Chrome menu > Settings > Privacy > Clear browsing data (cached files) for localhost, or open the site in a new incognito tab.
