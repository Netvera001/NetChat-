/* NetChat Vera server configuration.
   The Gemini API key stays in Netlify Environment Variables.
   Vera uses the deployed Netlify backend so the app can call Vera
   even when NetChat is opened from SPCK, GitHub Pages, or another host.
*/
window.NETCHAT_VERA_API_URL = "https://clinquant-cat-3001be.netlify.app/.netlify/functions/vera";