/* NetChat integrated repairs. Loaded after script.js; uses the existing composer. */
import {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where,
  onSnapshot, arrayUnion, arrayRemove, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const me = () => window.netChatAuthUser?.uid;
const icon = (name) => `<span class="material-symbols-outlined">${name}</span>`;
let toastEl;
let toastTimer;
function notify(message, options = {}) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "nxup-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  toastEl.appendChild(text);
  if (options.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = options.label || "Undo";
    button.onclick = async () => { toastEl.classList.remove("show"); await options.action(); };
    toastEl.appendChild(button);
  }
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), options.duration || 3200);
}

/* ---------- live group state, presence and typing ---------- */
const state = { conversationId: null, isGroup: false, chatData: null, unsubscribe: null, presenceStop: null, typingStop: null };
let groupProfiles = new Map();
let groupTypingNames = [];
const isAdmin = (data, uid = me()) => !!uid && (data?.createdBy === uid || (data?.admins || []).includes(uid));

function stopGroupListeners() {
  state.unsubscribe?.(); state.presenceStop?.(); state.typingStop?.();
  state.unsubscribe = state.presenceStop = state.typingStop = null;
  state.conversationId = null; state.isGroup = false; state.chatData = null;
  $("#nxGroupTyping")?.remove();
  setComposerRestriction("");
}

function groupBlockReason() {
  if (!state.isGroup || !state.chatData || !me()) return "";
  if (!(state.chatData.participants || []).includes(me())) return "You are no longer a member of this group";
  if (state.chatData.groupDeleted) return "This group was deleted";
  if (state.chatData.onlyAdminsCanMessage && !isAdmin(state.chatData)) return "Only admins can send messages in this group";
  return "";
}

function setComposerRestriction(reason) {
  const footer = $(".chat-input-bar");
  if (!footer) return;
  let notice = $("#nxComposerRestriction");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "nxComposerRestriction";
    notice.className = "nx-composer-restriction";
    notice.setAttribute("role", "status");
    $(".input-area", footer)?.prepend(notice);
  }
  notice.textContent = reason;
  notice.hidden = !reason;
  if (reason && recorder) cancelVoiceRecording(false);
  footer.classList.toggle("is-restricted", !!reason);
  const input = $("#messageInput");
  if (input) { input.disabled = !!reason; input.placeholder = reason || "Message..."; }
  $$("button", footer).forEach((button) => { if (button.id !== "cancelReplyBtn") button.disabled = !!reason; });
}

function paintGroupStatus() {
  if (!state.isGroup || !state.chatData) return;
  const members = state.chatData.participants || [];
  const status = $("#chatUserStatus");
  const online = members.filter((uid) => groupProfiles.get(uid)?.online && groupProfiles.get(uid)?.canSeePresence !== false).length;
  if (status) status.textContent = `${members.length} member${members.length === 1 ? "" : "s"} · ${online} online`;
  const name = $("#chatUserName"); if (name) name.textContent = state.chatData.groupName || "Group chat";
  const avatar = $("#chatUserAvatar"); if (avatar) avatar.src = state.chatData.groupImage || "default-avatar.png";
  const active = window.netChatGetActiveConversation?.();
  if (active?.target) Object.assign(active.target, state.chatData, { isGroup: true, userFullname: state.chatData.groupName, profileImage: state.chatData.groupImage });
  window.netChatUpdateActiveChat?.(state.chatData);
  setComposerRestriction(groupBlockReason());
}

function paintGroupTyping() {
  let indicator = $("#nxGroupTyping");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "nxGroupTyping";
    indicator.className = "nx-group-typing";
    $("#chatScreen")?.appendChild(indicator);
  }
  indicator.hidden = !groupTypingNames.length;
  if (!groupTypingNames.length) return;
  const names = groupTypingNames.slice(0, 2).map((uid) => groupProfiles.get(uid)?.userFullname || "NetChat User");
  const suffix = groupTypingNames.length > 2 ? ` and ${groupTypingNames.length - 2} others` : "";
  indicator.innerHTML = `<span>${esc(names.join(" and "))}${esc(suffix)} ${groupTypingNames.length === 1 ? "is" : "are"} typing…</span><i></i><i></i><i></i>`;
}

async function loadMemberProfiles(members) {
  await Promise.all(members.map(async (uid) => {
    const profile = await window.netChatGetSenderProfile?.(uid);
    const previous = groupProfiles.get(uid) || {};
    const next = { ...previous, ...(profile || { uid, userFullname: "NetChat User" }) };
    if (uid !== me() && next.privacy?.lastSeen === "Nobody") next.canSeePresence = false;
    if (uid !== me() && next.privacy?.lastSeen === "Contacts") {
      const contact = await getDoc(doc(window.netChatDB, "user", uid, "contacts", me())).catch(() => null);
      next.canSeePresence = !!contact?.exists();
    }
    groupProfiles.set(uid, next);
  }));
}

function watchGroupPresence() {
  state.presenceStop?.();
  state.presenceStop = onValue(ref(window.netChatRealtimeDB, "presence"), (snapshot) => {
    const values = snapshot.val() || {};
    Object.entries(values).forEach(([uid, presence]) => groupProfiles.set(uid, { ...(groupProfiles.get(uid) || {}), online: presence?.online === true, lastSeen: presence?.lastSeen }));
    paintGroupStatus();
  }, (error) => console.warn("Group presence unavailable:", error));
}

function watchGroupTyping() {
  state.typingStop?.();
  let lastSound = 0;
  state.typingStop = onValue(ref(window.netChatRealtimeDB, `typing/${state.conversationId}`), (snapshot) => {
    const values = snapshot.val() || {};
    groupTypingNames = Object.entries(values).filter(([uid, value]) => uid !== me() && (state.chatData?.participants || []).includes(uid) && (value === true || (value?.active === true && Date.now() - Number(value.updatedAt || 0) < 6000))).map(([uid]) => uid);
    paintGroupTyping();
    if (groupTypingNames.length && Date.now() - lastSound > 8000) { playSound("typing"); lastSound = Date.now(); }
  }, (error) => console.warn("Group typing unavailable:", error));
}

function openGroup(conversationId, initialChat) {
  stopGroupListeners();
  state.conversationId = conversationId; state.isGroup = true; state.chatData = initialChat;
  state.unsubscribe = onSnapshot(doc(window.netChatDB, "chats", conversationId), async (snapshot) => {
    if (!snapshot.exists()) { notify("This group is no longer available"); $("#closeChatBtn")?.click(); return; }
    state.chatData = snapshot.data();
    await loadMemberProfiles(state.chatData.participants || []);
    paintGroupStatus();
    if (sheet?.classList.contains("show")) renderGroupInfo();
  }, (error) => { console.error("Group listener failed:", error); notify("Live group settings could not be loaded"); });
  watchGroupPresence(); watchGroupTyping();
}
window.addEventListener("netchat:group-open", (event) => openGroup(event.detail.conversationId, event.detail.chat));
window.addEventListener("netchat:private-open", () => stopGroupListeners());
window.addEventListener("netchat:chat-closed", () => stopGroupListeners());

/* ---------- reusable sheets ---------- */
let sheet, sheetBody, sheetFoot;
function ensureSheet() {
  if (sheet) return;
  sheet = document.createElement("div");
  sheet.className = "nxup-backdrop";
  sheet.innerHTML = `<div class="nxup-sheet" role="dialog" aria-modal="true" aria-labelledby="nxupSheetTitle"><header class="nxup-topbar"><button class="nxup-close" id="nxupClose" aria-label="Back to conversation">${icon("arrow_back")}</button><div><h3 id="nxupSheetTitle">Group info</h3><p>Details, members and permissions</p></div><button class="nxup-top-edit" id="nxupEditInfo" aria-label="Edit group info">${icon("edit")}</button></header><div class="nxup-sheet-body" id="nxupBody"></div><div class="nxup-sheet-footer" id="nxupFoot"></div></div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener("click", (event) => { if (event.target === sheet) closeSheet(); });
  $("#nxupClose", sheet).onclick = closeSheet;
  sheetBody = $("#nxupBody", sheet);
  sheetFoot = $("#nxupFoot", sheet);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (actionBackdrop) { actionBackdrop.querySelector(".nxup-close")?.click(); return; }
    if (sheet?.classList.contains("show")) closeSheet();
  });
}
function openSheet() {
  ensureSheet();
  sheet.dataset.returnFocus = document.activeElement?.id || "";
  sheet.classList.add("show");
  if (sheetBody) sheetBody.scrollTop = 0;
  document.body.classList.add("nx-group-info-open");
  setTimeout(() => $("#nxupClose", sheet)?.focus({ preventScroll: true }), 60);
}
function closeSheet() {
  if (!sheet) return;
  sheet.classList.remove("show");
  document.body.classList.remove("nx-group-info-open");
  const returnFocus = document.getElementById(sheet.dataset.returnFocus || "groupMembersBtn");
  returnFocus?.focus?.({ preventScroll: true });
}

let actionBackdrop;
function actionSheet(title, subtitle, content) {
  actionBackdrop?.remove();
  actionBackdrop = document.createElement("div"); actionBackdrop.className = "nx-action-backdrop";
  actionBackdrop.innerHTML = `<section class="nx-action-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="nxup-grab"></div><header><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="nxup-close" aria-label="Close">${icon("close")}</button></header><div class="nx-action-content">${content}</div></section>`;
  document.body.appendChild(actionBackdrop);
  const close = () => { actionBackdrop?.remove(); actionBackdrop = null; };
  actionBackdrop.addEventListener("click", (event) => { if (event.target === actionBackdrop) close(); });
  $(".nxup-close", actionBackdrop).onclick = close;
  return { root: actionBackdrop, close };
}

/* ---------- group information, roles and members ---------- */
function toggleHtml(key, label, description, checked) {
  return `<div class="set-row nx-t-cyan nx-setting-row"><span class="meta"><b>${label}</b><small>${description}</small></span><label class="nx-switch nx-t-cyan"><input type="checkbox" data-group-toggle="${key}" ${checked ? "checked" : ""}><span class="track"></span><span class="thumb"></span></label></div>`;
}

async function addSystemMessage(text) {
  try {
    await addDoc(collection(window.netChatDB, "chats", state.conversationId, "messages"), { senderId: me(), text, type: "system", media: [], timestamp: serverTimestamp(), status: "sent", replyTo: null });
  } catch (error) { console.warn("Group system event could not be written:", error); }
}

async function saveGroupSetting(input) {
  const key = input.dataset.groupToggle;
  const value = input.checked;
  input.disabled = true;
  try {
    await updateDoc(doc(window.netChatDB, "chats", state.conversationId), { [key]: value });
    const labels = { onlyAdminsCanMessage: "Admin-only messages", memberCanAddOthers: "Members can add people", memberCanEditInfo: "Members can edit info" };
    await addSystemMessage(`${window.netChatUserData?.userFullname || "An admin"} turned ${value ? "on" : "off"}: ${labels[key]}`);
    notify("Group setting saved");
  } catch (error) {
    console.error("Group setting failed:", error); input.checked = !value;
    notify("Could not save. Deploy the supplied Firestore rules and retry.");
  } finally { input.disabled = false; }
}

function openGroupInfo() {
  if (!state.isGroup || !state.conversationId) return;
  openSheet(); renderGroupInfo();
}
function renderGroupInfo() {
  const data = state.chatData;
  if (!data || !sheetBody) { sheetBody.innerHTML = `<div class="status-empty">Loading group information…</div>`; return; }
  const members = data.participants || [];
  const admin = isAdmin(data);
  const owner = data.createdBy === me();
  const canEdit = admin || data.memberCanEditInfo === true;
  const canAdd = admin || data.memberCanAddOthers === true;
  const online = members.filter((uid) => groupProfiles.get(uid)?.online && groupProfiles.get(uid)?.canSeePresence !== false).length;
  const muted = (data.mutedBy || []).includes(me());
  const createdDate = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "";
  const ownerName = groupProfiles.get(data.createdBy)?.userFullname || "the group owner";
  const topEdit = $("#nxupEditInfo", sheet);
  if (topEdit) topEdit.hidden = !canEdit;

  sheetBody.innerHTML = `<section class="nx-group-hero">
    <button type="button" class="nxup-gavatar" id="nxupGAvatar" aria-label="${canEdit ? "Change group photo" : "Group photo"}" ${canEdit ? "" : "disabled"}><img src="${esc(data.groupImage || "default-avatar.png")}" alt="${esc(data.groupName || "Group")} photo">${canEdit ? `<span class="nxup-avatar-camera">${icon("photo_camera")}</span>` : ""}</button>
    <h2 id="nxupGName">${esc(data.groupName || "Group chat")}</h2>
    <p id="nxupGSub">${members.length} member${members.length === 1 ? "" : "s"} · ${online} online</p>
    <p class="nx-group-description ${data.groupDescription ? "" : "empty"}">${esc(data.groupDescription || "No group description yet.")}</p>
    <small class="nx-group-created" id="nxupGroupMeta">Created by ${esc(ownerName)}${createdDate ? ` · ${esc(createdDate)}` : ""}${data.communityId ? " · Community group" : ""}</small>
    <div class="nxup-quick-actions">
      ${canEdit ? `<button type="button" id="nxupEditQuick"><span>${icon("edit")}</span><b>Edit info</b></button>` : ""}
      ${canAdd ? `<button type="button" id="nxupAddMemberQuick"><span>${icon("person_add")}</span><b>Add member</b></button>` : ""}
      <button type="button" id="nxupMuteQuick"><span>${icon(muted ? "notifications" : "notifications_off")}</span><b>${muted ? "Unmute" : "Mute"}</b></button>
      <button type="button" id="nxupSearchMembers" aria-expanded="false"><span>${icon("search")}</span><b>Find member</b></button>
    </div>
    ${canEdit && data.groupImage ? `<button type="button" class="nxup-remove-photo" id="nxupRemovePhoto">${icon("delete")} Remove group photo</button>` : ""}
  </section>
  ${admin ? `<section class="nxup-section"><div class="nxup-sec">Group settings <span>Admin</span></div><div class="nxup-group">${toggleHtml("onlyAdminsCanMessage", "Admin-only messages", "Only trusted group admins can post", data.onlyAdminsCanMessage === true)}${toggleHtml("memberCanAddOthers", "Members can add people", "Otherwise only admins can add members", data.memberCanAddOthers === true)}${toggleHtml("memberCanEditInfo", "Members can edit info", "Name, description and group photo", data.memberCanEditInfo === true)}</div></section>` : ""}
  <section class="nxup-section nxup-members-section"><div class="nxup-sec"><span>Members · ${members.length}</span>${canAdd ? `<button type="button" id="nxupAddMemberText">${icon("person_add")} Add</button>` : ""}</div><label class="nx-member-search" id="nxMemberSearchWrap" hidden>${icon("search")}<input id="nxMemberSearch" type="search" placeholder="Search members" autocomplete="off"></label><div class="nxup-group" id="nxupMembers"><div class="status-empty">Loading member profiles…</div></div></section>`;

  $$('[data-group-toggle]', sheetBody).forEach((input) => input.addEventListener("change", () => saveGroupSetting(input)));
  const searchWrap = $("#nxMemberSearchWrap", sheetBody);
  const searchInput = $("#nxMemberSearch", sheetBody);
  const toggleSearch = () => {
    searchWrap.hidden = !searchWrap.hidden;
    $("#nxupSearchMembers", sheetBody)?.setAttribute("aria-expanded", String(!searchWrap.hidden));
    if (!searchWrap.hidden) searchInput.focus();
    else { searchInput.value = ""; $$('[data-member-id]', sheetBody).forEach((row) => { row.hidden = false; }); }
  };
  $("#nxupSearchMembers", sheetBody)?.addEventListener("click", toggleSearch);
  searchInput?.addEventListener("input", () => {
    const term = searchInput.value.trim().toLowerCase();
    $$('[data-member-id]', sheetBody).forEach((row) => { row.hidden = !!term && !row.textContent.toLowerCase().includes(term); });
  });
  renderMembers(members, data);

  sheetFoot.innerHTML = `<button class="nxup-btn ghost" id="nxupReportGroup">${icon("report")}Report group</button>${!owner ? `<button class="nxup-btn danger" id="nxupExit">${icon("logout")}Leave group</button>` : `<button class="nxup-btn danger" id="nxupDelete">${icon("delete_forever")}Delete group</button>`}`;
  $("#nxupReportGroup", sheetFoot)?.addEventListener("click", reportGroup);
  $("#nxupExit", sheetFoot)?.addEventListener("click", exitGroup);
  $("#nxupDelete", sheetFoot)?.addEventListener("click", deleteGroup);
  $("#nxupEditInfo", sheet)?.addEventListener("click", editGroupInfo);
  $("#nxupEditQuick", sheetBody)?.addEventListener("click", editGroupInfo);
  $("#nxupGAvatar", sheetBody)?.addEventListener("click", changeGroupPhoto);
  $("#nxupAddMemberQuick", sheetBody)?.addEventListener("click", addMemberFlow);
  $("#nxupAddMemberText", sheetBody)?.addEventListener("click", addMemberFlow);
  $("#nxupMuteQuick", sheetBody)?.addEventListener("click", () => toggleMute(state.conversationId, data));
  $("#nxupRemovePhoto", sheetBody)?.addEventListener("click", removeGroupPhoto);
}

async function removeGroupPhoto() {
  if (!state.chatData?.groupImage || !confirm("Remove the current group photo?")) return;
  try {
    await updateDoc(doc(window.netChatDB, "chats", state.conversationId), { groupImage: "" });
    await addSystemMessage(`${window.netChatUserData?.userFullname || "A group admin"} removed the group photo`);
    notify("Group photo removed");
  } catch (error) { console.error(error); notify("Could not remove the group photo"); }
}

async function renderMembers(members, data) {
  const box = $("#nxupMembers", sheetBody); if (!box) return;
  await loadMemberProfiles(members);
  const profiles = members.map((uid) => groupProfiles.get(uid) || { uid, userFullname: "NetChat User" });
  profiles.sort((a, b) => (b.uid === data.createdBy) - (a.uid === data.createdBy) || String(a.userFullname).localeCompare(String(b.userFullname)));
  const meta = $("#nxupGroupMeta", sheetBody);
  if (meta && data.createdAt?.toDate) {
    const ownerName = groupProfiles.get(data.createdBy)?.userFullname || "the group owner";
    meta.textContent = `Created by ${ownerName} · ${data.createdAt.toDate().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}${data.communityId ? " · Community group" : ""}`;
  }
  box.innerHTML = profiles.map((profile) => {
    const owner = profile.uid === data.createdBy;
    const admin = owner || (data.admins || []).includes(profile.uid);
    return `<button type="button" class="nxup-member" data-member-id="${esc(profile.uid)}"><img src="${esc(profile.profileImage || "default-avatar.png")}" alt=""><div class="nxup-member-meta"><b>${esc(profile.userFullname || "NetChat User")}${profile.uid === me() ? " (You)" : ""}</b><small>${esc(profile.netChatID || (profile.online ? "Online" : "NetChat member"))}</small></div><span class="nxup-badge ${owner ? "" : admin ? "admin" : "muted"}">${owner ? "OWNER" : admin ? "ADMIN" : "MEMBER"}</span>${profile.online ? `<i class="nx-member-online" title="Online"></i>` : ""}</button>`;
  }).join("");
  $$('[data-member-id]', box).forEach((button) => button.addEventListener("click", () => openMemberActions(button.dataset.memberId)));
}

async function openMemberActions(uid) {
  if (!uid) return;
  if (uid === me()) { notify("This is your own profile"); return; }
  const profile = await window.netChatGetSenderProfile?.(uid) || groupProfiles.get(uid) || { uid, userFullname: "NetChat User" };
  const data = state.chatData || {};
  const admin = isAdmin(data);
  const owner = data.createdBy === me();
  const targetOwner = uid === data.createdBy;
  const targetAdmin = (data.admins || []).includes(uid);
  let contact = null;
  try { contact = await getDoc(doc(window.netChatDB, "user", me(), "contacts", uid)); } catch {}
  const modal = actionSheet(profile.userFullname || "NetChat User", profile.netChatID || "NetChat member", `<div class="nx-profile-hero"><img src="${esc(profile.profileImage || "default-avatar.png")}" alt=""><p>${esc(profile.about || "No bio available yet.")}</p></div><div class="nx-action-list"><button data-member-action="profile">${icon("person")}View profile</button><button data-member-action="message">${icon("chat_bubble")}Message privately</button>${contact?.exists() ? "" : `<button data-member-action="contact">${icon("person_add")}Add to contacts</button>`}<button data-member-action="voice">${icon("call")}Voice call</button><button data-member-action="video">${icon("videocam")}Video call</button><button data-member-action="mute">${icon("notifications_off")}Mute private chat</button>${admin && !targetOwner ? `<button data-member-action="role">${icon(targetAdmin ? "remove_moderator" : "admin_panel_settings")}${targetAdmin ? "Remove admin" : "Make admin"}</button><button class="danger" data-member-action="remove">${icon("person_remove")}Remove from group</button>` : ""}</div>`);
  modal.root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-member-action]"); if (!button) return;
    const action = button.dataset.memberAction; button.disabled = true;
    try {
      if (action === "profile") {
        $("#modalUserAvatar").src = profile.profileImage || "default-avatar.png";
        $("#modalNetchatId").textContent = profile.netChatID || "";
        $("#modalUserName").textContent = profile.userFullname || "NetChat User";
        $("#modalUserBio").textContent = profile.about || "No bio available yet.";
        $("#userProfileModal")?.classList.add("active"); $("#profileBackdrop")?.classList.add("active");
        modal.close();
      } else if (["message", "voice", "video", "mute"].includes(action)) {
        const id = [me(), uid].sort().join("_");
        if (action === "mute") {
          const chatRef = doc(window.netChatDB, "chats", id); const snap = await getDoc(chatRef);
          if (!snap.exists()) throw new Error("Start the private chat before changing its mute setting");
          await updateDoc(chatRef, { mutedBy: (snap.data().mutedBy || []).includes(me()) ? arrayRemove(me()) : arrayUnion(me()) });
          notify("Private-chat mute setting updated");
        } else {
          modal.close(); closeSheet();
          await window.netChatOpenConversation({ ...profile, uid, isGroup: false }, id, { focus: action === "message" });
          if (action === "voice" || action === "video") setTimeout(() => $(action === "voice" ? "#startVoiceCallBtn" : "#startCallBtn")?.click(), 150);
        }
      } else if (action === "contact") {
        const requestId = `${me()}_${uid}`;
        await setDoc(doc(window.netChatDB, "contactRequests", requestId), { fromUid: me(), toUid: uid, status: "pending", createdAt: serverTimestamp(), respondedAt: null });
        await setDoc(doc(window.netChatDB, "systemInbox", uid, "items", requestId), { type: "contact_request", requestId, fromUid: me(), createdAt: serverTimestamp(), read: false });
        notify("Contact request sent"); button.remove();
      } else if (action === "role") {
        if (targetAdmin && (data.admins || []).length <= 1 && data.createdBy !== uid) throw new Error("Keep at least one admin in the group");
        await updateDoc(doc(window.netChatDB, "chats", state.conversationId), { admins: targetAdmin ? arrayRemove(uid) : arrayUnion(uid) });
        await addSystemMessage(`${profile.userFullname} is ${targetAdmin ? "no longer" : "now"} a group admin`);
        notify(targetAdmin ? "Admin removed" : "Admin added"); modal.close();
      } else if (action === "remove") {
        if (!confirm(`Remove ${profile.userFullname || "this member"} from the group?`)) { button.disabled = false; return; }
        await updateDoc(doc(window.netChatDB, "chats", state.conversationId), { participants: arrayRemove(uid), admins: arrayRemove(uid) });
        notify("Member removed"); modal.close();
      }
    } catch (error) { console.error("Member action failed:", error); notify(error.message || "Action failed. Check permissions and Firestore rules."); button.disabled = false; }
  });
}

$("#groupMembersBtn")?.addEventListener("click", (event) => { event.stopPropagation(); openGroupInfo(); });
$("#chatHeaderUser")?.addEventListener("click", () => { if (state.isGroup) openGroupInfo(); else $("#viewContactBtn")?.click(); });
$("#chatMessagesBody")?.addEventListener("click", (event) => {
  if (event.target.closest("[data-open-group-info]")) { openGroupInfo(); return; }
  const button = event.target.closest("[data-sender-id]");
  if (button) openMemberActions(button.dataset.senderId);
});
["startCallBtn", "startVoiceCallBtn"].forEach((id) => $("#" + id)?.addEventListener("click", (event) => {
  if (!state.isGroup) return;
  event.preventDefault(); event.stopImmediatePropagation();
  notify("Group calls need multi-party WebRTC signaling. This build supports two-party calls only.", { duration: 5200 });
}, true));

function editGroupInfo() {
  const data = state.chatData;
  const modal = actionSheet("Edit group info", "Changes are visible to every member", `<form id="nxEditGroupForm" class="nx-form"><label>Group name<input name="name" required maxlength="60" value="${esc(data.groupName || "")}"></label><label>Description<textarea name="description" maxlength="240" rows="4">${esc(data.groupDescription || "")}</textarea></label><button class="nxup-btn primary" type="submit">Save changes</button></form>`);
  $("#nxEditGroupForm", modal.root).onsubmit = async (event) => {
    event.preventDefault(); const submit = $("button[type=submit]", event.currentTarget); submit.disabled = true;
    const values = new FormData(event.currentTarget);
    try { const groupName = String(values.get("name")).trim();
        if (!groupName) throw new Error("Enter a group name");
        await updateDoc(doc(window.netChatDB, "chats", state.conversationId), { groupName, groupDescription: String(values.get("description")).trim() });
        await addSystemMessage(`${window.netChatUserData?.userFullname || "A group admin"} updated the group info`);
        notify("Group info updated"); modal.close(); }
    catch (error) { console.error(error); notify("Could not save group info"); submit.disabled = false; }
  };
}

function uploadGroupImage(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData(); form.append("file", file); form.append("upload_preset", "My_NetChat_profile");
    const xhr = new XMLHttpRequest(); xhr.open("POST", "https://api.cloudinary.com/v1_1/haludoui/image/upload");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error("Network error during photo upload"));
    xhr.onload = () => { let data = {}; try { data = JSON.parse(xhr.responseText); } catch {} if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) resolve(data.secure_url); else reject(new Error(data.error?.message || "Photo upload failed")); };
    xhr.send(form);
  });
}
function changeGroupPhoto() {
  const input = document.createElement("input"); input.type = "file"; input.accept = "image/jpeg,image/png,image/webp";
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { notify("Choose JPG, PNG or WebP under 5 MB"); return; }
    const preview = URL.createObjectURL(file);
    const modal = actionSheet("Update group photo", "Preview before uploading", `<div class="nx-photo-preview"><img src="${preview}" alt="New group photo preview"></div><progress id="nxGroupUpload" max="100" value="0" hidden></progress><p id="nxGroupUploadText"></p><button class="nxup-btn primary" id="nxConfirmPhoto">Upload photo</button>`);
    $("#nxConfirmPhoto", modal.root).onclick = async (event) => {
      const button = event.currentTarget; button.disabled = true; const progress = $("#nxGroupUpload", modal.root); progress.hidden = false;
      try {
        const url = await uploadGroupImage(file, (percent) => { progress.value = percent; $("#nxGroupUploadText", modal.root).textContent = `Uploading · ${percent}%`; });
        await updateDoc(doc(window.netChatDB, "chats", state.conversationId), { groupImage: url });
        await addSystemMessage(`${window.netChatUserData?.userFullname || "A group admin"} changed the group photo`);
        notify("Group photo updated"); modal.close();
      } catch (error) { console.error(error); notify(error.message || "Photo upload failed"); button.disabled = false; }
      finally { URL.revokeObjectURL(preview); }
    };
  }; input.click();
}

async function addMemberFlow() {
  const modal = actionSheet("Add a member", "Search by their exact NetChat ID", `<form id="nxAddMemberForm" class="nx-form"><label>NetChat ID<input name="id" placeholder="NC-ABC12345" required autocomplete="off"></label><button class="nxup-btn primary" type="submit">Find and add</button></form>`);
  $("#nxAddMemberForm", modal.root).onsubmit = async (event) => {
    event.preventDefault(); const submit = $("button[type=submit]", event.currentTarget); submit.disabled = true;
    try {
      const id = String(new FormData(event.currentTarget).get("id") || "").trim();
      const result = await getDocs(query(collection(window.netChatDB, "user"), where("netChatID", "==", id)));
      if (result.empty) throw new Error("No user found with that NetChat ID");
      const uid = result.docs[0].id;
      if ((state.chatData.participants || []).includes(uid)) throw new Error("That user is already a member");
      await updateDoc(doc(window.netChatDB, "chats", state.conversationId), { participants: arrayUnion(uid), [`unreadCount.${uid}`]: 0 });
      await addSystemMessage(`${result.docs[0].data().userFullname || "A new member"} was added to the group`);
      notify("Member added"); modal.close();
    } catch (error) { console.error(error); notify(error.message || "Could not add member"); submit.disabled = false; }
  };
}
async function exitGroup() {
  const data = state.chatData;
  if (isAdmin(data) && (data.admins || []).length <= 1 && data.createdBy !== me()) { notify("Promote another admin before leaving"); return; }
  if (!confirm("Leave this group? You will stop receiving its messages.")) return;
  try { await updateDoc(doc(window.netChatDB, "chats", state.conversationId), { participants: arrayRemove(me()), admins: arrayRemove(me()) }); closeSheet(); $("#closeChatBtn")?.click(); notify("You left the group"); }
  catch (error) { console.error(error); notify("Could not leave group. Check Firestore rules."); }
}
async function deleteGroup() {
  if (!confirm("Delete this group for EVERYONE? This cannot be undone.")) return;
  try { await updateDoc(doc(window.netChatDB, "chats", state.conversationId), { groupDeleted: true, deletedAt: serverTimestamp() }); closeSheet(); $("#closeChatBtn")?.click(); notify("Group deleted"); }
  catch (error) { console.error(error); notify("Could not delete group"); }
}
async function reportGroup() {
  const reason = prompt("Why are you reporting this group?"); if (!reason?.trim()) return;
  try { await addDoc(collection(window.netChatDB, "user", me(), "reports"), { targetType: "group", targetId: state.conversationId, reason: reason.trim().slice(0, 1000), createdAt: serverTimestamp() }); notify("Report saved"); }
  catch (error) { console.error(error); notify("Report could not be saved"); }
}

/* ---------- shared composer: attachments, emoji, polls and voice notes ---------- */
const attachmentTiles = [
  ["gallery", "photo_library", "Gallery"], ["camera", "photo_camera", "Camera"],
  ["document", "description", "Document"], ["audio", "library_music", "Audio"],
  ["voice", "graphic_eq", "Voice note"], ["poll", "poll", "Create poll"]
];
function openAttachments() {
  if (groupBlockReason()) { notify(groupBlockReason()); return; }
  const modal = actionSheet("Share in this chat", "Files upload securely to Cloudinary", `<div class="nx-attachment-grid">${attachmentTiles.map(([id, glyph, label]) => `<button type="button" data-attachment="${id}"><span>${icon(glyph)}</span><b>${label}</b></button>`).join("")}</div><p class="nx-upload-help">Images up to 10 MB. Video, audio and documents up to 25 MB.</p>`);
  modal.root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-attachment]"); if (!button) return;
    const type = button.dataset.attachment; modal.close();
    if (type === "gallery") $("#chatGalleryBtn")?.click();
    if (type === "camera") $("#chatImageBtn")?.click();
    if (type === "voice") startVoiceRecording();
    if (type === "poll") openPollCreator();
    if (type === "document" || type === "audio") pickAndSend(type);
  });
}
function pickAndSend(type) {
  const input = document.createElement("input"); input.type = "file";
  input.accept = type === "audio" ? "audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,.mp3,.m4a,.ogg,.wav" : ".pdf,.doc,.docx,.txt,.zip,application/pdf,text/plain,application/zip";
  input.onchange = async () => { const file = input.files?.[0]; if (file) await window.netChatSendMessage?.({ files: [file] }); };
  input.click();
}
$("#attachFileBtn")?.addEventListener("click", openAttachments);


/* ---------- searchable emoji picker ---------- */
let emojiPickerPromise = null;
let emojiPopover = null;
let emojiOutsideHandler = null;
let emojiEscapeHandler = null;
let emojiInput = null;
let emojiCaretHandler = null;

async function loadEmojiPicker() {
  if (!emojiPickerPromise) {
    emojiPickerPromise = import(
      "https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js"
    ).catch((error) => {
      emojiPickerPromise = null;
      throw error;
    });
  }
  return emojiPickerPromise;
}

function closeEmojiPicker() {
  if (emojiOutsideHandler) document.removeEventListener("pointerdown", emojiOutsideHandler, true);
  if (emojiEscapeHandler) document.removeEventListener("keydown", emojiEscapeHandler, true);
  if (emojiInput && emojiCaretHandler) {
    ["input", "keyup", "click", "select", "focus"].forEach((type) => emojiInput.removeEventListener(type, emojiCaretHandler));
  }
  emojiOutsideHandler = null;
  emojiEscapeHandler = null;
  emojiInput = null;
  emojiCaretHandler = null;
  emojiPopover?.remove();
  emojiPopover = null;
  const button = $("#emojiBtn");
  button?.setAttribute("aria-expanded", "false");
}

function positionEmojiPicker() {
  if (!emojiPopover) return;
  const input = $("#messageInput");
  const composer = input?.closest(".chat-input-bar") || input?.parentElement;
  const rect = composer?.getBoundingClientRect();
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const availableAbove = Math.max(180, (rect?.top || viewportHeight * 0.6) - 16);
  const cap = window.innerWidth <= 520 ? Math.min(440, viewportHeight * 0.62) : Math.min(540, viewportHeight * 0.72);
  const panelHeight = Math.max(180, Math.min(availableAbove, cap));
  const bottomGap = rect ? Math.max(8, viewportHeight - rect.top + 8) : 90;
  emojiPopover.style.bottom = `${bottomGap}px`;
  emojiPopover.style.height = `${panelHeight}px`;
  emojiPopover.style.maxHeight = `${availableAbove}px`;
}

async function openEmoji() {
  const input = $("#messageInput");
  if (!input) {
    notify("The message input could not be found");
    return;
  }
  if (emojiPopover) {
    closeEmojiPicker();
    return;
  }

  // Save the insertion point before focus moves into the picker.
  let insertStart = input.selectionStart ?? input.value.length;
  let insertEnd = input.selectionEnd ?? insertStart;
  emojiInput = input;
  emojiCaretHandler = () => {
    if (document.activeElement !== input) return;
    insertStart = input.selectionStart ?? input.value.length;
    insertEnd = input.selectionEnd ?? insertStart;
  };
  ["input", "keyup", "click", "select", "focus"].forEach((type) => input.addEventListener(type, emojiCaretHandler));

  emojiPopover = document.createElement("section");
  emojiPopover.className = "nx-emoji-popover";
  emojiPopover.setAttribute("role", "dialog");
  emojiPopover.setAttribute("aria-label", "Choose an emoji");
  emojiPopover.innerHTML = `<header class="nx-emoji-popover-head"><div><b>Choose an emoji</b><small>Search or browse, then tap to insert</small></div><button type="button" class="nx-emoji-close" aria-label="Close emoji picker">${icon("close")}</button></header><div class="nx-emoji-picker-wrap"><p class="nx-emoji-loading">Loading emoji picker…</p></div>`;
  document.body.appendChild(emojiPopover);
  $("#emojiBtn")?.setAttribute("aria-expanded", "true");
  positionEmojiPicker();

  const closeButton = $(".nx-emoji-close", emojiPopover);
  closeButton?.addEventListener("click", closeEmojiPicker);

  // Only close for clicks outside the picker and its trigger; the composer stays visible and usable.
  emojiOutsideHandler = (event) => {
    if (!emojiPopover) return;
    if (emojiPopover.contains(event.target) || $("#emojiBtn")?.contains(event.target)) return;
    closeEmojiPicker();
  };
  emojiEscapeHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeEmojiPicker();
      input.focus();
    }
  };
  document.addEventListener("pointerdown", emojiOutsideHandler, true);
  document.addEventListener("keydown", emojiEscapeHandler, true);
  try {
    await loadEmojiPicker();
    if (!emojiPopover?.isConnected) return;
    const wrap = $(".nx-emoji-picker-wrap", emojiPopover);
    if (!wrap) return;
    wrap.innerHTML = "";
    const picker = document.createElement("emoji-picker");
    picker.setAttribute("aria-label", "Search and choose an emoji");
    picker.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;min-height:0;max-height:100%;flex:1 1 0%;touch-action:pan-y;";
    picker.addEventListener("emoji-click", (event) => {
      const emoji = event.detail?.unicode;
      if (!emoji || !input.isConnected) return;
      const value = input.value;
      const start = Math.max(0, Math.min(insertStart, value.length));
      const end = Math.max(start, Math.min(insertEnd, value.length));
      const nextValue = value.slice(0, start) + emoji + value.slice(end);
      input.value = nextValue;
      insertStart = insertEnd = start + emoji.length;
      input.focus({ preventScroll: true });
      input.setSelectionRange(insertStart, insertEnd);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      // Keep the insertion point current as the user continues typing and choosing emojis.
      insertStart = input.selectionStart ?? nextValue.length;
      insertEnd = input.selectionEnd ?? insertStart;
      // Keep the popover open for consecutive selections and keep the updated composer visible.
    });
    wrap.appendChild(picker);
    positionEmojiPicker();
  } catch (error) {
    console.error("Emoji picker failed to load:", error);
    const wrap = $(".nx-emoji-picker-wrap", emojiPopover);
    if (wrap) wrap.innerHTML = `<div class="nx-emoji-error"><p>Could not load the full emoji picker.</p><button type="button" class="nx-emoji-retry">Try again</button></div>`;
    $(".nx-emoji-retry", emojiPopover)?.addEventListener("click", () => {
      closeEmojiPicker();
      openEmoji();
    });
  }
}

$("#emojiBtn")?.addEventListener("click", openEmoji);
window.addEventListener("resize", () => {
  if (emojiPopover) positionEmojiPicker();
});
window.visualViewport?.addEventListener("resize", () => {
  if (emojiPopover) positionEmojiPicker();
});

function openPollCreator() {
  const modal = actionSheet("Create a poll", "Votes update from the shared message document", `<form id="nxPollForm" class="nx-form"><label>Question<input name="question" required maxlength="180" placeholder="What would you like to ask?"></label><div id="nxPollOptions"><label>Option 1<input name="option" required maxlength="80"></label><label>Option 2<input name="option" required maxlength="80"></label></div><button type="button" class="nxup-btn ghost" id="nxAddPollOption">${icon("add")}Add option</button><label class="nx-check"><input type="checkbox" name="multiple"> Allow multiple selections</label><label>Closing time (optional)<input type="datetime-local" name="closesAt"></label><button class="nxup-btn primary" type="submit">Create poll</button></form>`);
  $("#nxAddPollOption", modal.root).onclick = () => {
    const count = $$('input[name="option"]', modal.root).length;
    if (count >= 8) { notify("A poll can have at most 8 options"); return; }
    const label = document.createElement("label"); label.textContent = `Option ${count + 1}`;
    const input = document.createElement("input"); input.name = "option"; input.required = true; input.maxLength = 80; label.appendChild(input); $("#nxPollOptions", modal.root).appendChild(label);
  };
  $("#nxPollForm", modal.root).onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget; const submit = $("button[type=submit]", form); submit.disabled = true;
    const values = new FormData(form); const options = values.getAll("option").map((text) => String(text).trim()).filter(Boolean);
    const closeValue = String(values.get("closesAt") || "");
    if (options.length < 2 || new Set(options.map((x) => x.toLowerCase())).size !== options.length) { notify("Enter at least two different options"); submit.disabled = false; return; }
    if (closeValue && new Date(closeValue).getTime() <= Date.now()) { notify("Choose a future closing time"); submit.disabled = false; return; }
    const poll = { question: String(values.get("question")).trim(), options: options.map((text, index) => ({ id: `option_${index + 1}`, text })), multiple: values.get("multiple") === "on", closesAt: closeValue ? new Date(closeValue).toISOString() : null };
    const sent = await window.netChatSendMessage?.({ text: "", files: [], extra: { type: "poll", poll, pollVotes: {} } });
    if (sent) modal.close(); else submit.disabled = false;
  };
}

/* Live poll voting uses the same message document as the composer. */
$("#chatMessagesBody")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-poll-vote]");
  if (!button) return;
  const uid = me();
  if (!uid) return;
  const messageId = button.dataset.pollMessageId;
  const optionId = button.dataset.pollVote;
  const messageDoc = window.currentChatSnapshotDocs?.find((item) => item.id === messageId);
  if (!messageDoc) return;
  const data = messageDoc.data();
  const closeTime = data.poll?.closesAt ? new Date(data.poll.closesAt).getTime() : 0;
  if (closeTime && closeTime <= Date.now()) { notify("This poll is closed"); return; }
  const current = data.pollVotes?.[uid];
  if (!data.poll?.multiple && current === optionId) return;
  button.disabled = true;
  try {
    if (data.poll?.multiple) {
      const selected = Array.isArray(current) && current.includes(optionId);
      await updateDoc(messageDoc.ref, { [`pollVotes.${uid}`]: selected ? arrayRemove(optionId) : arrayUnion(optionId) });
    } else {
      await updateDoc(messageDoc.ref, { [`pollVotes.${uid}`]: optionId });
    }
  } catch (error) {
    console.error("Poll vote failed:", error);
    notify("Vote could not be saved. Check your connection and Firestore rules.");
    button.disabled = false;
  }
});

let recorder = null, recordStream = null, recordChunks = [], recordStarted = 0, recordTimer = null;
function updateSendMode() {
  const button = $("#sendMsgBtn"); if (!button) return;
  const hasText = !!$("#messageInput")?.value.trim();
  const hasMedia = !$("#chatMediaPreview")?.hidden;
  button.setAttribute("aria-label", recorder ? "Stop and send voice note" : hasText || hasMedia ? "Send Message" : "Record voice note");
  button.innerHTML = icon(recorder ? "send" : hasText || hasMedia ? "send" : "mic");
}
$("#messageInput")?.addEventListener("input", updateSendMode);
$("#chatMediaPreview") && new MutationObserver(updateSendMode).observe($("#chatMediaPreview"), { attributes: true, childList: true });
function stopRecordingTracks() { recordStream?.getTracks().forEach((track) => track.stop()); recordStream = null; clearInterval(recordTimer); recordTimer = null; }
function cancelVoiceRecording(showNotice = true) {
  const activeRecorder = recorder;
  recorder = null;
  if (activeRecorder) {
    activeRecorder.onstop = null;
    activeRecorder.onerror = null;
    if (activeRecorder.state !== "inactive") { try { activeRecorder.stop(); } catch {} }
  }
  stopRecordingTracks();
  recordChunks = [];
  $("#nxRecordingBar")?.remove();
  updateSendMode();
  if (showNotice && activeRecorder) notify("Voice recording cancelled");
}
async function startVoiceRecording() {
  if (recorder) { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { notify("Voice recording is not supported in this browser"); return; }
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordChunks = []; recorder = new MediaRecorder(recordStream); recordStarted = Date.now();
    recorder.ondataavailable = (event) => { if (event.data.size) recordChunks.push(event.data); };
    recorder.onstop = async () => {
      const duration = (Date.now() - recordStarted) / 1000; const blob = new Blob(recordChunks, { type: recorder.mimeType || "audio/webm" });
      stopRecordingTracks(); recorder = null; $("#nxRecordingBar")?.remove(); updateSendMode();
      if (duration < 0.6 || !blob.size) { notify("Voice note was too short"); return; }
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
      await window.netChatSendMessage?.({ files: [file] });
    };
    recorder.onerror = () => { notify("Recording failed"); stopRecordingTracks(); recorder = null; $("#nxRecordingBar")?.remove(); updateSendMode(); };
    recorder.start(250);
    const bar = document.createElement("div"); bar.id = "nxRecordingBar"; bar.className = "nx-recording-bar"; bar.innerHTML = `<i></i><b>0:00</b><span>Recording… tap send to finish</span><button type="button" aria-label="Cancel recording">${icon("delete")}</button>`;
    $(".input-area")?.prepend(bar);
    $("button", bar).onclick = () => cancelVoiceRecording();
    recordTimer = setInterval(() => { const seconds = Math.floor((Date.now() - recordStarted) / 1000); const label = $("b", bar); if (label) label.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; if (seconds >= 120 && recorder) recorder.stop(); }, 250);
    updateSendMode();
  } catch (error) { console.error(error); notify("Microphone permission is required to record a voice note"); stopRecordingTracks(); recorder = null; }
}
$("#sendMsgBtn")?.addEventListener("click", (event) => {
  const empty = !$("#messageInput")?.value.trim() && $("#chatMediaPreview")?.hidden !== false;
  if (recorder || empty) { event.preventDefault(); event.stopImmediatePropagation(); startVoiceRecording(); }
}, true);

/* custom voice-note playback */
$("#chatMessagesBody")?.addEventListener("click", (event) => {
  const note = event.target.closest(".nx-voice-note"); if (!note) return;
  const audio = $("audio", note); if (!audio) return;
  const progress = event.target.closest("progress");
  if (progress && Number.isFinite(audio.duration)) {
    const rect = progress.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    return;
  }
  if (event.target.closest(".nx-voice-speed")) { audio.playbackRate = audio.playbackRate === 1 ? 1.5 : audio.playbackRate === 1.5 ? 2 : 1; $(".nx-voice-speed", note).textContent = `${audio.playbackRate}×`; return; }
  if (!event.target.closest(".nx-voice-play")) return;
  $$(".nx-voice-note audio").forEach((other) => { if (other !== audio) other.pause(); });
  if (audio.paused) audio.play().catch(() => notify("Audio playback was blocked by the browser")); else audio.pause();
});
$("#chatMessagesBody")?.addEventListener("timeupdate", () => {}, true);
setInterval(() => {
  $$(".nx-voice-note").forEach((note) => {
    const audio = $("audio", note); if (!audio) return;
    const progress = $("progress", note); if (progress && audio.duration) progress.value = audio.currentTime / audio.duration * 100;
    const playing = !audio.paused; const glyph = $(".nx-voice-play .material-symbols-outlined", note); if (glyph) glyph.textContent = playing ? "pause" : "play_arrow";
    const playButton = $(".nx-voice-play", note); if (playButton) playButton.setAttribute("aria-label", playing ? "Pause audio" : "Play audio");
    const time = $(".nx-voice-track small", note); if (time && audio.duration) time.textContent = `${Math.floor(audio.currentTime / 60)}:${String(Math.floor(audio.currentTime % 60)).padStart(2, "0")} / ${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, "0")}`;
  });
}, 300);

/* ---------- generated sound cues and preferences ---------- */
const soundDefaults = { sent: true, received: true, typing: false, call: true };
function soundPreferences() { try { return { ...soundDefaults, ...JSON.parse(localStorage.getItem("nx:sounds") || "{}") }; } catch { return { ...soundDefaults }; } }
let audioContext;
function playSound(kind) {
  if (!soundPreferences()[kind]) return;
  try {
    if (kind === "received" && JSON.parse(localStorage.getItem("nx:msgNotif") ?? "true") === false) return;
    const active = window.netChatGetActiveConversation?.();
    if (kind === "received" && active?.target?.isGroup && JSON.parse(localStorage.getItem("nx:grpNotif") ?? "true") === false) return;
  } catch {}
  if (document.hidden && kind === "typing") return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") return;
    const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain();
    const frequencies = { sent: 620, received: 820, typing: 460, call: 740 };
    oscillator.type = kind === "call" ? "sine" : "triangle"; oscillator.frequency.value = frequencies[kind] || 600;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(0.07, audioContext.currentTime + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + (kind === "call" ? 0.35 : 0.12));
    oscillator.connect(gain).connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + (kind === "call" ? 0.36 : 0.13));
  } catch {}
}
window.netChatPlaySound = playSound;
function openSoundSettings() {
  const preferences = soundPreferences();
  const modal = actionSheet("Message sounds", "Saved on this device; respects each chat's mute state", `<div class="nxup-group">${[["sent","Message sent"],["received","Message received"],["typing","Typing started"],["call","Incoming call"]].map(([key,label]) => toggleHtml(`sound:${key}`, label, key === "typing" ? "Throttled to avoid repeated cues" : "Short generated tone, no audio file needed", preferences[key])).join("")}</div>`);
  modal.root.addEventListener("change", (event) => {
    const input = event.target.closest('[data-group-toggle^="sound:"]'); if (!input) return;
    const next = { ...soundPreferences(), [input.dataset.groupToggle.slice(6)]: input.checked };
    localStorage.setItem("nx:sounds", JSON.stringify(next));
  });
}
window.netChatOpenSoundSettings = openSoundSettings;
const renderedConversationIds = new Map();
window.addEventListener("netchat:messages-rendered", (event) => {
  const conversationId = event.detail.conversationId;
  const snapshot = event.detail.snapshot; const active = window.netChatGetActiveConversation?.();
  const currentIds = new Set(snapshot.docs.map((item) => item.id));
  const hadPrevious = renderedConversationIds.has(conversationId);
  const previous = renderedConversationIds.get(conversationId) || new Set();
  const muted = (active?.target?.mutedBy || []).includes(me());
  if (hadPrevious && !muted && !snapshot.metadata.fromCache) {
    snapshot.docChanges().forEach((change) => { if (change.type === "added" && !previous.has(change.doc.id) && change.doc.data().senderId !== me()) playSound("received"); });
  }
  renderedConversationIds.set(conversationId, currentIds);
});
let incomingCallWasVisible = false;
setInterval(() => {
  const visible = $("#incomingCallModal")?.style.display === "flex";
  if (visible && !incomingCallWasVisible) playSound("call");
  incomingCallWasVisible = visible;
}, 800);

/* ---------- per-user archive, mute, pin, read and gestures ---------- */
async function toggleMute(conversationId, suppliedData = null) {
  try {
    const chatRef = doc(window.netChatDB, "chats", conversationId);
    const data = suppliedData || (await getDoc(chatRef)).data();
    if (!data) throw new Error("Chat not found");
    const muted = (data.mutedBy || []).includes(me());
    await updateDoc(chatRef, { mutedBy: muted ? arrayRemove(me()) : arrayUnion(me()) });
    notify(muted ? "Notifications unmuted" : "Notifications muted");
  } catch (error) { console.error("Mute failed:", error); notify("Could not save notification setting"); }
}
async function setArchived(card, archived = true) {
  const id = card?.dataset.conversationId || card?.id || card?.chatId;
  if (!id) return;
  const data = card?.chatData || (await getDoc(doc(window.netChatDB, "chats", id))).data() || {};
  const title = data.groupName || card?.querySelector?.("h3")?.textContent || "Chat";
  const archiveRef = doc(window.netChatDB, "user", me(), "archivedChats", id);
  if (archived) {
    await setDoc(archiveRef, { chatId: id, title, lastMessage: data.lastMessage || "", archivedAt: serverTimestamp() });
    card?.remove?.(); notify("Chat archived", { action: () => setArchived({ id }, false) });
  } else {
    await deleteDoc(archiveRef);
    const snap = await getDoc(doc(window.netChatDB, "chats", id));
    if (snap.exists()) await updateDoc(snap.ref, { [`unreadCount.${me()}`]: Number(snap.data().unreadCount?.[me()] || 0) });
    notify("Chat restored");
  }
}
async function openChatActions(card) {
  const id = card.dataset.conversationId; if (!id) return;
  let data; try { data = (await getDoc(doc(window.netChatDB, "chats", id))).data(); } catch { notify("Chat settings could not be loaded"); return; }
  const title = $("h3", card)?.textContent || "Chat";
  const muted = (data.mutedBy || []).includes(me()); const pinned = (data.pinnedBy || []).includes(me()); const unread = Number(data.unreadCount?.[me()] || 0) > 0;
  const modal = actionSheet(title, "Actions affect your account only unless stated", `<div class="nx-action-list"><button data-chat-action="archive">${icon("archive")}Archive chat</button><button data-chat-action="read">${icon(unread ? "mark_email_read" : "mark_email_unread")}${unread ? "Mark as read" : "Mark as unread"}</button><button data-chat-action="mute">${icon(muted ? "notifications" : "notifications_off")}${muted ? "Unmute" : "Mute notifications"}</button><button data-chat-action="pin">${icon("push_pin")}${pinned ? "Unpin" : "Pin chat"}</button><button class="danger" data-chat-action="delete">${icon("delete")}Delete chat for me</button></div>`);
  modal.root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-chat-action]"); if (!button) return;
    const action = button.dataset.chatAction; button.disabled = true;
    try {
      if (action === "archive") await setArchived(card, true);
      if (action === "read") await updateDoc(doc(window.netChatDB, "chats", id), { [`unreadCount.${me()}`]: unread ? 0 : Math.max(1, Number(data.unreadCount?.[me()] || 0)) });
      if (action === "mute") await toggleMute(id, data);
      if (action === "pin") await updateDoc(doc(window.netChatDB, "chats", id), { pinnedBy: pinned ? arrayRemove(me()) : arrayUnion(me()) });
      if (action === "delete") {
        if (!confirm("Delete this chat from your list and hide its current messages for you? Other participants are not affected.")) { button.disabled = false; return; }
        await setDoc(doc(window.netChatDB, "user", me(), "archivedChats", id), { chatId: id, title, deletedAt: serverTimestamp(), archivedAt: serverTimestamp(), lastMessage: data.lastMessage || "" });
        await updateDoc(doc(window.netChatDB, "chats", id), { [`clearedFor.${me()}`]: serverTimestamp(), [`hiddenLastMessageFor.${me()}`]: data.lastMessageId || "" });
        card.remove();
      }
      modal.close();
    } catch (error) { console.error("Chat action failed:", error); notify("Action failed. Deploy the updated Firestore rules and retry."); button.disabled = false; }
  });
}
const chatList = $("#chatList");
if (chatList) {
  let pressTimer, longPressed = false, touchStart = null, swipedCard = null;
  const clearSwipe = () => { if (swipedCard) { swipedCard.classList.remove("nx-swiped"); $(".nx-swipe-action", swipedCard)?.remove(); } swipedCard = null; };
  chatList.addEventListener("click", (event) => {
    const action = event.target.closest(".nx-swipe-action");
    if (action) { event.preventDefault(); event.stopImmediatePropagation(); setArchived(swipedCard, true); clearSwipe(); return; }
    if (longPressed) { event.preventDefault(); event.stopImmediatePropagation(); longPressed = false; }
  }, true);
  chatList.addEventListener("contextmenu", (event) => { const card = event.target.closest(".chat-card[data-conversation-id]"); if (card) { event.preventDefault(); openChatActions(card); } });
  chatList.addEventListener("touchstart", (event) => {
    const card = event.target.closest(".chat-card[data-conversation-id]"); if (!card) return;
    const touch = event.touches[0]; touchStart = { x: touch.clientX, y: touch.clientY, card }; longPressed = false;
    pressTimer = setTimeout(() => { longPressed = true; openChatActions(card); }, 520);
  }, { passive: true });
  chatList.addEventListener("touchmove", (event) => {
    if (!touchStart) return; clearTimeout(pressTimer);
    const touch = event.touches[0]; const dx = touch.clientX - touchStart.x; const dy = touch.clientY - touchStart.y;
    if (Math.abs(dx) > Math.abs(dy) && dx < -35) {
      clearSwipe(); swipedCard = touchStart.card; swipedCard.classList.add("nx-swiped");
      const button = document.createElement("button"); button.type = "button"; button.className = "nx-swipe-action"; button.innerHTML = `${icon("archive")}<span>Archive</span>`; swipedCard.appendChild(button);
    }
  }, { passive: true });
  chatList.addEventListener("touchend", () => { clearTimeout(pressTimer); touchStart = null; }, { passive: true });
  document.addEventListener("click", (event) => { if (!event.target.closest(".chat-card")) clearSwipe(); });
}

/* ---------- avatar fallback and two-party call hardening ---------- */
document.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && !image.dataset.fallbackApplied) { image.dataset.fallbackApplied = "true"; image.src = "default-avatar.png"; }
}, true);
const NativePC = window.RTCPeerConnection;
if (NativePC) {
  window.RTCPeerConnection = class NetChatPeerConnection extends NativePC {
    constructor(config, ...rest) {
      super(config, ...rest);
      this.addEventListener("iceconnectionstatechange", () => {
        if (this.iceConnectionState === "disconnected") { try { this.restartIce(); } catch {} }
        if (this.iceConnectionState === "failed") notify("Call connection failed. STUN-only calls may need TURN servers on restricted mobile networks.", { duration: 5200 });
      });
    }
  };
}
const NativeRecorder = window.MediaRecorder;
if (NativeRecorder) {
  window.MediaRecorder = class NetChatMediaRecorder extends NativeRecorder {
    start(...args) { super.start(...args); clearTimeout(this.__nxCap); this.__nxCap = setTimeout(() => { if (this.state !== "inactive") this.stop(); }, 121000); }
    stop(...args) { clearTimeout(this.__nxCap); super.stop(...args); }
  };
}

window.addEventListener("netchat:chat-closed", () => cancelVoiceRecording(false));
window.netChatUserReady?.then(() => setTimeout(updateSendMode, 100));
updateSendMode();
console.info("NetChat integrated repairs loaded");
