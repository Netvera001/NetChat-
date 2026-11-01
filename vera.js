/* ============================================================
   NETCHAT — VERA AI
   Uses NetChat's existing message input bar. The tune button is
   reserved for Vera settings; suggestions are contextual follow-ups.
   ============================================================ */

(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const uid = () => window.netChatAuthUser?.uid || "guest";
  const historyKey = () => `nx:vera:history:${uid()}`;
  const prefKey = () => `nx:vera:settings:${uid()}`;
  let busy = false;
  let opened = false;
  let savedInputParent = null;
  let savedInputNext = null;

  const prefs = () => {
    try { return JSON.parse(localStorage.getItem(prefKey()) || "{}"); } catch { return {}; }
  };
  const savePrefs = (patch) => {
    try { localStorage.setItem(prefKey(), JSON.stringify({...prefs(), ...patch})); } catch {}
  };
  const suggestionsEnabled = () => prefs().suggestions !== false;

  function appendShell() {
    if (document.getElementById("veraModal")) return;
    const modal = document.createElement("div");
    modal.id = "veraModal";
    modal.className = "vera-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <section class="vera-shell" role="dialog" aria-modal="true" aria-labelledby="veraTitle">
        <header class="vera-head">
          <button class="vera-back" id="veraClose" aria-label="Close Vera"><span class="material-symbols-outlined">arrow_back</span></button>
          <div class="vera-brand">
            <div class="vera-logo"><img src="vera-logo.png" alt="Vera AI"></div>
            <div><b id="veraTitle">Vera AI</b><small>Your NetChat assistant</small></div>
          </div>
          <button class="vera-more" id="veraMore" aria-label="Vera settings" title="Vera settings"><span class="material-symbols-outlined">tune</span></button>
        </header>
        <main class="vera-body" id="veraBody">
          <div class="vera-welcome" id="veraWelcome">
            <div class="vera-big-logo"><img src="vera-logo.png" alt="Vera AI"></div>
            <h2>How can I help?</h2>
            <p>Ask questions, upload schoolwork, understand errors, or ask Vera to change supported NetChat settings for you.</p>
          </div>
          <div class="vera-suggestions" id="veraStarterSuggestions">
            <button class="vera-suggestion" data-prompt="Explain photosynthesis in simple words.">📚 Explain a school topic</button>
            <button class="vera-suggestion" data-prompt="Help me understand a NetChat error.">🛠️ Help with an error</button>
            <button class="vera-suggestion" data-prompt="What can you do for me in NetChat?">✨ What can you do?</button>
          </div>
        </main>
        <div class="vera-compose-slot" id="veraComposeSlot"></div>
        <section class="vera-settings" id="veraSettings" aria-hidden="true">
          <header class="vera-settings-head">
            <button id="veraSettingsBack" class="vera-settings-back" aria-label="Back"><span class="material-symbols-outlined">arrow_back</span></button>
            <div><b>Vera settings</b><small>Customize your Vera experience</small></div>
          </header>
          <div class="vera-settings-body" id="veraSettingsBody"></div>
        </section>
      </section>`;
    document.body.appendChild(modal);

    $("#veraClose", modal).addEventListener("click", close);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    $("#veraMore", modal).addEventListener("click", openSettings);
    $("#veraSettingsBack", modal).addEventListener("click", closeSettings);
    modal.querySelectorAll("[data-prompt]").forEach(b => b.addEventListener("click", () => {
      const input = $("#messageInput");
      if (!input) return;
      input.value = b.dataset.prompt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      veraSend();
    }));
    renderSettings();
  }

  function moveExistingComposerIntoVera() {
    const bar = document.querySelector(".chat-input-bar");
    const slot = $("#veraComposeSlot");
    if (!bar || !slot || bar.parentElement === slot) return;
    savedInputParent = bar.parentElement;
    savedInputNext = bar.nextSibling;
    slot.appendChild(bar);
    document.body.classList.add("vera-mode");
    const input = $("#messageInput");
    if (input) { input.placeholder = "Ask Vera anything…"; input.setAttribute("aria-label", "Ask Vera anything"); }
    document.getElementById("chatMediaPreview")?.setAttribute("hidden", "true");
    const reply = document.getElementById("replyPreview"); if (reply) reply.style.display = "none";
  }

  function restoreExistingComposer() {
    const bar = document.querySelector(".chat-input-bar");
    if (!bar || !savedInputParent) return;
    if (savedInputNext && savedInputNext.parentNode === savedInputParent) savedInputParent.insertBefore(bar, savedInputNext);
    else savedInputParent.appendChild(bar);
    const input = $("#messageInput");
    if (input) { input.placeholder = "Message..."; input.removeAttribute("aria-label"); input.value = ""; input.style.height = "auto"; }
    document.body.classList.remove("vera-mode");
    savedInputParent = null; savedInputNext = null;
  }

  function open() {
    appendShell();
    const modal = $("#veraModal");
    modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
    opened = true;
    moveExistingComposerIntoVera();
    restoreHistory();
    setTimeout(() => $("#messageInput")?.focus(), 100);
  }
  function close() {
    const modal = $("#veraModal"); if (!modal) return;
    closeSettings();
    modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true");
    opened = false;
    restoreExistingComposer();
  }
  function openSettings() {
    appendShell();
    renderSettings();
    $("#veraSettings")?.classList.add("open");
    $("#veraSettings")?.setAttribute("aria-hidden", "false");
  }
  function closeSettings() {
    $("#veraSettings")?.classList.remove("open");
    $("#veraSettings")?.setAttribute("aria-hidden", "true");
  }
  window.netChatOpenVera = open;

  function historyRead() {
    try { return JSON.parse(localStorage.getItem(historyKey()) || "[]"); } catch { return []; }
  }
  function historyWrite(list) {
    try { localStorage.setItem(historyKey(), JSON.stringify(list.slice(-80))); } catch {}
  }
  function saveHistory(role, text) {
    const list = historyRead();
    list.push({ role, text: String(text || ""), time: Date.now() });
    historyWrite(list);
  }

  function addMessage(role, text, persist = true) {
    const body = $("#veraBody");
    $("#veraWelcome")?.remove(); $("#veraStarterSuggestions")?.remove();
    const wrap = document.createElement("div"); wrap.className = `vera-msg ${role}`;
    const bubble = document.createElement("div"); bubble.className = "vera-bubble";
    bubble.textContent = text;
    wrap.appendChild(bubble); body.appendChild(wrap); body.scrollTop = body.scrollHeight;
    if (persist) saveHistory(role, text);
  }
  function addStatus(text) {
    const body = $("#veraBody"); const row = document.createElement("div"); row.className = "vera-tool-status"; row.id = "veraBusy";
    row.innerHTML = `<span class="vera-spinner"></span><span>${esc(text)}</span>`; body.appendChild(row); body.scrollTop = body.scrollHeight;
  }
  function removeStatus() { $("#veraBusy")?.remove(); }

  function addSuggestions(items) {
    if (!suggestionsEnabled() || !Array.isArray(items) || !items.length) return;
    const body = $("#veraBody");
    const wrap = document.createElement("div"); wrap.className = "vera-followups";
    const title = document.createElement("div"); title.className = "vera-followup-title"; title.textContent = "Would you like to know more?"; wrap.appendChild(title);
    items.slice(0, 4).forEach(item => {
      const b = document.createElement("button"); b.className = "vera-followup"; b.type = "button"; b.textContent = item;
      b.addEventListener("click", () => {
        const input = $("#messageInput"); if (!input) return;
        input.value = item; input.dispatchEvent(new Event("input", { bubbles: true })); veraSend();
      });
      wrap.appendChild(b);
    });
    body.appendChild(wrap); body.scrollTop = body.scrollHeight;
  }

  function restoreHistory() {
    const body = $("#veraBody");
    if (!body || body.dataset.historyRestored === uid()) return;
    body.dataset.historyRestored = uid();
    const list = historyRead();
    if (!list.length) return;
    $("#veraWelcome")?.remove(); $("#veraStarterSuggestions")?.remove();
    list.slice(-40).forEach(m => addMessage(m.role, m.text, false));
  }

  function renderSettings() {
    const body = $("#veraSettingsBody"); if (!body) return;
    const user = window.netChatAuthUser;
    const data = window.netChatUserData || {};
    // NetChat stores the user's profile photo as `profileImage`, not `photoURL`.
    // Fall back to the already-rendered NetChat profile image if the user data
    // has not finished loading yet. This prevents Vera Settings from showing
    // the generic default avatar when the real account photo exists.
    const domPhoto = document.getElementById("myAvatarImg")?.src || document.getElementById("profileImage")?.src || "";
    const photo = data.profileImage || user?.photoURL || domPhoto || "default-avatar.png";
    const name = data.userFullname || data.displayName || user?.displayName || "NetChat user";
    const netChatId = data.netChatID || "";
    const usage = $("#veraLimit")?.textContent || "Daily allowance available";
    const on = suggestionsEnabled();
    body.innerHTML = `
      <div class="vera-profile-card">
        <img src="${esc(photo)}" alt="Profile">
        <div><b>${esc(name)}</b><small>${esc(netChatId ? `@${netChatId}` : (user?.email || "Your NetChat account"))}</small></div>
        <span class="material-symbols-outlined">chevron_right</span>
      </div>
      <div class="vera-settings-section"><div class="vera-section-label">VERA</div>
        <button class="vera-setting-row" data-setting="history"><span class="vera-setting-icon blue"><span class="material-symbols-outlined">history</span></span><span><b>Chat history</b><small>Your conversations with Vera</small></span><span class="material-symbols-outlined">chevron_right</span></button>
        <button class="vera-setting-row" data-setting="projects"><span class="vera-setting-icon purple"><span class="material-symbols-outlined">folder_copy</span></span><span><b>Projects</b><small>Keep schoolwork and ideas together</small></span><span class="material-symbols-outlined">chevron_right</span></button>
        <button class="vera-setting-row" data-setting="images"><span class="vera-setting-icon pink"><span class="material-symbols-outlined">imagesmode</span></span><span><b>Images</b><small>Generated images will appear here</small></span><span class="material-symbols-outlined">chevron_right</span></button>
      </div>
      <div class="vera-settings-section"><div class="vera-section-label">PERSONALIZATION</div>
        <label class="vera-setting-row"><span class="vera-setting-icon cyan"><span class="material-symbols-outlined">lightbulb</span></span><span><b>Follow-up suggestions</b><small>Vera suggests useful next questions</small></span><span class="vera-switch"><input id="veraSuggestionSwitch" type="checkbox" ${on ? "checked" : ""}><i></i></span></label>
      </div>
      <div class="vera-settings-section"><div class="vera-section-label">ACCOUNT & STORAGE</div>
        <div class="vera-usage-card"><span class="material-symbols-outlined">speed</span><div><b>Vera usage</b><small>${esc(usage)}</small></div></div>
        <button class="vera-setting-row danger-row" data-setting="clear"><span class="vera-setting-icon red"><span class="material-symbols-outlined">delete_sweep</span></span><span><b>Clear Vera history</b><small>Remove conversations stored on this device</small></span></button>
      </div>
      <div class="vera-about">Vera AI · NetChat assistant<br><small>More controls will appear here as Vera gains new abilities.</small></div>`;

    $("#veraSuggestionSwitch")?.addEventListener("change", e => { savePrefs({ suggestions: e.target.checked }); renderSettings(); });
    body.querySelectorAll("[data-setting]").forEach(btn => btn.addEventListener("click", () => handleSettingsAction(btn.dataset.setting)));
  }

  function handleSettingsAction(action) {
    if (action === "clear") {
      if (!confirm("Clear your Vera chat history on this device?")) return;
      try { localStorage.removeItem(historyKey()); } catch {}
      const body = $("#veraBody"); if (body) { body.innerHTML = `<div class="vera-welcome"><div class="vera-big-logo"><img src="vera-logo.png" alt="Vera AI"></div><h2>History cleared</h2><p>Start a new conversation with Vera.</p></div>`; body.dataset.historyRestored = uid(); }
      closeSettings(); return;
    }
    const body = $("#veraBody");
    if (action === "history") {
      closeSettings();
      const list = historyRead();
      body.innerHTML = `<div class="vera-page-card"><h3>Chat history</h3><p>${list.length ? "Recent conversations with Vera on this device." : "No Vera history yet."}</p>${list.slice(-20).map((m) => `<div class="vera-history-item"><span class="material-symbols-outlined">${m.role === "user" ? "person" : "auto_awesome"}</span><div><b>${m.role === "user" ? "You" : "Vera"}</b><p>${esc(m.text.slice(0, 180))}</p></div></div>`).join("")}<button class="vera-inline-btn" id="veraBackToChat">Back to Vera</button></div>`;
      $("#veraBackToChat")?.addEventListener("click", () => { body.innerHTML = ""; body.dataset.historyRestored = ""; restoreHistory(); });
    }
    if (action === "projects") { closeSettings(); body.innerHTML = `<div class="vera-page-card"><h3>Projects</h3><p>Projects will keep assignments, notes and study sessions together.</p><button class="vera-inline-btn" id="veraNewProject">＋ New project</button></div>`; $("#veraNewProject")?.addEventListener("click", () => alert("Project workspace is ready for the next Vera update.")); }
    if (action === "images") { closeSettings(); body.innerHTML = `<div class="vera-page-card"><h3>Images</h3><div class="vera-image-empty"><span class="material-symbols-outlined">image</span><p>Generated images will be stored here automatically when Vera image generation is connected.</p></div></div>`; }
  }

  async function onFile(file) {
    if (!file) return;
    addMessage("user", `📎 ${file.name}`);
    addStatus("Reading your file…");
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error("That file is larger than 4 MB for this Vera version.");
      const base64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1] || ""); r.onerror = reject; r.readAsDataURL(file); });
      removeStatus();
      await callVera(`Please analyze the uploaded file named ${file.name}. If it is an assignment, explain and solve it step by step. If it is notes, summarize it and offer useful study questions.`, { file: { name: file.name, mimeType: file.type || "application/octet-stream", data: base64 } });
    } catch (err) { removeStatus(); addMessage("ai", `I couldn't process that file: ${err.message || "Unknown error"}`); }
  }

  async function veraSend() {
    if (!opened || busy) return;
    const input = $("#messageInput"); const text = String(input?.value || "").trim(); if (!text) return;
    input.value = ""; input.style.height = "auto"; input.dispatchEvent(new Event("input", { bubbles: true }));
    addMessage("user", text); await callVera(text);
  }

  async function callVera(text, attachment = null) {
    if (!window.netChatFirebaseApp || !window.netChatAuthUser) { addMessage("ai", "Please sign in to NetChat before using Vera."); return; }
    const apiUrl = String(window.NETCHAT_VERA_API_URL || "").trim();
    if (!apiUrl || apiUrl.includes("PASTE_YOUR_NETLIFY")) {
      addMessage("ai", "Vera is almost ready. The free Vera server URL still needs to be added to vera-config.js.");
      return;
    }
    busy = true;
    const send = $("#sendMsgBtn"); if (send) send.disabled = true;
    addStatus("Vera is thinking…");
    try {
      const conversation = historyRead().slice(0, -1).slice(-24).map(m => ({ role: m.role === "ai" ? "model" : "user", text: m.text }));
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          uid: window.netChatAuthUser.uid,
          message: text,
          history: conversation,
          attachment,
          suggestions: suggestionsEnabled(),
          privacy: window.netChatUserData?.privacy || {}
        })
      });
      let data = {};
      try { data = await response.json(); } catch { data = {}; }
      if (!response.ok) throw new Error(data.error || `Vera server returned ${response.status}.`);
      removeStatus();

      const action = data.action || { type: "none", enabled: false };
      if (action.type === "set_typing" || action.type === "set_readReceipts") {
        await applyVeraAction(action);
      }
      addMessage("ai", data.text || "I couldn't produce a response this time.");
      addSuggestions(data.suggestions || []);
      renderSettings();
    } catch (error) {
      removeStatus();
      const msg = error?.message || "Vera is not available yet.";
      addMessage("ai", `Vera couldn't complete that request: ${msg}`);
    } finally {
      busy = false;
      if (send) send.disabled = false;
      $("#messageInput")?.focus();
    }
  }

  async function applyVeraAction(action) {
    const uidValue = window.netChatAuthUser?.uid;
    if (!uidValue || !window.netChatDB || !window.netChatDoc || !window.netChatUpdateDoc) {
      throw new Error("NetChat is not ready to update that setting.");
    }
    let setting = "";
    if (action.type === "set_typing") setting = "typing";
    if (action.type === "set_readReceipts") setting = "readReceipts";
    if (!setting || typeof action.enabled !== "boolean") return;

    await window.netChatUpdateDoc(window.netChatDoc(window.netChatDB, "user", uidValue), {
      [`privacy.${setting}`]: action.enabled
    });

    window.netChatUserData = window.netChatUserData || {};
    window.netChatUserData.privacy = { ...(window.netChatUserData.privacy || {}), [setting]: action.enabled };
    const privacyInput = document.querySelector(`[data-key="${setting}"] input[type="checkbox"]`);
    if (privacyInput) privacyInput.checked = action.enabled;

    const label = setting === "typing" ? "Typing indicator" : "Read receipts";
    addMessage("system", `Done! ${label} is now ${action.enabled ? "on" : "off"}.`);
  }

  // Reuse the existing NetChat composer instead of creating another input box.
  document.addEventListener("click", (event) => {
    if (!opened) return;
    if (event.target.closest("#sendMsgBtn")) { event.preventDefault(); event.stopImmediatePropagation(); veraSend(); return; }
    if (event.target.closest("#attachFileBtn")) {
      event.preventDefault(); event.stopImmediatePropagation();
      let input = $("#veraFile"); if (!input) { input = document.createElement("input"); input.type = "file"; input.id = "veraFile"; input.accept = "image/*,.pdf,.txt,.md,.doc,.docx"; input.hidden = true; document.body.appendChild(input); input.addEventListener("change", () => { onFile(input.files?.[0]); input.value = ""; }); }
      input.click();
    }
    if (event.target.closest("#chatImageBtn") || event.target.closest("#chatGalleryBtn")) {
      event.preventDefault(); event.stopImmediatePropagation();
      let input = $("#veraFile"); if (!input) { input = document.createElement("input"); input.type = "file"; input.id = "veraFile"; input.accept = "image/*,.pdf,.txt,.md,.doc,.docx"; input.hidden = true; document.body.appendChild(input); input.addEventListener("change", () => { onFile(input.files?.[0]); input.value = ""; }); }
      input.click();
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!opened || event.target?.id !== "messageInput") return;
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.stopImmediatePropagation(); veraSend(); }
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector(".header-actions");
    if (header && !$("#veraHeaderBtn")) {
      const b = document.createElement("button"); b.id = "veraHeaderBtn"; b.className = "icon-btn vera-header-btn"; b.setAttribute("aria-label", "Open Vera AI"); b.title = "Vera AI";
      b.innerHTML = `<span class="vera-mini-logo"><img src="vera-logo.png" alt=""></span>`;
      b.addEventListener("click", open); header.insertBefore(b, header.firstChild);
    }
  });
})();
