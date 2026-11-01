# Vera — free backend setup (Netlify + Gemini)

This version lets NetChat keep using Firebase Spark while Vera's Gemini request runs in a Netlify Function. The Gemini key stays on the server and is NOT placed in the browser code.

## 1. Create the Netlify site

Create a free Netlify account and create a new site/project. Upload this NetChat project or connect the repository containing it.

The project already includes:
- `netlify.toml`
- `netlify/functions/vera.mjs`
- `netlify/functions/package.json`
- `netlify-public/index.html`

Netlify should detect the function automatically.

## 2. Add the Gemini key as a Netlify environment variable

In Netlify, open the site's environment variables/settings and create:

Name:
`GEMINI_API_KEY`

Value:
`YOUR_NEW_GEMINI_API_KEY`

Never put the key in `vera.js`, `vera-config.js`, HTML, Firestore, or GitHub.

## 3. Deploy

After deployment, the function URL is normally:
`https://YOUR-SITE.netlify.app/.netlify/functions/vera`

Copy that URL.

## 4. Put ONLY the function URL into NetChat

Open `vera-config.js` and replace:
`PASTE_YOUR_NETLIFY_VERA_FUNCTION_URL_HERE`

with the Netlify function URL.

Example:
`window.NETCHAT_VERA_API_URL = "https://your-site.netlify.app/.netlify/functions/vera";`

Do not add the Gemini API key to this file.

## 5. Firebase

You do NOT need to upgrade the NetChat Firebase project to Blaze just to run this Vera backend. Firebase still handles authentication and Firestore.

## What this version can do

- Normal Vera chat
- Conversation context
- Uploaded image/document analysis (within the current 4 MB file-size limit)
- Schoolwork and coding help
- Contextual follow-up suggestions
- Real actions for the currently supported privacy settings:
  - typing indicator
  - read receipts

The browser applies those settings through the signed-in user's normal Firestore permissions, so the AI server does not receive Firebase admin credentials.
