# Vera AI foundation

Vera is now wired into NetChat as a full-screen assistant so the chat list and chat screen are not squeezed.

## What is included
- Vera AI overlay UI (`vera.css`, `vera.js`)
- Header sparkle button to open Vera
- Suggestions that can be turned off/on
- File picker foundation for images/PDF/text documents
- Secure Firebase callable backend (`functions/index.js`)
- Gemini API key kept server-side in Firebase Secret Manager
- Per-user daily quota (20 Vera requests in this first version)
- Real NetChat actions for `typing` and `readReceipts`
- Tool-calling architecture ready for more NetChat actions

## One-time deployment
From the NetChat project folder with Firebase CLI installed:

1. Install function dependencies:
   `cd functions && npm install`
2. Set the Gemini secret:
   `firebase functions:secrets:set GEMINI_API_KEY`
3. Deploy the Vera function:
   `firebase deploy --only functions:veraChat`

The frontend already calls the deployed callable function automatically.

## Important
Do not put the Gemini API key in `vera.js`, `index.html`, or any public file. The key belongs in Firebase Secret Manager and is read only by the backend function.
