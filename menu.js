/* ============================================================
   NETCHAT — MENUS & SETTINGS 
   
   
   (netchat-menus.js)
   Vanilla JS, no dependencies. Drop after your main script.
   ============================================================ */
(function () {
  "use strict";

  const CLOUD_NAME = "haludoui";
  const UPLOAD_PRESET = "My_NetChat_profile";   // falls back to My_NetChat_chat
  const FALLBACK_PRESET = "My_NetChat_chat";

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $("#nxToast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------------- Prefs ---------------- */
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem("nx:" + k); return v === null ? d : JSON.parse(v); }
      catch { return d; }
    },
    set(k, v) { try { localStorage.setItem("nx:" + k, JSON.stringify(v)); } catch {} }
  };

  /* ---------------- Live appearance appliers ---------------- */
  const THEMES = {
    midnight: "#0b0f17",
    abyss:    "#000000",
    aurora:   "#100c26"
  };
  const FONT_SIZES = { Compact: "14px", Default: "16px", Large: "18px" };

  function applyAppearance() {
    const accent = store.get("accent", "#00f0ff");
    document.documentElement.style.setProperty("--wa-neon-blue", accent);

    const theme = store.get("theme", "midnight");
    document.documentElement.style.setProperty("--wa-bg-dark", THEMES[theme] || THEMES.midnight);

    const fs = store.get("fontSize", "Default");
    document.documentElement.style.fontSize = FONT_SIZES[fs] || FONT_SIZES.Default;

    const wall = store.get("wallpaper", null);
    if (wall) document.querySelector(".chat-messages-body")?.style.setProperty("background-color", wall);
  }
  applyAppearance();
  document.documentElement.classList.toggle("hide-chat-previews", store.get("previews", true) === false);

  /* ============================================================
     QUICK MENU (three-dot)
     ============================================================ */
  const backdrop = $("#nxBackdrop");
  const menuPop  = $("#menuPop");

  function openMenu()  { menuPop.classList.add("open");  backdrop.classList.add("show"); }
  function closeMenu() { menuPop.classList.remove("open"); backdrop.classList.remove("show"); }

  const moreBtn = $("#moreBtn");
  if (moreBtn) {
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuPop.classList.contains("open") ? closeMenu() : openMenu();
    });
  }
  document.addEventListener("click", (e) => {
    if (menuPop && menuPop.classList.contains("open") && !menuPop.contains(e.target)) closeMenu();
  });

  const menuActions = {
    newGroup()      { closeMenu(); window.netChatOpenFeature?.("newGroup"); },
    broadcast()     { closeMenu(); window.netChatOpenFeature?.("broadcast"); },
    starred()       { closeMenu(); window.netChatOpenFeature?.("starred"); },
    markRead()      { closeMenu(); if (window.netChatMarkAllRead) { window.netChatMarkAllRead(); } else { $$(".badge").forEach(b => b.remove()); toast("All chats marked as read"); } },
    linkedDevices() { closeMenu(); window.netChatOpenFeature?.("linkedDevices"); },
    achievements()  { closeMenu(); window.netChatOpenFeature?.("achievements"); },
    settings()      { closeMenu(); openSettings(); }
  };
  $$(".mi[data-act]").forEach(btn =>
    btn.addEventListener("click", () => menuActions[btn.dataset.act]?.())
  );

  /* ============================================================
     SETTINGS PAGE
     ============================================================ */
  const settingsPage = $("#settingsPage");

  function openSettings()  { settingsPage.classList.add("open"); }
  window.netChatOpenSettings = openSettings;
  function closeSettings() { settingsPage.classList.remove("open"); closeSub(); }
  $("#setBack")?.addEventListener("click", closeSettings);

  /* Copy NetChat ID */
  $("#copyId")?.addEventListener("click", async () => {
    const id = $("#netchatIdValue")?.textContent || $("#netchatId b")?.textContent || "";
    if (!id) return toast("ID not loaded yet");
    try { await navigator.clipboard.writeText(id); toast("NetChat ID copied ✦"); }
    catch { toast(id); }
  });

  /* Row click router */
  $$("[data-sub]").forEach(row =>
    row.addEventListener("click", () => openSub(row.dataset.sub))
  );
  $$("[data-toast]").forEach(row =>
    row.addEventListener("click", () => toast(row.dataset.toast))
  );

  $$('[data-action="editProfile"]').forEach(btn => {
    btn.addEventListener("click", () => {
      openSub("profile");
      closeMenu();
      setTimeout(openEditProfile, 300);
    });
  });

  $$('[data-action="changeProfilePicture"]').forEach(btn => {
    btn.addEventListener("click", () => {
      openSub("profile");
      closeMenu();
      setTimeout(() => $("#fileInput")?.click(), 300);
    });
  });

  $$('[data-action="viewNetChatID"]').forEach(btn => {
    btn.addEventListener("click", () => {
      openSub("profile");
      closeMenu();
      setTimeout(() => copyText(getData().netChatID || "", "NetChat ID"), 300);
    });
  });

  async function copyText(text, label) {
    if (!text) return toast("Nothing to copy");
    try { await navigator.clipboard.writeText(text); toast(`${label} copied ✦`); }
    catch { toast(text); }
  }

  const getData = () => window.netChatUserData || {};

  /* ============================================================
     SUB PAGES — generic data-driven builder
     ============================================================ */
  const subPage = $("#subPage");
  const subHead = $("#subHeadTitle");
  const subDot  = $("#subTintDot");
  const subBody = $("#subBody");

  const TINTS = {
    cyan:"nx-t-cyan", violet:"nx-t-violet", pink:"nx-t-pink", emerald:"nx-t-emerald",
    amber:"nx-t-amber", purple:"nx-t-purple", blue:"nx-t-blue", green:"nx-t-green",
    sky:"nx-t-sky", slate:"nx-t-slate"
  };

  const icon = (name) => `<span class="material-symbols-outlined">${name}</span>`;

  /* row builders */
  function toggleRow(o) {
    const on = store.get(o.key, o.def);
    return `
      <div class="set-row ${TINTS[o.tint]}" data-key="${esc(o.key)}" style="cursor:default">
        <span class="ic">${icon(o.icon)}</span>
        <span class="meta"><b>${o.label}</b>${o.desc ? `<small>${o.desc}</small>` : ""}</span>
        <label class="nx-switch ${TINTS[o.tint]}">
          <input type="checkbox" ${on ? "checked" : ""} aria-label="${o.label}">
          <span class="track"></span><span class="thumb"></span>
        </label>
      </div>`;
  }

  function navRow(o) {
    return `
      <button class="set-row ${TINTS[o.tint]}"
        ${o.action ? `data-action="${o.action}"` : `data-toast="${o.toast || o.label + " — coming soon"}"`}>
        <span class="ic">${icon(o.icon)}</span>
        <span class="meta"><b>${o.label}</b>${o.desc ? `<small>${o.desc}</small>` : ""}</span>
        <span class="trail">${o.value || ""}${icon("chevron_right")}</span>
      </button>`;
  }

  function infoRow(o) {
    return `
      <div class="set-row ${TINTS[o.tint]}" style="cursor:default">
        <span class="ic">${icon(o.icon)}</span>
        <span class="meta"><b>${o.label}</b>${o.desc ? `<small>${o.desc}</small>` : ""}</span>
        <span class="trail">${o.value || ""}</span>
      </div>`;
  }

  function chipsRow(o) {
    const cur = store.get(o.key, o.options[0]);
    return `
      <div class="set-row ${TINTS[o.tint]}" style="cursor:default">
        <span class="ic">${icon(o.icon)}</span>
        <span class="meta"><b>${o.label}</b>${o.desc ? `<small>${o.desc}</small>` : ""}</span>
      </div>
      <div class="choice-chips ${TINTS[o.tint]}" data-chips="${o.key}">
        ${o.options.map(op => `<button class="choice-chip ${op === cur ? "on" : ""}" data-val="${op}">${op}</button>`).join("")}
      </div>`;
  }

  function themeRow(o) {
    const cur = store.get(o.key, o.options[0].id);
    return `
      <div class="set-row ${TINTS[o.tint]}" style="cursor:default">
        <span class="ic">${icon(o.icon)}</span>
        <span class="meta"><b>${o.label}</b>${o.desc ? `<small>${o.desc}</small>` : ""}</span>
      </div>
      <div class="radio-cards ${TINTS[o.tint]}" data-radio="${o.key}">
        ${o.options.map(op => `
          <div class="radio-card ${op.id === cur ? "on" : ""}" data-val="${op.id}">
            <span class="sw" style="background:${op.sw}"></span>
            <span class="meta"><b>${op.label}</b><small>${op.desc}</small></span>
            <span class="tick">${icon("check")}</span>
          </div>`).join("")}
      </div>`;
  }

  function swatchesRow(o) {
    const cur = store.get(o.key, o.colors[0]);
    return `
      <div class="set-row ${TINTS[o.tint]}" style="cursor:default">
        <span class="ic">${icon(o.icon)}</span>
        <span class="meta"><b>${o.label}</b>${o.desc ? `<small>${o.desc}</small>` : ""}</span>
      </div>
      <div class="swatches" data-swatches="${o.key}">
        ${o.colors.map(c => `
          <button class="swatch ${c === cur ? "on" : ""}" data-val="${c}" style="background:${c}" aria-label="Wallpaper">${c === cur ? icon("check") : ""}</button>`).join("")}
      </div>`;
  }

  function storageRow(o) {
    const total = o.parts.reduce((a, p) => a + p.gb, 0);
    return `
      <div class="set-row ${TINTS[o.tint]}" style="cursor:default">
        <span class="ic">${icon(o.icon)}</span>
        <span class="meta"><b>${o.label}</b><small>${total} GB of ${o.limit} GB used</small></span>
      </div>
      <div class="store-bar ${TINTS[o.tint]}">
        ${o.parts.map(p => `<i style="width:${(p.gb / o.limit) * 100}%;background:${p.c}" title="${p.label}"></i>`).join("")}
      </div>
      <div class="store-legend">
        ${o.parts.map(p => `<div class="li"><i style="background:${p.c}"></i>${p.label}<b>${p.gb} GB</b></div>`).join("")}
      </div>`;
  }

  const BUILDERS = { toggle: toggleRow, nav: navRow, info: infoRow, chips: chipsRow, theme: themeRow, swatches: swatchesRow, storage: storageRow };

  /* ---------------- sub-page definitions ---------------- */
  const SUBPAGES = {
    profile: {
      title: "My Profile", tint: "cyan", icon: "person",
      desc: "How you appear to others on NetChat.",
      rows: [
        { t:"info", tint:"cyan", icon:"badge",          label:"NetChat ID", desc:"Unique, can't be changed", value:"—" },
        { t:"info", tint:"cyan", icon:"mail",           label:"Email", desc:"Used for sign-in", value:"—" },
        { t:"info", tint:"cyan", icon:"calendar_month", label:"Joined", value:"—" },
        { t:"nav", tint:"violet", icon:"edit", label:"Edit Profile", action:"editProfile" },
        { t:"nav", tint:"violet", icon:"photo_camera", label:"Change Profile Picture", action:"changeProfilePicture" },
      ]
    },
    account: {
      title: "Account", tint: "violet", icon: "shield_person",
      desc: "Security and sign-in details for your account.",
      rows: [
        { t:"info", tint:"violet", icon:"mail",     label:"Email", value:"—" },
        { t:"nav",  tint:"violet", icon:"password", label:"Change Password", desc:"Send a secure reset email", action:"resetPassword" },
        { t:"nav",  tint:"violet", icon:"devices",  label:"Active Sessions", desc:"Review device pairing availability", action:"activeSessions" },
        { t:"nav",  tint:"violet", icon:"download", label:"Request Account Data", action:"exportAccount" },
      ]
    },
    privacy: {
      title: "Privacy", tint: "pink", icon: "lock",
      desc: "Control who sees your activity and how you can be reached.",
      rows: [
        { t:"chips",  tint:"pink", key:"lastSeen", icon:"schedule", label:"Last Seen", desc:"Who can see when you were last active", options:["Everyone","Contacts","Nobody"] },
        { t:"chips",  tint:"pink", key:"pfp", icon:"photo_camera", label:"Profile Photo", options:["Everyone","Contacts","Nobody"] },
        { t:"toggle", tint:"pink", key:"readReceipts", icon:"done_all", label:"Read Receipts", desc:"Send and receive blue ticks", def:true },
        { t:"toggle", tint:"pink", key:"typing", icon:"keyboard", label:"Typing Indicators", def:true },
        { t:"nav",    tint:"pink", icon:"block", label:"Blocked Users", action:"openBlocked" },
        { t:"chips",  tint:"pink", key:"grpInv", icon:"group_add", label:"Group Invitations", desc:"Who can add you to groups", options:["Everyone","Contacts","Nobody"] },
      ]
    },
    chats: {
      title: "Chats", tint: "emerald", icon: "chat_bubble",
      desc: "Backups, wallpapers and chat behaviour.",
      rows: [
        { t:"toggle", tint:"emerald", key:"enterSend", icon:"keyboard_return", label:"Enter to Send", def:true },
        { t:"swatches", tint:"emerald", key:"wallpaper", icon:"wallpaper", label:"Chat Wallpaper", desc:"Tap a swatch to apply",
          colors:["#0b0f17","#101828","#1a1030","#0b2b26","#231603","#3b0d1e","#0d2137","#1f2937","#052e16","#111827"] },
        { t:"nav", tint:"emerald", icon:"archive", label:"Archived Chats", action:"openArchived" },
        { t:"nav", tint:"emerald", icon:"star", label:"Starred Messages", action:"openStarred" },
        { t:"nav", tint:"emerald", icon:"download", label:"Export Chat Data", desc:"Download your profile and chat metadata", action:"exportAccount" },
      ]
    },
    starred: {
      title: "Starred Messages", tint: "amber", icon: "star",
      desc: "Messages you marked with a star, across your real chats.",
      rows: [{ t:"nav", tint:"amber", icon:"star", label:"Open starred messages", action:"openStarred" }]
    },
    notifications: {
      title: "Notifications", tint: "amber", icon: "notifications",
      desc: "Fine-tune what pings you and how.",
      rows: [
        { t:"toggle", tint:"amber", key:"msgNotif", icon:"chat", label:"Message Notifications", desc:"Banners and sounds for chats", def:true },
        { t:"toggle", tint:"amber", key:"grpNotif", icon:"groups", label:"Group Message Sounds", desc:"Play a cue for incoming group messages", def:true },
        { t:"nav", tint:"amber", icon:"music_note", label:"Message Sound Cues", desc:"Sent, received, typing and calls", action:"soundSettings" },
        { t:"chips",  tint:"amber", key:"vibrate", icon:"vibration", label:"Vibration", options:["Default","Long","Off"] },
        { t:"toggle", tint:"amber", key:"previews", icon:"visibility", label:"Show Chat-List Previews", def:true },
      ]
    },
    appearance: {
      title: "Appearance", tint: "purple", icon: "palette",
      desc: "Make NetChat feel like yours.",
      rows: [
        { t:"theme", tint:"purple", key:"theme", icon:"contrast", label:"Theme",
          options:[
            { id:"midnight", label:"Midnight Neon", desc:"Signature dark — cyan & violet", sw:"linear-gradient(135deg,#0b0f17 55%,#00f0ff)" },
            { id:"abyss",    label:"Abyss", desc:"Pure black — OLED friendly", sw:"linear-gradient(135deg,#000 60%,#334155)" },
            { id:"aurora",   label:"Aurora", desc:"Deep indigo with soft glow", sw:"linear-gradient(135deg,#16123a 55%,#9d4edd)" },
          ]},
        { t:"swatches", tint:"purple", key:"accent", icon:"format_color_fill", label:"Accent Glow", desc:"Pick your neon",
          colors:["#00f0ff","#9d4edd","#f472b6","#34d399","#fbbf24"] },
        { t:"chips", tint:"purple", key:"fontSize", icon:"format_size", label:"Font Size", options:["Compact","Default","Large"] },
      ]
    },
    storage: {
      title: "Storage & Data", tint: "blue", icon: "storage",
      desc: "What's on your device, and what moves over the network.",
      rows: [
        { t:"nav", tint:"blue", icon:"pie_chart", label:"Calculate Media Usage", desc:"Sum sizes stored on your message attachments", action:"calculateStorage" },
        { t:"chips", tint:"blue", key:"autoDl", icon:"download", label:"Media Auto-Download", desc:"On mobile data", options:["All","Photos Only","Wi-Fi Only","Never"] },
        { t:"chips", tint:"blue", key:"dataMode", icon:"query_stats", label:"Data Usage Mode", options:["Normal","Data Saver"] },
        { t:"nav", tint:"blue", icon:"delete", label:"Clear Web Cache", desc:"Remove Cache Storage entries on this device", action:"clearCache" },
      ]
    },
    groups: {
      title: "Groups & Connections", tint: "green", icon: "groups",
      desc: "How groups behave and who you're connected to.",
      rows: [
        { t:"nav", tint:"green", icon:"tune", label:"Group Settings", desc:"Open a group, then use Members", action:"groupSettings" },
        { t:"nav", tint:"green", icon:"hub", label:"Connections", desc:"Communities and their members", action:"openCommunities" },
        { t:"nav", tint:"green", icon:"block", label:"Blocked Users", action:"openBlocked" },
      ]
    },
    help: {
      title: "Help & Support", tint: "sky", icon: "help",
      desc: "We're here when you need us.",
      rows: [
        { t:"nav", tint:"sky", icon:"menu_book", label:"Help Center", desc:"Guides, tips and FAQs" },
        { t:"nav", tint:"sky", icon:"support_agent", label:"Contact NetChat Support" },
        { t:"nav", tint:"sky", icon:"flag", label:"Report a Problem" },
      ]
    },
    about: {
      title: "About NetChat", tint: "slate", icon: "info",
      desc: "The neon conversation, everywhere.",
      rows: [
        { t:"info", tint:"slate", icon:"deployed_code", label:"Version", value:"NetChat v2.4.1" },
        { t:"nav",  tint:"slate", icon:"gavel", label:"Terms of Service", action:"showTerms" },
        { t:"nav",  tint:"slate", icon:"shield", label:"Privacy Policy", action:"showPrivacy" },
        { t:"nav",  tint:"slate", icon:"favorite", label:"Open-Source Licenses", action:"showLicenses" },
      ]
    },
  };

  async function openSub(id) {
    const cfg = SUBPAGES[id];
    if (!cfg) return;

    // wait for auth + user doc (resolves with window.netChatUserData)
    const user = await window.netChatUserReady;
    const auth = window.netChatAuthUser;

    /* hydrate live values from the user doc / auth */
    if (id === "profile") {
      cfg.rows[0].value = esc(user.netChatID || "—");
      cfg.rows[1].value = esc(auth?.email || user.userEmail || "—");
      cfg.rows[2].value = auth?.metadata?.creationTime
        ? new Date(auth.metadata.creationTime).toLocaleDateString()
        : "—";
    }
    if (id === "account") {
      cfg.rows[0].value = esc(auth?.email || "—");
    }

    /* ★ FIX: hydrate privacy controls from Firestore (chips + toggles read from store) */
    if (id === "privacy") {
      const privacy = user.privacy || {};
      cfg.rows.forEach((row) => {
        if (row.key !== undefined && privacy[row.key] !== undefined) {
          store.set(row.key, privacy[row.key]);
        }
      });
    }

    subHead.textContent = cfg.title;
    subDot.className = "head-dot " + TINTS[cfg.tint];
    subPage.className = "sub-page " + TINTS[cfg.tint];
    subBody.innerHTML = `
      <div class="sub-hero">
        <div class="big-ic">
          ${user.profileImage
            ? `<img src="${esc(user.profileImage)}" alt="Profile picture">`
            : icon(cfg.icon)}
        </div>
        <h3>${id === "profile" ? esc(user.userFullname || "My Profile") : cfg.title}</h3>
        <p>${cfg.desc}</p>
      </div>
      <div class="set-group">
        ${cfg.rows.map(r => BUILDERS[r.t](r)).join("")}
      </div>
      <div style="height:30px"></div>`;
    bindSubInteractions();
    requestAnimationFrame(() => requestAnimationFrame(() => subPage.classList.add("open")));
  }

  function closeSub() { subPage.classList.remove("open"); }
  $("#subBack")?.addEventListener("click", closeSub);

  /* ---------------- profile picture upload ---------------- */
  const cameraIcon = $("#cameraIcon");
  const fileInput  = $("#fileInput");

  if (cameraIcon) cameraIcon.addEventListener("click", () => fileInput?.click());

  async function tryUpload(file, preset) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", preset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (!res.ok || !data.secure_url) throw new Error(data.error?.message || "upload failed");
    return data;
  }

  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;

      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
        toast("Choose JPG, PNG or WebP under 5 MB");
        fileInput.value = "";
        return;
      }

      fileInput.disabled = true;
      if (cameraIcon) { cameraIcon.style.pointerEvents = "none"; cameraIcon.setAttribute("aria-busy", "true"); }
      try {
        toast("Uploading profile picture… 0%");

        let data;
        try {
          data = await tryUpload(file, UPLOAD_PRESET);
        } catch (firstError) {
          // ★ FIX: preset may not exist — fall back to the chat preset
          console.warn("Preset failed, retrying with fallback preset:", firstError);
          data = await tryUpload(file, FALLBACK_PRESET);
        }

        const uid = window.netChatAuthUser.uid;
        await window.netChatUpdateDoc(
          window.netChatDoc(window.netChatDB, "user", uid),
          { profileImage: data.secure_url, profileImagePublicId: data.public_id }
        );

        window.netChatUserData.profileImage = data.secure_url;
        window.netChatUserData.profileImagePublicId = data.public_id;

        const profileImage = $("#profileImage");
        if (profileImage) { profileImage.src = data.secure_url; profileImage.style.display = "block"; }

        const placeholder = $(".hero-avatar .in");
        if (placeholder) placeholder.style.display = "none";

        const myAv = $("#myAvatarImg");
        if (myAv) myAv.src = data.secure_url;

        toast("Profile picture updated ✓");
      } catch (error) {
        console.error("Profile picture upload failed:", error);
        toast("Could not update profile picture");
      }

      fileInput.value = "";
      fileInput.disabled = false;
      if (cameraIcon) { cameraIcon.style.pointerEvents = ""; cameraIcon.removeAttribute("aria-busy"); }
    });
  }

  /* ---------------- edit profile ---------------- */
  async function openEditProfile() {
    const user = await window.netChatUserReady;

    subHead.textContent = "Edit Profile";
    subBody.innerHTML = `
      <div class="vera">
        <span class="meta">
          <b>Full Name</b>
          <input id="editFullName" type="text" maxlength="40"
            value="${esc(user.userFullname || "")}" placeholder="Enter your full name">
          <b style="margin-top:6px">About</b>
          <textarea id="editAbout" placeholder="BIO: Tell people a little about yourself"
            maxlength="150">${esc(user.about || "")}</textarea>
        </span>
        <button id="saveFullName">Save</button>
      </div>`;

    subPage.classList.add("open");

    $("#saveFullName").addEventListener("click", async () => {
      const newName  = $("#editFullName").value.trim();
      const newAbout = $("#editAbout").value.trim();
      const saveButton = $("#saveFullName");

      if (!newName) return toast("Name can't be empty");

      saveButton.textContent = "Saving...";
      saveButton.disabled = true;

      try {
        await window.netChatUpdateDoc(
          window.netChatDoc(window.netChatDB, "user", window.netChatAuthUser.uid),
          { userFullname: newName, about: newAbout }
        );

        window.netChatUserData.userFullname = newName;
        window.netChatUserData.about = newAbout;

        const pn = $("#profileName");
        if (pn) pn.textContent = newName;
        const bio = $("#bio");
        if (bio) bio.textContent = newAbout;
        const spn = $("#statusProfileName");
        if (spn) spn.textContent = newName;

        closeSub();
        toast("Profile updated ✓");
      } catch (error) {
        console.error(error);
        saveButton.textContent = "Save";
        saveButton.disabled = false;
        toast("Could not save profile");
      }
    });
  }

  /* ---------------- sub-page interactions ---------------- */
  function isPrivacyPage() { return subHead.textContent === "Privacy"; }

  function bindSubInteractions() {
    /* toggles */
    $$(".nx-switch input", subBody).forEach((inp) => {
      inp.addEventListener("change", async () => {
        const row = inp.closest(".set-row");
        const key = row.dataset.key;

        if (isPrivacyPage() && key) {
          try {
            await window.netChatUpdateDoc(window.netChatUserRef, {
              [`privacy.${key}`]: inp.checked
            });
            window.netChatUserData.privacy = window.netChatUserData.privacy || {};
            window.netChatUserData.privacy[key] = inp.checked;
            if (key === "typing" && !inp.checked) window.netChatStopTyping?.();
            toast(`${row.querySelector("b").textContent}: ${inp.checked ? "on" : "off"}`);
          } catch (error) {
            console.error("Failed to save privacy setting:", error);
            inp.checked = !inp.checked;
            toast("Could not save setting");
          }
          return;
        }

        store.set(key, inp.checked);
        if (key === "previews") document.documentElement.classList.toggle("hide-chat-previews", !inp.checked);
        if (key === "enterSend") toast("Enter to Send: " + (inp.checked ? "on" : "off"));
        else toast(`${row.querySelector("b").textContent}: ${inp.checked ? "on" : "off"}`);
      });
    });

    /* concrete actions, including account recovery and honest storage data */
    const runAction = async (action, row) => {
      if (action === "openStarred") return window.netChatOpenFeature?.("starred");
      if (action === "openArchived") return window.netChatOpenFeature?.("archived");
      if (action === "openBlocked") return window.netChatOpenFeature?.("blocked");
      if (action === "openCommunities") return window.netChatOpenFeature?.("communities");
      if (action === "activeSessions") return window.netChatOpenFeature?.("linkedDevices");
      if (action === "soundSettings") return window.netChatOpenSoundSettings?.();
      if (action === "groupSettings") { toast("Open a group chat and tap Members to manage its settings"); return; }
      if (action === "resetPassword") {
        const email = window.netChatAuthUser?.email;
        if (!email) return toast("No account email is available");
        row.disabled = true;
        try {
          const { sendPasswordResetEmail } = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js");
          await sendPasswordResetEmail(window.netChatAuth, email);
          toast(`Password reset email sent to ${email}`);
        } catch (error) { console.error(error); toast("Reset email could not be sent. Try again later."); }
        finally { row.disabled = false; }
        return;
      }
      if (action === "exportAccount" || action === "calculateStorage") {
        row.disabled = true;
        try {
          const user = window.netChatAuthUser;
          const chatsSnap = await window.netChatGetDocs(window.netChatQuery(window.netChatCollection(window.netChatDB, "chats"), window.netChatWhere("participants", "array-contains", user.uid)));
          if (action === "exportAccount") {
            const data = { exportedAt: new Date().toISOString(), profile: window.netChatUserData || {}, chats: chatsSnap.docs.map(d => ({ id: d.id, ...d.data() })) };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "netchat-account-backup.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast("Account data downloaded");
          } else {
            let bytes = 0, attachments = 0, unknown = 0;
            for (const chat of chatsSnap.docs) {
              const messages = await window.netChatGetDocs(window.netChatCollection(window.netChatDB, "chats", chat.id, "messages"));
              messages.docs.forEach(message => (message.data().media || []).forEach(media => { attachments++; if (Number(media.bytes) > 0) bytes += Number(media.bytes); else unknown++; }));
            }
            const mb = bytes / 1024 / 1024;
            row.querySelector("small").textContent = `${attachments} attachments · ${mb.toFixed(1)} MB known${unknown ? ` · ${unknown} without size metadata` : ""}`;
            toast("Media usage calculated from attachment metadata");
          }
        } catch (error) { console.error(error); toast("Could not complete the request. Check connection and permissions."); }
        finally { row.disabled = false; }
        return;
      }
      if (["showTerms", "showPrivacy", "showLicenses"].includes(action)) {
        const documents = {
          showTerms: ["Terms of Service", "Use NetChat lawfully and respectfully. Keep your credentials confidential. You retain ownership of your content and grant the service permission to store and deliver it. Abuse, malware and harassment are prohibited."],
          showPrivacy: ["Privacy Policy", "NetChat stores account profiles, chats and attachment metadata in Firebase. Media is uploaded to Cloudinary. Presence and typing use Firebase Realtime Database. Device-only appearance and sound preferences use local storage. You can export account metadata from Account settings."],
          showLicenses: ["Open-Source Licenses", "Firebase JS SDK: Apache License 2.0. Material Symbols: Apache License 2.0. NetChat application code and generated fallback avatar are supplied with this project. Cloudinary is an external service subject to its own terms."]
        };
        const [title, copy] = documents[action]; subHead.textContent = title;
        subBody.innerHTML = `<div class="set-group"><div class="set-row" style="cursor:default;display:block;line-height:1.7"><span class="meta"><b>${title}</b><small style="white-space:normal;display:block;margin-top:12px">${copy}</small></span></div></div>`;
        return;
      }
    };
    $$('[data-action]', subBody).forEach((row) => row.addEventListener("click", (event) => {
      const action = row.dataset.action;
      if (!["editProfile", "changeProfilePicture", "clearCache"].includes(action)) { event.preventDefault(); event.stopImmediatePropagation(); runAction(action, row); }
    }, true));

    /* nav rows: route supported settings to real screens/actions */
    $$("[data-toast]", subBody).forEach((b) => b.addEventListener("click", async () => {
      const label = b.querySelector(".meta b")?.textContent?.trim() || "";
      const lower = label.toLowerCase();
      if (lower.includes("starred messages")) return window.netChatOpenFeature?.("starred");
      if (lower.includes("archived chats")) return window.netChatOpenFeature?.("archived");
      if (lower.includes("blocked users")) return window.netChatOpenFeature?.("blocked");
      if (lower === "connections") return window.netChatOpenFeature?.("communities");
      if (lower.includes("request account data") || lower.includes("chat backup")) {
        try {
          const user = window.netChatAuthUser;
          if (!user) return toast("Sign in first");
          const profile = window.netChatUserData || {};
          const chatsSnap = await window.netChatGetDocs(window.netChatQuery(window.netChatCollection(window.netChatDB, "chats"), window.netChatWhere("participants", "array-contains", user.uid)));
          const data = { exportedAt: new Date().toISOString(), profile, chats: chatsSnap.docs.map(d => ({ id: d.id, ...d.data() })) };
          const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download="netchat-account-backup.json"; a.click(); URL.revokeObjectURL(url); toast("Account data downloaded");
        } catch (error) { console.error(error); toast("Could not export account data"); }
        return;
      }
      if (lower.includes("clear cache")) {
        try { if ("caches" in window) await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch {}
        toast("App cache cleared"); return;
      }
      if (lower.includes("help center") || lower.includes("contact netchat support") || lower.includes("report a problem")) {
        toast(lower.includes("report") ? "Use the Report option inside a chat to submit a report." : "Help: check your connection, sign-in, and Firestore permissions first."); return;
      }
      toast(b.dataset.toast || `${label} is not connected yet`);
    }));

    /* actions */
    $$("[data-action]", subBody).forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.action === "editProfile") {
          closeSub();
          openEditProfile();
        }
        if (b.dataset.action === "changeProfilePicture") {
          $("#fileInput")?.click();
        }
        if (b.dataset.action === "clearCache") {
          if ("caches" in window) {
            caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
          }
          toast("Cache cleared ✦");
        }
      });
    });

    /* chips */
    $$("[data-chips]", subBody).forEach((box) => {
      const key = box.dataset.chips;
      $$(".choice-chip", box).forEach((chip) => {
        chip.addEventListener("click", async () => {
          $$(".choice-chip", box).forEach((c) => c.classList.remove("on"));
          chip.classList.add("on");

          if (isPrivacyPage()) {
            try {
              await window.netChatUpdateDoc(window.netChatUserRef, {
                [`privacy.${key}`]: chip.dataset.val
              });
              window.netChatUserData.privacy = window.netChatUserData.privacy || {};
              window.netChatUserData.privacy[key] = chip.dataset.val;
              toast(`${chip.dataset.val} selected`);
            } catch (error) {
              console.error("Failed to save privacy setting:", error);
              toast("Could not save setting");
            }
            return;
          }

          store.set(key, chip.dataset.val);

          /* live-apply the visible preferences */
          if (key === "fontSize") {
            document.documentElement.style.fontSize = FONT_SIZES[chip.dataset.val] || FONT_SIZES.Default;
          }
          toast(`${chip.dataset.val} selected`);
        });
      });
    });

    /* radio cards (theme) */
    $$("[data-radio]", subBody).forEach((box) => {
      const key = box.dataset.radio;
      $$(".radio-card", box).forEach((card) => card.addEventListener("click", () => {
        $$(".radio-card", box).forEach((c) => c.classList.remove("on"));
        card.classList.add("on");
        store.set(key, card.dataset.val);
        if (key === "theme") {
          document.documentElement.style.setProperty("--wa-bg-dark", THEMES[card.dataset.val] || THEMES.midnight);
        }
        toast(`${card.querySelector("b").textContent} applied ✦`);
      }));
    });

    /* swatches (accent + wallpaper) */
    $$("[data-swatches]", subBody).forEach((box) => {
      const key = box.dataset.swatches;
      $$(".swatch", box).forEach((sw) => sw.addEventListener("click", () => {
        $$(".swatch", box).forEach((s) => { s.classList.remove("on"); s.innerHTML = ""; });
        sw.classList.add("on");
        sw.innerHTML = icon("check");
        store.set(key, sw.dataset.val);

        if (key === "accent") {
          document.documentElement.style.setProperty("--wa-neon-blue", sw.dataset.val);
        }
        if (key === "wallpaper") {
          document.querySelector(".chat-messages-body")?.style.setProperty("background-color", sw.dataset.val);
        }
        toast("Saved ✦");
      }));
    });
  }

  /* ============================================================
     LOGOUT
     ============================================================ */
  const logoutModal = $("#logoutModal");

  $("#logoutBtn")?.addEventListener("click", () => logoutModal.classList.add("show"));
  $("#logoutCancel")?.addEventListener("click", () => logoutModal.classList.remove("show"));
  logoutModal?.addEventListener("click", (e) => {
    if (e.target === logoutModal) logoutModal.classList.remove("show");
  });

  $("#logoutConfirm")?.addEventListener("click", async () => {
    logoutModal.classList.remove("show");
    closeSettings();
    try {
      await window.signOut(window.netChatAuth);
      Object.keys(localStorage).filter(k => k.startsWith("nx:")).forEach(k => localStorage.removeItem(k));
    } catch {}
    toast("Logged out — see you soon ✦");
    setTimeout(() => { location.href = "auth.html"; }, 700);
  });

  /* ---------------- keyboard ---------------- */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (logoutModal?.classList.contains("show")) logoutModal.classList.remove("show");
    else if (subPage.classList.contains("open")) closeSub();
    else if (settingsPage.classList.contains("open")) closeSettings();
    else if (menuPop?.classList.contains("open")) closeMenu();
  });
})();
