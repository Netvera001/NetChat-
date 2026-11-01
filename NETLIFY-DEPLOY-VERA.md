# NetChat + Vera — Netlify deployment

## Important
Vera's backend is the Netlify Function at:

`netlify/functions/vera.mjs`

The browser calls it through:

`/.netlify/functions/vera`

Do NOT put the Gemini API key in this project. Keep it only in Netlify Environment Variables as `GEMINI_API_KEY`.

## Recommended deployment

Use Netlify's Git-based deployment (GitHub/GitLab/Bitbucket), not a simple static drag-and-drop deploy. Netlify must process the `netlify/functions` directory as a Functions directory.

1. Create a GitHub repository and upload the contents of this ZIP to the repository root.
2. In Netlify, open `clinquant-cat-3001be`.
3. Go to Project configuration / Build & deploy and connect the Git repository (or create a new site from the repository if the existing site cannot be connected).
4. Build command: leave empty.
5. Publish directory: `.`
6. Functions directory: `netlify/functions`.
7. Deploy.
8. Keep `GEMINI_API_KEY` in Netlify environment variables. Never paste it into the code.

## Verify the function

After deployment, open:

`https://clinquant-cat-3001be.netlify.app/.netlify/functions/vera`

A working function should return JSON containing:

`"ok": true`

and

`"geminiKeyConfigured": true`

The actual API key is never returned.
