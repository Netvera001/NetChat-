import {
  doc, getDoc, getDocs, updateDoc, collection, onSnapshot,
  serverTimestamp, arrayUnion, arrayRemove, addDoc, deleteField
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const icon = name => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const me = () => window.netChatAuthUser?.uid || "";

const state = {
  chatId: null,
  target: null,
  group: null,
  view: "info",
  previousView: "info",
  history: [],
  groupUnsubscribe: null,
  typingUnsubscribe: null,
  presenceUnsubscribe: null,
  presence: {},
  presenceReady: false,
  profiles: new Map(),
  renderId: 0,
  memberFilter: "all",
  dialogAction: null
};

const screen = $("#groupInfoScreen");
const body = $("#groupInfoBody");
const title = $("#groupInfoTitle");
const dialog = $("#groupInfoDialog");

function toast(message, duration = 2800) {
  let element = $("#ncsToast");
  if (!element) {
    element = document.createElement("div");
    element.id = "ncsToast";
    element.className = "ncs-toast";
    element.setAttribute("role", "status");
    document.body.appendChild(element);
  }
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(element._timer);
  element._timer = setTimeout(() => element.classList.remove("show"), duration);
}

function groupRef() {
  return state.chatId ? doc(window.netChatDB, "chats", state.chatId) : null;
}
function groupName() {
  return state.group?.groupName || state.group?.name || state.target?.groupName || state.target?.userFullname || "Group chat";
}
function groupDescription() {
  return state.group?.groupDescription || state.group?.description || "No group description yet.";
}
function participants() {
  return state.group?.participants || state.target?.participants || [];
}
function admins() {
  return [...new Set([state.group?.createdBy, ...(state.group?.admins || [])].filter(Boolean))];
}
function isAdmin() {
  return state.group?.createdBy === me() || admins().includes(me());
}
function isCreator() {
  return state.group?.createdBy === me() || state.group?.ownerId === me();
}
function canEditInfo() {
  return isAdmin() || state.group?.memberCanEditInfo === true;
}
function canAddMembers() {
  return isAdmin() || state.group?.memberCanAddOthers === true;
}
function onlineCount() {
  return participants().filter(member => state.presence[member]?.online === true).length;
}
function countLabel() {
  const count = participants().length;
  return `${count} member${count === 1 ? "" : "s"}${state.presenceReady ? ` · ${onlineCount()} online` : ""}`;
}
function muted() {
  return (state.group?.mutedBy || []).includes(me()) || localStorage.getItem(`nc:muted:${state.chatId}`) === "1";
}
function avatar(profile) {
  return esc(profile?.profileImage || "default-avatar.png");
}
function displayName(profile, uid) {
  if (uid === me()) return "You";
  return profile?.userFullname || profile?.name || "NetChat User";
}

async function getProfile(uid) {
  if (!uid) return { uid: "", userFullname: "NetChat User", profileImage: "" };
  if (state.profiles.has(uid)) return state.profiles.get(uid);
  let profile;
  if (uid === me() && window.netChatUserData) {
    profile = { uid, ...window.netChatUserData };
  } else if (window.netChatGetSenderProfile) {
    profile = await window.netChatGetSenderProfile(uid);
  } else {
    const snapshot = await getDoc(doc(window.netChatDB, "user", uid)).catch(() => null);
    profile = { uid, ...(snapshot?.exists() ? snapshot.data() : {}) };
  }
  state.profiles.set(uid, profile);
  return profile;
}

async function memberProfiles(list = participants()) {
  return Promise.all(list.map(async uid => ({ uid, ...(await getProfile(uid)) })));
}

function ensureConversationExtras() {
  const header = $(".chat-header");
  if (header && !$(".group-pinned")) {
    const pinned = document.createElement("button");
    pinned.type = "button";
    pinned.className = "group-pinned";
    pinned.id = "groupPinned";
    pinned.innerHTML = `${icon("push_pin")}<span><b>Welcome to the group</b><small></small></span>${icon("close")}`;
    header.insertAdjacentElement("afterend", pinned);
    pinned.addEventListener("click", event => {
      if (event.target.closest(".material-symbols-outlined")?.textContent === "close") {
        localStorage.setItem(`nc:pinned-dismissed:${state.chatId}`, "1");
        pinned.hidden = true;
      } else openGroupInfo("description");
    });
  }
  const messages = $("#chatMessagesBody");
  if (messages && !$("#groupTypingIndicator")) {
    const typing = document.createElement("div");
    typing.id = "groupTypingIndicator";
    typing.className = "group-typing-indicator";
    typing.hidden = true;
    messages.insertAdjacentElement("afterend", typing);
  }
}

function updatePinned() {
  const pinned = $("#groupPinned");
  if (!pinned || !state.target?.isGroup) return;
  pinned.hidden = localStorage.getItem(`nc:pinned-dismissed:${state.chatId}`) === "1";
  $("b", pinned).textContent = `Welcome to ${groupName()}!`;
  $("small", pinned).textContent = groupDescription();
}

function cleanupGroupListeners() {
  state.groupUnsubscribe?.();
  state.typingUnsubscribe?.();
  state.presenceUnsubscribe?.();
  state.groupUnsubscribe = null;
  state.typingUnsubscribe = null;
  state.presenceUnsubscribe = null;
}

async function setConversation(conversationId, target) {
  if (state.chatId === conversationId && state.target === target) return;
  cleanupGroupListeners();
  closeGroupInfo();
  state.chatId = conversationId;
  state.target = target;
  state.group = target?.isGroup ? target : null;
  state.presence = {};
  state.presenceReady = false;
  window.netChatGroupSuite?.setContext(conversationId, target);
  $("#groupPinned")?.remove();
  $("#groupTypingIndicator")?.remove();
  if (!conversationId || !target?.isGroup || !window.netChatDB) return;
  ensureConversationExtras();
  state.groupUnsubscribe = onSnapshot(groupRef(), snapshot => {
    state.group = snapshot.exists() ? snapshot.data() : null;
    if (state.group && state.target) {
      Object.assign(state.target, {
        ...state.group,
        groupName: state.group.groupName || state.target.groupName,
        profileImage: state.group.groupImage || "",
        userFullname: state.group.groupName || state.target.userFullname
      });
    }
    updatePinned();
    window.netChatGroupSuite?.updateGroupStatus();
    if (screen.classList.contains("open")) render();
    if (state.group?.groupDeleted) {
      closeGroupInfo();
      $("#closeChatBtn")?.click();
      toast("This group was deleted");
    }
  }, error => {
    console.error("Group information sync failed:", error);
    toast("Could not sync this group. Check your Firebase rules.");
  });
  if (window.netChatRealtimeDB) {
    state.presenceUnsubscribe = onValue(ref(window.netChatRealtimeDB, "presence"), snapshot => {
      state.presence = snapshot.val() || {};
      state.presenceReady = true;
      if (screen.classList.contains("open")) render();
    }, () => {});
    state.typingUnsubscribe = onValue(ref(window.netChatRealtimeDB, `typing/${conversationId}`), async snapshot => {
      const values = snapshot.val() || {};
      const active = Object.entries(values).filter(([uid, value]) => uid !== me() && (value === true || (value?.active && Date.now() - Number(value.updatedAt || 0) < 6000)));
      const typing = $("#groupTypingIndicator");
      if (!typing) return;
      if (!active.length) {
        typing.hidden = true;
        window.netChatGroupSuite?.updateGroupStatus();
        return;
      }
      const names = await Promise.all(active.map(async ([uid]) => displayName(await getProfile(uid), uid)));
      const phrase = names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : `${names[0]} and ${names.length - 1} others are typing…`;
      typing.innerHTML = `<span>${esc(phrase)}</span><span class="group-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
      typing.hidden = false;
      $("#chatUserStatus").textContent = phrase;
      window.netChatGroupSuite?.notifyTyping(conversationId);
    }, () => {});
  }
}

function openGroupInfo(view = "info") {
  if (!state.chatId || !state.target?.isGroup) return toast("Open a group conversation first");
  state.previousView = "info";
  state.history = [];
  state.view = view;
  screen.classList.add("open");
  screen.setAttribute("aria-hidden", "false");
  document.body.classList.add("group-info-open");
  render();
}

function closeGroupInfo() {
  screen?.classList.remove("open");
  screen?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("group-info-open");
  closeDialog();
}

function navigate(view) {
  if (view === state.view) return render();
  state.history.push(state.view);
  state.previousView = state.view;
  state.view = view;
  state.memberFilter = "all";
  render();
  $(".group-info-body")?.scrollTo({ top: 0, behavior: "instant" });
}

function goBack() {
  if (state.view === "info") return closeGroupInfo();
  const previous = state.history.pop() || "info";
  state.previousView = state.view;
  state.view = previous;
  state.memberFilter = "all";
  render();
  $(".group-info-body")?.scrollTo({ top: 0, behavior: "instant" });
}

function headerFor(view) {
  return ({
    info: "Group Info", admin: "Admin Panel", members: "Manage Members", settings: "Group Settings",
    description: "Group Description", photo: "Group Photo", search: "Search Messages", media: "Media, Links & Docs",
    starred: "Starred Messages", disappearing: "Disappearing Messages", add: "Add Members", announcements: "Send Announcement",
    report: "Report Group"
  })[view] || "Group Info";
}

async function render() {
  if (!state.group || !screen.classList.contains("open")) return;
  const renderId = ++state.renderId;
  title.textContent = headerFor(state.view);
  $("#groupInfoMore").hidden = state.view !== "info";
  body.setAttribute("aria-busy", "true");
  try {
    if (state.view === "info") await renderInfo(renderId);
    else if (state.view === "admin") await renderAdmin(renderId);
    else if (state.view === "members") await renderMembers(renderId);
    else if (state.view === "settings") renderSettings();
    else if (state.view === "description") renderDescription();
    else if (state.view === "photo") renderPhoto();
    else if (state.view === "search") renderSearch();
    else if (state.view === "media") renderMedia();
    else if (state.view === "starred") renderStarred();
    else if (state.view === "disappearing") renderDisappearing();
    else if (state.view === "add") await renderAddMembers(renderId);
    else if (state.view === "announcements") renderAnnouncements();
    else if (state.view === "report") renderReport();
  } catch (error) {
    console.error("Group screen render failed:", error);
    body.innerHTML = `<div class="gi-state">${icon("cloud_off")}<h3>Could not load this screen</h3><p>${esc(error.message || "Check your connection and try again.")}</p><button class="gi-primary" data-action="retry">Try again</button></div>`;
  } finally {
    if (renderId === state.renderId) body.setAttribute("aria-busy", "false");
  }
}

function groupHero(compact = false) {
  return `<div class="gi-group-hero ${compact ? "compact" : ""}">
    <button type="button" class="gi-avatar-button" data-view="photo" aria-label="View or change group photo"><span class="gi-group-avatar"><img src="${esc(state.group.groupImage || "default-avatar.png")}" alt="${esc(groupName())}">${canEditInfo() ? `<i>${icon("photo_camera")}</i>` : ""}</span></button>
    <div class="gi-hero-copy"><h3>${esc(groupName())}</h3><p>${esc(countLabel())}</p>${!compact ? `<span>${esc(groupDescription())}</span>` : ""}</div>
  </div>`;
}

function actionRow({ id = "", view = "", action = "", iconName, label, description = "", value = "", danger = false, toggle = null, disabled = false }) {
  const content = `${icon(iconName)}<span class="gi-row-copy"><b>${esc(label)}</b>${description ? `<small>${esc(description)}</small>` : ""}</span>${toggle !== null ? `<span class="gi-switch ${toggle ? "on" : ""}" aria-hidden="true"><i></i></span>` : `${value ? `<span class="gi-row-value">${esc(value)}</span>` : ""}${!toggle && !danger ? icon("chevron_right") : ""}`}`;
  if (toggle !== null) return `<div class="gi-row gi-toggle-row ${danger ? "danger" : ""}"><span class="gi-row-main">${content}</span><label class="gi-toggle-input"><input type="checkbox" data-setting="${esc(id)}" ${toggle ? "checked" : ""} ${disabled ? "disabled" : ""} aria-label="${esc(label)}"></label></div>`;
  return `<button type="button" class="gi-row ${danger ? "danger" : ""}" ${view ? `data-view="${view}"` : ""} ${action ? `data-action="${action}"` : ""} ${disabled ? "disabled" : ""}>${content}</button>`;
}

function memberRow(profile, detailed = false) {
  const admin = admins().includes(profile.uid) || state.group.createdBy === profile.uid;
  const online = state.presence[profile.uid]?.online === true;
  const lastSeen = state.presence[profile.uid]?.lastSeen;
  const status = online ? "Online" : lastSeen ? `Last seen ${new Date(lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Member";
  return `<article class="gi-member" data-member-row="${esc(profile.uid)}">
    <button type="button" class="gi-member-profile" data-action="member-actions" data-uid="${esc(profile.uid)}"><img src="${avatar(profile)}" alt=""><span><b>${esc(displayName(profile, profile.uid))}</b><small class="${online ? "online" : ""}">${esc(status)}</small></span></button>
    ${admin ? `<span class="gi-admin-badge">Admin</span>` : ""}
    ${detailed && profile.uid !== me() ? `<button type="button" class="gi-member-menu" data-action="member-actions" data-uid="${esc(profile.uid)}" aria-label="Member actions">${icon("more_vert")}</button>` : ""}
  </article>`;
}

async function renderInfo(renderId) {
  const profiles = await memberProfiles();
  if (renderId !== state.renderId) return;
  const docs = window.currentChatSnapshotDocs || [];
  const mediaCount = docs.reduce((total, item) => total + (item.data().media || []).filter(item => item.url).length + (item.data().attachment?.url ? 1 : 0), 0);
  const starredCount = docs.filter(item => item.data().stars?.[me()] === true || item.data().starredBy?.includes?.(me())).length;
  const quick = [
    ["add", "person_add", "Add Members", canAddMembers()],
    ["search", "search", "Search", true],
    ["mute", muted() ? "notifications_off" : "notifications", muted() ? "Unmute" : "Mute", true],
    ["admin", "more_horiz", "More", true]
  ];
  body.innerHTML = `${groupHero()}
    <div class="gi-quick-actions">${quick.filter(([, , , enabled]) => enabled).map(([view, iconName, label]) => `<button type="button" ${view === "mute" ? 'data-action="toggle-mute"' : view === "admin" ? 'data-action="open-more"' : `data-view="${view}"`}>${icon(iconName)}<span>${label}</span></button>`).join("")}</div>
    <section class="gi-section">
      ${actionRow({ view: "description", iconName: "chat_bubble", label: "Group Description", description: groupDescription() })}
      ${actionRow({ action: "toggle-mute", iconName: muted() ? "notifications_off" : "notifications", label: "Notifications", value: muted() ? "Off" : "On" })}
      ${actionRow({ view: "media", iconName: "photo_library", label: "Media, Links & Docs", value: `${mediaCount} items` })}
      ${actionRow({ view: "starred", iconName: "star", label: "Starred Messages", value: `${starredCount} items` })}
      ${actionRow({ view: "disappearing", iconName: "history", label: "Disappearing Messages", value: disappearingLabel() })}
    </section>
    <section class="gi-members-section"><div class="gi-section-heading"><h4>Members (${profiles.length})</h4>${canAddMembers() ? `<button type="button" data-view="add">${icon("person_add")} Invite</button>` : ""}</div>
      <div class="gi-member-list">${profiles.slice(0, 5).map(profile => memberRow(profile)).join("")}</div>
      <button type="button" class="gi-see-all" data-view="members">See all members ${icon("chevron_right")}</button>
    </section>
    <section class="gi-section gi-info-footer">
      ${isAdmin() ? actionRow({ view: "admin", iconName: "admin_panel_settings", label: "Admin Panel", description: "Manage members, permissions and group settings" }) : ""}
      ${actionRow({ action: "report", iconName: "report", label: "Report Group", description: "Report inappropriate content", danger: true })}
      ${actionRow({ action: isCreator() ? "delete-group" : "leave-group", iconName: isCreator() ? "delete" : "logout", label: isCreator() ? "Delete Group" : "Leave Group", description: isCreator() ? "This action cannot be undone" : "You will stop receiving group messages", danger: true })}
    </section>`;
}

async function renderAdmin(renderId) {
  if (!isAdmin()) return navigate("info");
  const profiles = await memberProfiles();
  if (renderId !== state.renderId) return;
  body.innerHTML = `${groupHero(true)}
    <div class="gi-admin-card">${icon("workspace_premium")}<span><b>Group Admin</b><small>Manage group settings, members and permissions.</small></span></div>
    <section class="gi-section">
      ${actionRow({ view: "members", iconName: "group", label: "Manage Members", description: `${profiles.length} members · ${admins().length} admins` })}
      ${actionRow({ view: "settings", iconName: "settings", label: "Group Settings", description: "Control group features and permissions" })}
      ${actionRow({ view: "description", iconName: "edit_note", label: "Group Description", description: "Edit group description" })}
      ${actionRow({ view: "photo", iconName: "photo_camera", label: "Group Photo", description: "Change group photo" })}
      ${actionRow({ id: "onlyAdminsCanMessage", iconName: "lock_person", label: "Only Admins Can Message", description: "When enabled, only admins can send messages", toggle: state.group.onlyAdminsCanMessage === true })}
      ${actionRow({ id: "memberCanAddOthers", iconName: "group_add", label: "Allow All Members to Add Others", description: "When disabled, only admins can add members", toggle: state.group.memberCanAddOthers === true })}
      ${actionRow({ view: "announcements", iconName: "campaign", label: "Send Announcements", description: "Send a message to all members" })}
      ${actionRow({ action: "report", iconName: "report", label: "Report Group", description: "Report inappropriate content", danger: true })}
    </section>
    <section class="gi-section gi-info-footer">${actionRow({ action: isCreator() ? "delete-group" : "leave-group", iconName: "delete", label: isCreator() ? "Delete Group" : "Leave Admin Group", description: isCreator() ? "This action cannot be undone" : "Leave this group and its admin team", danger: true })}</section>`;
}

async function renderMembers(renderId) {
  let profiles = await memberProfiles();
  if (renderId !== state.renderId) return;
  if (state.memberFilter === "admins") profiles = profiles.filter(profile => admins().includes(profile.uid));
  body.innerHTML = `<div class="gi-member-tools"><label class="gi-search">${icon("search")}<input id="giMemberSearch" type="search" placeholder="Search members" autocomplete="off"></label>${canAddMembers() ? `<button type="button" class="gi-icon-action" data-view="add" aria-label="Add members">${icon("person_add")}</button>` : ""}</div>
    <div class="gi-tabs" role="tablist"><button type="button" class="${state.memberFilter === "all" ? "active" : ""}" data-action="member-filter" data-filter="all">Members (${participants().length})</button><button type="button" class="${state.memberFilter === "admins" ? "active" : ""}" data-action="member-filter" data-filter="admins">Admins (${admins().length})</button></div>
    <div class="gi-member-list gi-member-list-full">${profiles.length ? profiles.map(profile => memberRow(profile, true)).join("") : `<div class="gi-empty">No members in this view.</div>`}</div>
    ${canAddMembers() ? `<button type="button" class="gi-primary gi-sticky-cta" data-view="add">${icon("person_add")} Add Members</button>` : `<p class="gi-permission-note">Only group admins can add new members.</p>`}`;
  $("#giMemberSearch")?.addEventListener("input", event => {
    const term = event.target.value.trim().toLowerCase();
    $$("[data-member-row]", body).forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(term); });
  });
}

function renderSettings() {
  body.innerHTML = `<form id="giBasicSettings" class="gi-form"><h4>Basic Information</h4><label>Group Name<input name="name" maxlength="60" required value="${esc(groupName())}" ${canEditInfo() ? "" : "disabled"}></label><label>Group Description<textarea name="description" maxlength="240" ${canEditInfo() ? "" : "disabled"}>${esc(groupDescription())}</textarea></label>${canEditInfo() ? `<button class="gi-primary" type="submit">${icon("save")} Save Basic Information</button>` : `<p class="gi-permission-note">Only admins can edit basic group information.</p>`}</form>
    <section class="gi-settings-block"><h4>Permissions</h4><div class="gi-section">
      ${actionRow({ id: "onlyAdminsCanMessage", iconName: "lock_person", label: "Only Admins Can Message", toggle: state.group.onlyAdminsCanMessage === true, disabled: !isAdmin() })}
      ${actionRow({ id: "memberCanAddOthers", iconName: "group_add", label: "Allow All Members to Add Others", toggle: state.group.memberCanAddOthers === true, disabled: !isAdmin() })}
      ${actionRow({ id: "memberCanEditInfo", iconName: "edit", label: "Allow Members to Edit Info", toggle: state.group.memberCanEditInfo === true, disabled: !isAdmin() })}
    </div></section>
    <section class="gi-settings-block"><h4>Features</h4><div class="gi-section">${actionRow({ view: "announcements", iconName: "campaign", label: "Send Announcements", disabled: !isAdmin() })}${actionRow({ view: "disappearing", iconName: "history", label: "Disappearing Messages", value: disappearingLabel(), disabled: !isAdmin() })}</div></section>
    <section class="gi-settings-block"><h4>Privacy & Discovery</h4><div class="gi-section">
      ${actionRow({ id: "showInDirectory", iconName: "travel_explore", label: "Show Group in Directory", toggle: state.group.showInDirectory === true, disabled: !isAdmin() })}
      ${actionRow({ id: "searchableByNonMembers", iconName: "search", label: "Allow Search by Non-Members", toggle: state.group.searchableByNonMembers === true, disabled: !isAdmin() })}
    </div><p class="gi-permission-note">Directory controls are saved to the group. A public directory must query these fields and enforce them in Firebase rules.</p></section>`;
  $("#giBasicSettings")?.addEventListener("submit", saveBasicInfo);
}

function renderDescription() {
  body.innerHTML = `<div class="gi-description-hero">${icon("forum")}<h3>What is this group about?</h3><p>A clear description helps members understand the space.</p></div><form id="giDescriptionForm" class="gi-form"><label>Group Description<textarea id="giDescriptionInput" maxlength="240" rows="6" ${canEditInfo() ? "" : "disabled"}>${esc(groupDescription() === "No group description yet." ? "" : groupDescription())}</textarea><small><span id="giDescriptionCount">${groupDescription().length}</span>/240</small></label>${canEditInfo() ? `<button class="gi-primary" type="submit">${icon("save")} Save Description</button>` : `<p class="gi-permission-note">You do not have permission to edit this description.</p>`}</form>`;
  $("#giDescriptionInput")?.addEventListener("input", event => { $("#giDescriptionCount").textContent = event.target.value.length; });
  $("#giDescriptionForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const value = $("#giDescriptionInput").value.trim();
    await saveGroup({ groupDescription: value }, "Group description updated");
    goBack();
  });
}

function renderPhoto() {
  body.innerHTML = `<div class="gi-photo-stage"><div class="gi-photo-ring"><img src="${esc(state.group.groupImage || "default-avatar.png")}" alt="${esc(groupName())} group photo"></div><h3>${esc(groupName())}</h3><p>Group photos help everyone recognise this conversation.</p></div>
    ${canEditInfo() ? `<section class="gi-section gi-photo-actions"><label class="gi-row">${icon("photo_camera")}<span class="gi-row-copy"><b>Take Photo</b><small>Use your device camera</small></span><input id="giCameraInput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></label><label class="gi-row">${icon("photo_library")}<span class="gi-row-copy"><b>Choose from Gallery</b><small>JPG, PNG or WebP · up to 5 MB</small></span><input id="giGalleryInput" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${state.group.groupImage ? actionRow({ action: "remove-photo", iconName: "delete", label: "Remove Photo", danger: true }) : ""}</section><div class="gi-upload-progress" id="giUploadProgress" hidden><i></i><span>Uploading group photo…</span></div>` : `<p class="gi-permission-note">Only members with edit permission can change the group photo.</p>`}`;
  $("#giCameraInput")?.addEventListener("change", event => uploadGroupPhoto(event.target.files[0]));
  $("#giGalleryInput")?.addEventListener("change", event => uploadGroupPhoto(event.target.files[0]));
}

function messageLabel(data) {
  return data.text || data.poll?.question || (data.type === "voice" ? "Voice note" : data.attachment?.fileName || (data.media?.length ? "Media message" : "Message"));
}
function messageTime(data) {
  return data.timestamp?.toDate ? data.timestamp.toDate().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

function renderSearch(results = null) {
  const docs = results || [...(window.currentChatSnapshotDocs || [])].reverse();
  body.innerHTML = `<label class="gi-search gi-search-page">${icon("search")}<input id="giMessageSearch" type="search" placeholder="Search this group" autocomplete="off" autofocus></label><p class="gi-search-hint">Search message text, poll questions, documents and voice notes.</p><div class="gi-search-results">${docs.length ? docs.map(item => searchResult(item)).join("") : `<div class="gi-state">${icon("search_off")}<h3>No messages found</h3><p>Try another keyword.</p></div>`}</div>`;
  const input = $("#giMessageSearch");
  input?.addEventListener("input", () => {
    const term = input.value.trim().toLowerCase();
    const matches = [...(window.currentChatSnapshotDocs || [])].reverse().filter(item => messageLabel(item.data()).toLowerCase().includes(term));
    $(".gi-search-results", body).innerHTML = matches.length ? matches.map(item => searchResult(item)).join("") : `<div class="gi-state">${icon("search_off")}<h3>No messages found</h3><p>Try another keyword.</p></div>`;
  });
}
function searchResult(item) {
  const data = item.data();
  const profile = state.profiles.get(data.senderId);
  return `<button type="button" class="gi-search-result" data-action="jump-message" data-message-id="${esc(item.id)}"><span class="gi-result-icon">${icon(data.type === "voice" ? "mic" : data.media?.length ? "image" : "chat_bubble")}</span><span><b>${esc(displayName(profile, data.senderId))}</b><p>${esc(messageLabel(data))}</p><small>${esc(messageTime(data))}</small></span>${icon("chevron_right")}</button>`;
}

function renderMedia() {
  const entries = [];
  (window.currentChatSnapshotDocs || []).forEach(item => {
    const data = item.data();
    (data.media || []).forEach(media => { if (media.url) entries.push({ ...media, senderId: data.senderId, timestamp: data.timestamp }); });
    if (data.attachment?.url) entries.push({ ...data.attachment, resourceType: "document", senderId: data.senderId, timestamp: data.timestamp });
  });
  body.innerHTML = `<div class="gi-media-summary"><span><b>${entries.length}</b><small>Shared items</small></span><span><b>${entries.filter(item => item.resourceType === "image").length}</b><small>Photos</small></span><span><b>${entries.filter(item => ["document", "audio"].includes(item.resourceType)).length}</b><small>Files</small></span></div><div class="gi-media-list">${entries.length ? entries.reverse().map(item => `<a class="gi-media-item" href="${esc(item.url)}" target="_blank" rel="noopener"><span class="gi-media-thumb">${item.resourceType === "image" ? `<img src="${esc(item.url)}" alt="Shared media">` : icon(item.resourceType === "video" ? "play_circle" : "description")}</span><span><b>${esc(item.fileName || (item.resourceType === "video" ? "Video" : item.resourceType === "image" ? "Photo" : "Document"))}</b><small>${esc(messageTime(item))} · Open securely</small></span>${icon("open_in_new")}</a>`).join("") : `<div class="gi-state">${icon("photo_library")}<h3>No shared media yet</h3><p>Photos, videos and documents shared in this group will appear here.</p></div>`}</div>`;
}

function renderStarred() {
  const docs = (window.currentChatSnapshotDocs || []).filter(item => item.data().stars?.[me()] === true || item.data().starredBy?.includes?.(me()));
  body.innerHTML = `<div class="gi-search-results">${docs.length ? docs.reverse().map(item => searchResult(item)).join("") : `<div class="gi-state">${icon("star")}<h3>No starred messages</h3><p>Long-press a message and choose Star to keep it here.</p></div>`}</div>`;
}

function disappearingLabel() {
  const seconds = Number(state.group?.disappearingSeconds || 0);
  return ({ 0: "Off", 3600: "1 hour", 86400: "24 hours", 604800: "7 days" })[seconds] || "Off";
}
function renderDisappearing() {
  const current = Number(state.group.disappearingSeconds || 0);
  const options = [[0, "Off", "Messages remain in the chat"], [3600, "1 hour", "New messages disappear after 1 hour"], [86400, "24 hours", "New messages disappear after 24 hours"], [604800, "7 days", "New messages disappear after 7 days"]];
  body.innerHTML = `<div class="gi-description-hero">${icon("history")}<h3>Disappearing messages</h3><p>This timer applies to new messages. Existing messages are not changed.</p></div><section class="gi-section">${options.map(([seconds, label, description]) => `<button type="button" class="gi-choice ${current === seconds ? "selected" : ""}" data-action="set-disappearing" data-seconds="${seconds}" ${!isAdmin() ? "disabled" : ""}><span><b>${label}</b><small>${description}</small></span>${icon(current === seconds ? "check_circle" : "radio_button_unchecked")}</button>`).join("")}</section>${!isAdmin() ? `<p class="gi-permission-note">Only group admins can change this timer.</p>` : ""}`;
}

async function renderAddMembers(renderId) {
  if (!canAddMembers()) return navigate("members");
  let contacts = [];
  const snapshot = await getDocs(collection(window.netChatDB, "user", me(), "contacts"));
  contacts = (await Promise.all(snapshot.docs.map(async item => {
    const relation = item.data();
    if (relation.status && relation.status !== "accepted") return null;
    const uid = relation.uid || relation.contactUid || relation.userId || item.id;
    if (uid === me()) return null;
    return { uid, ...(await getProfile(uid)) };
  }))).filter(Boolean);
  if (renderId !== state.renderId) return;
  body.innerHTML = `<div class="gi-description-hero compact">${icon("group_add")}<h3>Add people to ${esc(groupName())}</h3><p>Select contacts to add them directly to this group.</p></div><form id="giAddMembersForm" class="gi-form"><label class="gi-search">${icon("search")}<input id="giAddSearch" type="search" placeholder="Search contacts"></label><div class="gi-contact-picker">${contacts.length ? contacts.map(profile => `<label class="gi-contact" data-contact-row><input type="checkbox" name="member" value="${esc(profile.uid)}" ${participants().includes(profile.uid) ? "disabled" : ""}><img src="${avatar(profile)}" alt=""><span><b>${esc(displayName(profile, profile.uid))}</b><small>${participants().includes(profile.uid) ? "Already in this group" : esc(profile.netChatID || "NetChat contact")}</small></span>${icon(participants().includes(profile.uid) ? "check_circle" : "add_circle")}</label>`).join("") : `<div class="gi-state">${icon("person_search")}<h3>No contacts available</h3><p>Add contacts in NetChat first, then return here.</p></div>`}</div><p class="gi-form-error" id="giAddError" role="alert"></p><button class="gi-primary" type="submit">${icon("group_add")} Add Selected Members</button></form>`;
  $("#giAddSearch")?.addEventListener("input", event => {
    const term = event.target.value.toLowerCase();
    $$("[data-contact-row]", body).forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(term); });
  });
  $("#giAddMembersForm")?.addEventListener("submit", addSelectedMembers);
}

function renderAnnouncements() {
  body.innerHTML = `<div class="gi-description-hero">${icon("campaign")}<h3>Announce to the whole group</h3><p>Your announcement will be sent as a highlighted message to all ${participants().length} members.</p></div><form id="giAnnouncementForm" class="gi-form"><label>Announcement<textarea id="giAnnouncementText" rows="6" maxlength="1000" required placeholder="Write something important…"></textarea></label><p class="gi-form-error" id="giAnnouncementError" role="alert"></p><button class="gi-primary" type="submit">${icon("campaign")} Send Announcement</button></form>`;
  $("#giAnnouncementForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const text = $("#giAnnouncementText").value.trim();
    if (!text) return;
    const submit = $("button[type=submit]", event.currentTarget);
    submit.disabled = true;
    try {
      const sent = await window.netChatSendMessage({ text: `📣 ${text}`, extra: { announcement: true, senderName: window.netChatUserData?.userFullname || "Group Admin" } });
      if (sent === false) throw new Error("The announcement was not sent.");
      toast("Announcement sent");
      navigate("info");
    } catch (error) {
      $("#giAnnouncementError").textContent = error.message || "Could not send the announcement.";
      submit.disabled = false;
    }
  });
}

function renderReport() {
  body.innerHTML = `<div class="gi-description-hero danger">${icon("report")}<h3>Report ${esc(groupName())}</h3><p>Reports are saved to your NetChat account for review. This does not notify the group.</p></div><form id="giReportForm" class="gi-form"><label>What is wrong?<select id="giReportReason" required><option value="Spam or scams">Spam or scams</option><option value="Harassment or hate">Harassment or hate</option><option value="Inappropriate content">Inappropriate content</option><option value="Other">Other</option></select></label><label>Additional details<textarea id="giReportDetails" maxlength="500" placeholder="Optional context for the review…"></textarea></label><button class="gi-primary gi-danger-button" type="submit">${icon("report")} Submit Report</button></form>`;
  $("#giReportForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = $("button[type=submit]", event.currentTarget);
    submit.disabled = true;
    try {
      await addDoc(collection(window.netChatDB, "user", me(), "reports"), {
        targetType: "group", targetUid: state.chatId, targetName: groupName(), conversationId: state.chatId,
        reason: $("#giReportReason").value, details: $("#giReportDetails").value.trim(),
        createdAt: serverTimestamp(), status: "submitted"
      });
      toast("Report submitted");
      navigate("info");
    } catch (error) {
      console.error("Group report failed:", error);
      toast("Could not submit the report. Check your Firebase rules.");
      submit.disabled = false;
    }
  });
}

async function saveGroup(fields, successMessage) {
  if (!state.chatId) throw new Error("Open a group first");
  try {
    await updateDoc(groupRef(), fields);
    // The live group snapshot applies arrayUnion/arrayRemove/deleteField values.
    // Never copy update sentinels into the in-memory group object.
    toast(successMessage);
    return true;
  } catch (error) {
    console.error("Group update failed:", error);
    toast("Could not save this setting. Check your connection and Firebase rules.");
    throw error;
  }
}

async function saveBasicInfo(event) {
  event.preventDefault();
  if (!canEditInfo()) return toast("You do not have permission to edit this group");
  const data = new FormData(event.currentTarget);
  const name = String(data.get("name") || "").trim();
  const description = String(data.get("description") || "").trim();
  if (!name) return toast("Group name cannot be empty");
  const submit = $("button[type=submit]", event.currentTarget);
  submit.disabled = true;
  try { await saveGroup({ groupName: name, groupDescription: description }, "Group information updated"); }
  catch { submit.disabled = false; }
}

async function uploadGroupPhoto(file) {
  if (!file || !canEditInfo()) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) return toast("Choose JPG, PNG or WebP under 5 MB");
  const progress = $("#giUploadProgress");
  if (progress) progress.hidden = false;
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", "My_NetChat_chat");
    const response = await fetch("https://api.cloudinary.com/v1_1/haludoui/image/upload", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok || !result.secure_url) throw new Error(result.error?.message || "Upload failed");
    await saveGroup({ groupImage: result.secure_url, groupImagePublicId: result.public_id }, "Group photo updated");
    renderPhoto();
  } catch (error) {
    console.error("Group photo upload failed:", error);
    toast(error.message || "Could not upload the group photo", 4500);
  } finally {
    if (progress) progress.hidden = true;
  }
}

async function addSelectedMembers(event) {
  event.preventDefault();
  const selected = $$('input[name="member"]:checked', event.currentTarget).map(input => input.value);
  if (!selected.length) return $("#giAddError").textContent = "Select at least one contact who is not already in the group.";
  const submit = $("button[type=submit]", event.currentTarget);
  submit.disabled = true;
  try {
    const unread = Object.fromEntries(selected.map(uid => [`unreadCount.${uid}`, 0]));
    await saveGroup({ participants: arrayUnion(...selected), ...unread }, `${selected.length} member${selected.length === 1 ? "" : "s"} added`);
    navigate("members");
  } catch {
    $("#giAddError").textContent = "Members could not be added. Check your permissions and try again.";
    submit.disabled = false;
  }
}

async function toggleMute() {
  const next = !muted();
  localStorage.setItem(`nc:muted:${state.chatId}`, next ? "1" : "0");
  try {
    await updateDoc(groupRef(), { mutedBy: next ? arrayUnion(me()) : arrayRemove(me()) });
    state.group.mutedBy = next ? [...new Set([...(state.group.mutedBy || []), me()])] : (state.group.mutedBy || []).filter(uid => uid !== me());
    toast(next ? "Group notifications muted" : "Group notifications enabled");
    render();
  } catch (error) {
    console.error("Mute update failed:", error);
    toast("Could not save the notification setting");
  }
}

async function openMemberActions(uid) {
  const profile = await getProfile(uid);
  const own = uid === me();
  const admin = admins().includes(uid) || state.group.createdBy === uid;
  const creator = state.group.createdBy === uid;
  showDialog(`<div class="gi-sheet-profile"><img src="${avatar(profile)}" alt=""><h3>${esc(displayName(profile, uid))}</h3><p>${esc(profile.about || (state.presence[uid]?.online ? "Online" : "Group member"))}</p>${admin ? `<span class="gi-admin-badge">Admin</span>` : ""}</div><div class="gi-dialog-actions">
    ${!own ? `<button type="button" data-dialog-action="message" data-uid="${esc(uid)}">${icon("chat_bubble")} Message privately</button>` : `<button type="button" data-dialog-action="close">${icon("person")} This is your profile</button>`}
    ${isAdmin() && !own && !creator ? `<button type="button" data-dialog-action="${admin ? "demote" : "promote"}" data-uid="${esc(uid)}">${icon(admin ? "remove_moderator" : "add_moderator")} ${admin ? "Remove admin" : "Make group admin"}</button><button type="button" class="danger" data-dialog-action="remove-member" data-uid="${esc(uid)}">${icon("person_remove")} Remove from group</button>` : ""}
    <button type="button" data-dialog-action="close">${icon("close")} Close</button></div>`);
}

function showDialog(html, action = null) {
  state.dialogAction = action;
  dialog.innerHTML = `<section class="gi-dialog-card" role="dialog" aria-modal="true"><div class="gi-dialog-grab"></div>${html}</section>`;
  dialog.hidden = false;
  requestAnimationFrame(() => dialog.classList.add("open"));
  setTimeout(() => $("button, input, textarea", dialog)?.focus(), 50);
}
function closeDialog() {
  dialog?.classList.remove("open");
  if (dialog) dialog.hidden = true;
  state.dialogAction = null;
}
function confirmDialog({ title: heading, text, confirmLabel, danger = true, onConfirm }) {
  showDialog(`<div class="gi-confirm">${icon(danger ? "warning" : "help")}<h3>${esc(heading)}</h3><p>${esc(text)}</p><div><button type="button" data-dialog-action="close">Cancel</button><button type="button" class="${danger ? "danger" : "primary"}" data-dialog-action="confirm">${esc(confirmLabel)}</button></div></div>`, onConfirm);
}

async function leaveGroup() {
  try {
    await updateDoc(groupRef(), {
      participants: arrayRemove(me()), admins: arrayRemove(me()),
      [`unreadCount.${me()}`]: deleteField()
    });
    closeGroupInfo();
    $("#closeChatBtn")?.click();
    toast("You left the group");
  } catch (error) {
    console.error("Leave group failed:", error);
    toast("Could not leave the group. Check your Firebase rules.");
  }
}
async function deleteGroup() {
  if (!isCreator()) return toast("Only the group creator can delete this group");
  try {
    await updateDoc(groupRef(), { groupDeleted: true, deletedAt: serverTimestamp(), deletedBy: me() });
    closeGroupInfo();
    $("#closeChatBtn")?.click();
    toast("Group deleted for everyone");
  } catch (error) {
    console.error("Delete group failed:", error);
    toast("Could not delete the group. Check your Firebase rules.");
  }
}

$("#groupInfoBack")?.addEventListener("click", goBack);
$("#groupInfoMore")?.addEventListener("click", () => navigate(isAdmin() ? "admin" : "settings"));
$("#chatHeaderUser")?.addEventListener("click", () => {
  if (state.target?.isGroup) openGroupInfo();
  else $("#viewContactBtn")?.click();
});
$("#chatHeaderUser")?.addEventListener("keydown", event => {
  if (["Enter", " "].includes(event.key)) { event.preventDefault(); $("#chatHeaderUser").click(); }
});
$("#groupMembersBtn")?.addEventListener("click", () => openGroupInfo("info"));

body?.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    const view = viewButton.dataset.view;
    if (view === "mute") return toggleMute();
    return navigate(view);
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "retry") render();
  if (action === "open-more") navigate(isAdmin() ? "admin" : "settings");
  if (action === "toggle-mute") toggleMute();
  if (action === "member-filter") { state.memberFilter = button.dataset.filter; renderMembers(++state.renderId); }
  if (action === "member-actions") openMemberActions(button.dataset.uid);
  if (action === "set-disappearing") {
    const seconds = Number(button.dataset.seconds);
    saveGroup({ disappearingSeconds: seconds }, seconds ? "Disappearing-message timer updated" : "Disappearing messages turned off").then(renderDisappearing).catch(() => {});
  }
  if (action === "remove-photo") confirmDialog({ title: "Remove group photo?", text: "The default NetChat group avatar will be shown instead.", confirmLabel: "Remove", onConfirm: () => saveGroup({ groupImage: "", groupImagePublicId: deleteField() }, "Group photo removed").then(renderPhoto) });
  if (action === "leave-group") confirmDialog({ title: `Leave ${groupName()}?`, text: "You will no longer receive messages from this group.", confirmLabel: "Leave Group", onConfirm: leaveGroup });
  if (action === "delete-group") confirmDialog({ title: `Delete ${groupName()}?`, text: "The group will disappear for every member. This action cannot be undone.", confirmLabel: "Delete Group", onConfirm: deleteGroup });
  if (action === "report") navigate("report");
  if (action === "jump-message") {
    closeGroupInfo();
    const row = $(`#chatMessagesBody [data-message-id="${CSS.escape(button.dataset.messageId)}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.classList.add("reply-highlight");
    setTimeout(() => row?.classList.remove("reply-highlight"), 1800);
  }
});

body?.addEventListener("change", async event => {
  const input = event.target.closest("[data-setting]");
  if (!input) return;
  if (!isAdmin()) { input.checked = !input.checked; return toast("Only group admins can change permissions"); }
  const key = input.dataset.setting;
  input.disabled = true;
  try { await saveGroup({ [key]: input.checked }, `${input.getAttribute("aria-label")} ${input.checked ? "enabled" : "disabled"}`); }
  catch { input.checked = !input.checked; }
  finally { input.disabled = false; }
});

dialog?.addEventListener("click", async event => {
  if (event.target === dialog) return closeDialog();
  const button = event.target.closest("[data-dialog-action]");
  if (!button) return;
  const action = button.dataset.dialogAction;
  const uid = button.dataset.uid;
  if (action === "close") return closeDialog();
  if (action === "confirm") {
    button.disabled = true;
    const callback = state.dialogAction;
    closeDialog();
    return callback?.();
  }
  if (action === "message") {
    closeDialog();
    closeGroupInfo();
    return window.netChatGroupSuite?.openPrivateFromUid(uid);
  }
  if (action === "promote" || action === "demote") {
    button.disabled = true;
    try {
      await saveGroup({ admins: action === "promote" ? arrayUnion(uid) : arrayRemove(uid) }, action === "promote" ? "Member promoted to admin" : "Admin role removed");
      closeDialog();
      render();
    } catch { button.disabled = false; }
  }
  if (action === "remove-member") {
    const profile = await getProfile(uid);
    confirmDialog({ title: `Remove ${displayName(profile, uid)}?`, text: "They will no longer have access to this group conversation.", confirmLabel: "Remove Member", onConfirm: async () => {
      try {
        await saveGroup({ participants: arrayRemove(uid), admins: arrayRemove(uid), [`unreadCount.${uid}`]: deleteField() }, "Member removed");
        render();
      } catch {}
    } });
  }
});

document.addEventListener("click", event => {
  const sender = event.target.closest("#chatMessagesBody [data-member-uid]");
  if (sender && state.target?.isGroup) openMemberActions(sender.dataset.memberUid);
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!dialog.hidden) closeDialog();
  else if (screen.classList.contains("open")) goBack();
});

window.addEventListener("netchat:group-open", event => setConversation(event.detail.conversationId, event.detail.chat));
window.addEventListener("netchat:private-open", event => setConversation(event.detail.conversationId, event.detail.target));
window.addEventListener("netchat:chat-closed", () => setConversation(null, null));
window.netChatOpenGroupInfo = openGroupInfo;
window.netChatCloseGroupInfo = closeGroupInfo;
