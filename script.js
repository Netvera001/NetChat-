let messagesUnsubscribe = null;
const expandedMessageLengths = new Map();
let replyingToMessage = null;

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  orderBy,
  doc,
  getDoc,
  updateDoc,
  getDocFromCache,
  getDocs,
  setDoc,
  increment,
  arrayUnion,
  arrayRemove,
  deleteDoc,
  deleteField,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
  getDatabase,
  ref,
  set,
  onValue,
  onDisconnect,
  serverTimestamp as rtdbServerTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

// Global Window Bindings
window.netChatUpdateDoc = updateDoc;
window.netChatDoc = doc;
window.netChatQuery = query;
window.netChatWhere = where;
window.netChatCollection = collection;
window.netChatGetDocs = getDocs;
window.signOut = signOut;

// Track Active Chat State Globally
let activeTargetUser = null;
let activeConversationId = null;
let activeChatData = null;
const senderProfileCache = new Map();

function createConversationId(userA, userB) {
  return [userA, userB].sort().join("_");
}

async function getSenderProfile(uid) {
  if (!uid) return { uid: "", userFullname: "NetChat User", profileImage: "" };
  if (senderProfileCache.has(uid)) return senderProfileCache.get(uid);
  let profile = { uid, userFullname: "NetChat User", profileImage: "" };
  try {
    const snap = await getDoc(doc(window.netChatDB, "user", uid));
    if (snap.exists()) profile = { uid, ...snap.data() };
  } catch (error) {
    try {
      const cached = JSON.parse(localStorage.getItem(`nx:profile:${uid}`) || "null");
      if (cached) profile = { uid, ...cached };
    } catch {}
  }
  const safeProfile = {
    uid,
    userFullname: profile.userFullname || profile.name || "NetChat User",
    netChatID: profile.netChatID || "",
    profileImage: profile.profileImage || "",
    about: profile.about || "",
    privacy: profile.privacy || {}
  };
  if (uid !== window.netChatAuthUser?.uid) {
    const photoPrivacy = safeProfile.privacy?.pfp || "Everyone";
    if (photoPrivacy === "Nobody") safeProfile.profileImage = "";
    if (photoPrivacy === "Contacts") {
      const contact = await getDoc(doc(window.netChatDB, "user", uid, "contacts", window.netChatAuthUser?.uid || "")).catch(() => null);
      if (!contact?.exists()) safeProfile.profileImage = "";
    }
  }
  senderProfileCache.set(uid, safeProfile);
  try { localStorage.setItem(`nx:profile:${uid}`, JSON.stringify(safeProfile)); } catch {}
  return safeProfile;
}

function cleanupConversationListeners() {
  if (currentTypingUnsubscribe) { currentTypingUnsubscribe(); currentTypingUnsubscribe = null; }
  if (currentPresenceUnsubscribe) { currentPresenceUnsubscribe(); currentPresenceUnsubscribe = null; }
  if (messagesUnsubscribe) { messagesUnsubscribe(); messagesUnsubscribe = null; }
}

async function openConversation(target, conversationId, options = {}) {
  const user = window.netChatAuthUser;
  if (!user || !target || !conversationId) return false;
  const targetUid = target.theNewCreatedUser || target.uid;
  const isGroup = target.isGroup === true || target.type === "group";
  if (!isGroup && (!targetUid || targetUid === user.uid)) {
    toast("You cannot start a private chat with yourself.");
    return false;
  }

  setTypingStatus(false);
  clearTimeout(typingTimeout);
  cleanupConversationListeners();
  activeTargetUser = target;
  activeConversationId = isGroup ? conversationId : createConversationId(user.uid, targetUid);
  activeChatData = isGroup ? target : null;

  const avatar = document.getElementById("chatUserAvatar");
  const name = document.getElementById("chatUserName");
  const status = document.getElementById("chatUserStatus");
  const members = document.getElementById("groupMembersBtn");
  if (avatar) avatar.src = target.profileImage || target.groupImage || "default-avatar.png";
  if (name) name.textContent = target.userFullname || target.groupName || "NetChat User";
  if (status) status.textContent = isGroup ? "Group" : "";
  if (members) members.hidden = !isGroup;
  const contactItem = document.getElementById("viewContactBtn");
  if (contactItem) contactItem.innerHTML = `<span class="material-symbols-outlined">${isGroup ? "groups" : "person"}</span> ${isGroup ? "Group info" : "View contact"}`;
  const deleteGroupItem = document.getElementById("deleteGroupMenuItem");
  if (deleteGroupItem) deleteGroupItem.hidden = !isGroup;
  document.getElementById("chatScreen")?.classList.toggle("is-group-chat", isGroup);
  document.getElementById("chatScreen")?.setAttribute("data-conversation-id", activeConversationId);
  document.getElementById("chatMessagesBody")?.setAttribute("aria-live", "polite");
  const screen = document.getElementById("chatScreen");
  if (screen) screen.style.display = "flex";

  listenToConversationMessages(activeConversationId);
  if (isGroup) {
    window.dispatchEvent(new CustomEvent("netchat:group-open", { detail: { conversationId: activeConversationId, chat: target } }));
  } else {
    window.dispatchEvent(new CustomEvent("netchat:private-open", { detail: { conversationId: activeConversationId, target } }));
    listenToTypingStatus(activeConversationId, targetUid);
    listenToUserPresence(targetUid);
  }
  markMessagesAsRead(activeConversationId).catch((error) => console.warn("Read state could not be updated:", error));
  if (options.focus) setTimeout(() => document.getElementById("messageInput")?.focus(), 80);
  return true;
}
window.netChatOpenConversation = openConversation;
window.netChatGetActiveConversation = () => ({ target: activeTargetUser, conversationId: activeConversationId, chatData: activeChatData });
window.netChatGetSenderProfile = getSenderProfile;
window.netChatStopTyping = () => setTypingStatus(false);
window.netChatUpdateActiveChat = (data) => {
  if (!data || !activeTargetUser?.isGroup) return;
  activeChatData = { ...(activeChatData || {}), ...data };
  Object.assign(activeTargetUser, data, { isGroup: true });
};

function createContactRequestId(fromUid, toUid) {
  return `${fromUid}_${toUid}`;
}

async function sendContactRequest() {
  const currentUser = window.netChatAuthUser;
  const targetUser = activeTargetUser;

  if (!currentUser || !targetUser?.uid) return;
  if (currentUser.uid === targetUser.uid) return;

  const requestId = createContactRequestId(currentUser.uid, targetUser.uid);
  const requestRef = doc(window.netChatDB, "contactRequests", requestId);
  const existingRequest = await getDoc(requestRef);

  if (existingRequest.exists()) {
    const existingData = existingRequest.data();
    if (existingData.status === "pending" || existingData.status === "accepted") return;
  }

  await setDoc(requestRef, {
    fromUid: currentUser.uid,
    toUid: targetUser.uid,
    status: "pending",
    createdAt: serverTimestamp(),
    respondedAt: null
  });

  const systemInboxRef = doc(
    window.netChatDB,
    "systemInbox",
    targetUser.uid,
    "items",
    requestId
  );

  await setDoc(systemInboxRef, {
    type: "contact_request",
    requestId: requestId,
    fromUid: currentUser.uid,
    createdAt: serverTimestamp(),
    read: false
  });
}

async function getContactRelationship(targetUid) {
  const currentUser = window.netChatAuthUser;
  if (!currentUser || !targetUid) return "none";

  const myContactRef = doc(window.netChatDB, "user", currentUser.uid, "contacts", targetUid);
  const sentRequestRef = doc(window.netChatDB, "contactRequests", createContactRequestId(currentUser.uid, targetUid));
  const receivedRequestRef = doc(window.netChatDB, "contactRequests", createContactRequestId(targetUid, currentUser.uid));

  const [contactSnap, sentRequestSnap, receivedRequestSnap] = await Promise.all([
    getDoc(myContactRef),
    getDoc(sentRequestRef),
    getDoc(receivedRequestRef)
  ]);

  if (contactSnap.exists()) return "contact";
  if (sentRequestSnap.exists() && sentRequestSnap.data().status === "pending") return "request_sent";
  if (receivedRequestSnap.exists() && receivedRequestSnap.data().status === "pending") return "request_received";
  return "none";
}

async function acceptContactRequest(requestId) {
  const currentUser = window.netChatAuthUser;
  if (!currentUser || !requestId) return false;

  const requestRef = doc(window.netChatDB, "contactRequests", requestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) return false;

  const requestData = requestSnap.data();
  if (requestData.toUid !== currentUser.uid || requestData.status !== "pending") return false;

  const fromUid = requestData.fromUid;
  const toUid = requestData.toUid;

  const myContactRef = doc(window.netChatDB, "user", toUid, "contacts", fromUid);
  const otherContactRef = doc(window.netChatDB, "user", fromUid, "contacts", toUid);

  const batch = writeBatch(window.netChatDB);

  batch.set(myContactRef, { status: "accepted", addedAt: serverTimestamp() });
  batch.set(otherContactRef, { status: "accepted", addedAt: serverTimestamp() });

  const systemInboxItemRef = doc(window.netChatDB, "systemInbox", toUid, "items", requestId);

  batch.update(requestRef, { status: "accepted", respondedAt: serverTimestamp() });
  batch.update(systemInboxItemRef, {
    read: true,
    resolved: true,
    resolution: "accepted",
    resolvedAt: serverTimestamp()
  });

  await batch.commit();
  return true;
}

async function declineContactRequest(requestId) {
  const currentUser = window.netChatAuthUser;
  if (!currentUser || !requestId) return false;

  const requestRef = doc(window.netChatDB, "contactRequests", requestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) return false;

  const requestData = requestSnap.data();
  if (requestData.toUid !== currentUser.uid || requestData.status !== "pending") return false;

  const systemInboxItemRef = doc(window.netChatDB, "systemInbox", currentUser.uid, "items", requestId);
  const batch = writeBatch(window.netChatDB);

  batch.update(requestRef, { status: "declined", respondedAt: serverTimestamp() });
  batch.update(systemInboxItemRef, {
    read: true,
    resolved: true,
    resolution: "declined",
    resolvedAt: serverTimestamp()
  });

  await batch.commit();
  return true;
}

if (!window.netChatUserReady) {
  window.netChatUserReady = new Promise((resolve) => {
    window.resolveNetChatUserReady = resolve;
  });
}

const firebaseConfig = {
  apiKey: "AIzaSyCbwcl2SX_oogemIA4Z9pdZmhBAPXQDzA4",
  authDomain: "example-48a2b.firebaseapp.com",
  projectId: "example-48a2b",
  storageBucket: "example-48a2b.firebasestorage.app",
  messagingSenderId: "242187342146",
  appId: "1:242187342146:web:2c9861750c9a69d45bb8db",
  measurementId: "G-K4BJ5VLEFS"
};

const app = initializeApp(firebaseConfig);
window.netChatFirebaseApp = app;
// Shared HTML escaping helper for group-management callbacks defined outside feature closures.
window.safe = window.safe || ((v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
console.log("FIREBASE PROJECT:", app.options.projectId);

// Analytics is optional. Some browsers/privacy settings block it; that must
// not prevent authentication, chats, or the rest of NetChat from starting.
let analytics = null;
try {
  analytics = getAnalytics(app);
} catch (error) {
  console.warn("Firebase Analytics unavailable; continuing without analytics.", error);
}

// Use standard Firestore memory caching for reliability. Persistent IndexedDB
// caching can produce asynchronous DOMException/AbortError failures on localhost
// when the browser cache is stale, locked, or interrupted.
let db;
try {
  db = getFirestore(app);
} catch (error) {
  console.error("Firestore initialization failed:", error);
  throw error;
}

window.netChatDB = db;
const placeholder = document.querySelector(".in");

const auth = getAuth(app);
window.netChatAuth = auth;
const realtimeDB = getDatabase(app);
window.netChatRealtimeDB = realtimeDB;

onAuthStateChanged(auth, async (user) => {
  if (!navigator.onLine) {
    alert("NetChat requires an internet connection.");
    return;
  }

  if (user) {
    window.netChatAuthUser = user;
    if (typeof renderMyCard === "function") renderMyCard();

    const userDocRef = doc(db, "user", user.uid);
    window.netChatUserRef = userDocRef;

    let userSnapshot;
    try {
      userSnapshot = await getDoc(userDocRef);
    } catch (error) {
      console.log("Online Firestore read failed:", error);
      try {
        userSnapshot = await getDocFromCache(userDocRef);
      } catch (cacheError) {
        console.error("Offline cache read failed:", cacheError);
        // Do not leave the rest of the UI waiting forever for netChatUserReady.
        // A signed-in user without a readable profile should be sent through the
        // normal auth flow rather than seeing a half-initialized application.
        window.netChatAuthUser = user;
        window.netChatUserData = {
          uid: user.uid,
          userFullname: user.displayName || (user.email ? user.email.split("@")[0] : "NetChat User"),
          userEmail: user.email || "",
          netChatID: `NC-${user.uid.slice(0, 8).toUpperCase()}`
        };
        window.resolveNetChatUserReady?.(window.netChatUserData);
        return;
      }
    }

    if (!userSnapshot.exists()) {
      // Recover gracefully if an Auth account exists but its profile document is missing.
      const recoveredProfile = {
        uid: user.uid,
        userFullname: user.displayName || (user.email ? user.email.split("@")[0] : "NetChat User"),
        userEmail: user.email || "",
        netChatID: `NC-${user.uid.slice(0, 8).toUpperCase()}`,
        profileImage: user.photoURL || "",
        about: "Hey there! I am using NetChat.",
        privacy: { lastSeen: "Everyone", pfp: "Everyone", readReceipts: true, typing: true, grpInv: "Everyone" },
        createdAt: serverTimestamp()
      };
      try {
        await setDoc(userDocRef, recoveredProfile, { merge: true });
        userSnapshot = await getDoc(userDocRef);
      } catch (profileError) {
        console.error("Could not recover missing profile document:", profileError);
        window.netChatUserData = recoveredProfile;
        window.resolveNetChatUserReady?.(recoveredProfile);
        return;
      }
    }

    const userData = userSnapshot.data();

    if (!userData.privacy) {
      const defaultPrivacy = {
        lastSeen: "Everyone",
        pfp: "Everyone",
        readReceipts: true,
        typing: true,
        grpInv: "Everyone"
      };
      userData.privacy = defaultPrivacy;
      try {
        await setDoc(userDocRef, { privacy: defaultPrivacy }, { merge: true });
      } catch (error) {
        console.error("Failed to save default privacy settings:", error);
      }
    }

    window.netChatUserData = userData;
    window.resolveNetChatUserReady(userData);

    const profileImage = document.getElementById("profileImage");

    if (userData && userData.profileImage) {
      profileImage.src = userData.profileImage;
      profileImage.style.display = "block";

      const myStatusAvatarImg = document.getElementById("myAvatarImg");
      if (myStatusAvatarImg) myStatusAvatarImg.src = userData.profileImage;

      placeholder.style.display = "none";

      const statusProfileImage = document.getElementById("statusProfileImage");
      if (statusProfileImage) statusProfileImage.src = userData.profileImage;
    } else {
      profileImage.style.display = "none";
      placeholder.style.display = "flex";
    }

    document.getElementById("profileName").textContent = userData.userFullname || "";

    const statusProfileName = document.getElementById("statusProfileName");
    if (statusProfileName) statusProfileName.textContent = userData.userFullname || "My status";

    document.getElementById("netchatIdValue").textContent = userData.netChatID || "—";
    const settingsEmailEl = document.getElementById("settingsEmail");
    if (settingsEmailEl) settingsEmailEl.textContent = user.email || userData.userEmail || "—";
    const settingsIdEl = document.getElementById("settingsNetchatId");
    if (settingsIdEl) settingsIdEl.textContent = userData.netChatID || "—";
    document.getElementById("bio").textContent = userData.about || "";
  } else {
    location.href = "auth.html";
  }
});

const chatList = document.getElementById("chatList");

function formatChatTime(timestamp) {
  if (!timestamp) return "";

  const date = timestamp.toDate();
  const nowDate = new Date();

  const isToday =
    date.getFullYear() === nowDate.getFullYear() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getDate() === nowDate.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  const yesterday = new Date(nowDate);
  yesterday.setDate(nowDate.getDate() - 1);

  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) return "Yesterday";

  if (date.getFullYear() === nowDate.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g,
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function safeMessageMediaUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return ["https:", "http:", "blob:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function formatMessageBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatAudioSeconds(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function messageDateLabel(value) {
  const date = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function senderTone(uid) {
  let hash = 0;
  for (const char of String(uid || "")) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 6;
}

function renderVoiceOrAudio(media, index) {
  const url = safeMessageMediaUrl(media.url);
  if (!url) return `<div class="chat-message-media-failed"><span class="material-symbols-outlined">error</span><span>Audio unavailable</span></div>`;
  const duration = Number(media.duration || 0);
  const bars = Array.from({ length: 30 }, (_, bar) => {
    const height = 6 + ((bar * 11 + index * 7 + Number(media.bytes || 0)) % 19);
    return `<i style="--h:${height}px"></i>`;
  }).join("");
  const label = media.fileName && !/^voice-\d+\.webm$/i.test(media.fileName) ? `<span class="nx-audio-name">${escapeHTML(media.fileName)}</span>` : "";
  return `<div class="nx-voice-note" data-audio-index="${index}">
    <audio preload="metadata" src="${escapeHTML(url)}"></audio>
    <button type="button" class="nx-voice-play" aria-label="Play audio"><span class="material-symbols-outlined">play_arrow</span></button>
    <div class="nx-voice-track">${label}<div class="nx-voice-wave" aria-hidden="true">${bars}</div><progress max="100" value="0" aria-label="Audio progress"></progress><small>0:00${duration ? ` / ${formatAudioSeconds(duration)}` : ""}</small></div>
    <button type="button" class="nx-voice-speed" aria-label="Change playback speed">1×</button>
  </div>`;
}

function renderDocumentMessage(media) {
  const url = safeMessageMediaUrl(media.url);
  const name = media.fileName || `Document.${media.format || "file"}`;
  const details = [String(media.format || name.split(".").pop() || "FILE").toUpperCase(), formatMessageBytes(media.bytes)].filter(Boolean).join(" · ");
  if (!url) return `<div class="chat-message-media-failed"><span class="material-symbols-outlined">error</span><span>Document unavailable</span></div>`;
  return `<a class="nx-document-message" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">
    <span class="nx-document-icon"><span class="material-symbols-outlined">description</span></span>
    <span class="nx-document-meta"><b>${escapeHTML(name)}</b><small>${escapeHTML(details)}</small></span>
    <span class="material-symbols-outlined nx-document-open">open_in_new</span>
  </a>`;
}

function renderPollMessage(messageData, messageId) {
  const poll = messageData.poll;
  if (!poll?.question || !Array.isArray(poll.options)) return "";
  const myUid = window.netChatAuthUser?.uid;
  const votes = Object.entries(messageData.pollVotes || {});
  const optionIds = new Set(poll.options.map((option) => option.id));
  const validVotes = votes.filter(([, value]) => (Array.isArray(value) ? value : [value]).some((id) => optionIds.has(id)));
  const mySelection = myUid ? (votes.find(([uid]) => uid === myUid)?.[1] || []) : [];
  const mine = Array.isArray(mySelection) ? mySelection : [mySelection];
  const closeDate = poll.closesAt ? new Date(poll.closesAt) : null;
  const closed = !!(closeDate && !Number.isNaN(closeDate.getTime()) && closeDate.getTime() <= Date.now());
  const counts = Object.fromEntries(poll.options.map((option) => [option.id, 0]));
  validVotes.forEach(([, value]) => (Array.isArray(value) ? value : [value]).forEach((id) => { if (id in counts) counts[id] += 1; }));
  const totalSelections = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const options = poll.options.map((option) => {
    const count = counts[option.id] || 0;
    const percent = totalSelections ? Math.round(count / totalSelections * 100) : 0;
    const selected = mine.includes(option.id);
    return `<button type="button" class="nx-poll-option ${selected ? "selected" : ""}" data-poll-vote="${escapeHTML(option.id)}" data-poll-message-id="${escapeHTML(messageId)}" aria-pressed="${selected}" ${closed || !myUid ? "disabled" : ""}>
      <i style="width:${percent}%"></i><span>${escapeHTML(option.text)}</span><b>${count}</b>
    </button>`;
  }).join("");
  const closing = closed ? "Poll closed" : closeDate && !Number.isNaN(closeDate.getTime()) ? `Closes ${closeDate.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : (poll.multiple ? "Choose one or more options" : "Choose one option");
  return `<div class="nx-poll" data-poll-id="${escapeHTML(messageId)}">
    <div class="nx-poll-question"><span class="material-symbols-outlined">poll</span><b>${escapeHTML(poll.question)}</b></div>
    <small>${escapeHTML(closing)}</small><div class="nx-poll-options">${options}</div>
    <small>${validVotes.length} vote${validVotes.length === 1 ? "" : "s"}${poll.multiple ? " · Multiple answers allowed" : ""}</small>
  </div>`;
}

/* ---------- global per-conversation chat theme runtime ---------- */
const GLOBAL_CHAT_THEMES = [
  { id:"ocean", wall:"#071923", pattern:"radial-gradient(rgba(0,229,255,.10) 1px,transparent 1px)", incoming:"rgba(17,43,55,.88)", out1:"#4338CA", out2:"#6366F1", border:"rgba(129,140,248,.38)", shape:"round", fx:"" },
  { id:"sunset", wall:"#211018", pattern:"radial-gradient(rgba(255,125,170,.11) 1px,transparent 1px)", incoming:"rgba(64,31,49,.90)", out1:"#ff5f8f", out2:"#ff8a3d", border:"rgba(255,120,150,.30)", shape:"round", fx:"" },
  { id:"aurora", wall:"#100d24", pattern:"radial-gradient(rgba(157,78,221,.13) 1px,transparent 1px)", incoming:"rgba(39,30,67,.90)", out1:"#9d4edd", out2:"#2dd4bf", border:"rgba(157,78,221,.32)", shape:"pill", fx:"neon" },
  { id:"forest", wall:"#081b16", pattern:"radial-gradient(rgba(52,211,153,.10) 1px,transparent 1px)", incoming:"rgba(19,55,43,.90)", out1:"#10b981", out2:"#047857", border:"rgba(52,211,153,.30)", shape:"round", fx:"" },
  { id:"rose", wall:"#211016", pattern:"radial-gradient(rgba(244,114,182,.10) 1px,transparent 1px)", incoming:"rgba(65,31,48,.90)", out1:"#f472b6", out2:"#db2777", border:"rgba(244,114,182,.28)", shape:"pill", fx:"" },
  { id:"gold", wall:"#21190a", pattern:"radial-gradient(rgba(251,191,36,.11) 1px,transparent 1px)", incoming:"rgba(62,48,20,.92)", out1:"#fbbf24", out2:"#d97706", border:"rgba(251,191,36,.30)", shape:"round", fx:"" },
  { id:"ice", wall:"#081722", pattern:"radial-gradient(rgba(125,211,252,.12) 1px,transparent 1px)", incoming:"rgba(25,48,64,.92)", out1:"#38bdf8", out2:"#2563eb", border:"rgba(125,211,252,.28)", shape:"sharp", fx:"glass" },
  { id:"lavender", wall:"#171022", pattern:"radial-gradient(rgba(196,181,253,.10) 1px,transparent 1px)", incoming:"rgba(49,35,72,.90)", out1:"#c084fc", out2:"#7c3aed", border:"rgba(196,181,253,.28)", shape:"pill", fx:"glass" },
  { id:"cherry", wall:"#200a0f", pattern:"radial-gradient(rgba(248,113,113,.10) 1px,transparent 1px)", incoming:"rgba(67,27,34,.90)", out1:"#ef4444", out2:"#be123c", border:"rgba(248,113,113,.28)", shape:"sharp", fx:"neon" },
  { id:"midnight", wall:"#050912", pattern:"radial-gradient(rgba(0,240,255,.07) 1px,transparent 1px)", incoming:"rgba(20,28,44,.94)", out1:"#00f0ff", out2:"#2563eb", border:"rgba(0,240,255,.32)", shape:"sharp", fx:"neon" },
  { id:"glass", wall:"#0d1420", pattern:"linear-gradient(135deg,rgba(255,255,255,.04) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.04) 50%,rgba(255,255,255,.04) 75%,transparent 75%)", incoming:"rgba(255,255,255,.08)", out1:"rgba(0,229,255,.78)", out2:"rgba(124,58,237,.78)", border:"rgba(255,255,255,.20)", shape:"round", fx:"glass" },
  { id:"paper", wall:"#1b1915", pattern:"linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px)", incoming:"rgba(66,61,52,.92)", out1:"#d97706", out2:"#b45309", border:"rgba(251,191,36,.22)", shape:"sharp", fx:"paper" }
];
const globalChatThemeStore = {
  key(id) { return `netchat:chat-theme:${id}`; },
  get(id) { try { return localStorage.getItem(this.key(id)) || "ocean"; } catch { return "ocean"; } }
};
function applyChatTheme(conversationId, themeId = globalChatThemeStore.get(conversationId)) {
  const body = document.getElementById("chatMessagesBody");
  if (!body || !conversationId) return;
  const theme = GLOBAL_CHAT_THEMES.find(t => t.id === themeId) || GLOBAL_CHAT_THEMES[0];
  body.classList.add("nc-chat-themed");
  [...body.classList].filter(c => /^theme-(round|sharp|pill|glass|neon|paper)$/.test(c)).forEach(c => body.classList.remove(c));
  body.classList.add(`theme-${theme.shape}`);
  if (theme.fx) body.classList.add(`theme-${theme.fx}`);
  body.style.setProperty("--theme-wall", theme.wall);
  body.style.setProperty("--theme-pattern", theme.pattern);
  body.style.setProperty("--theme-in", theme.incoming);
  body.style.setProperty("--theme-out1", theme.out1);
  body.style.setProperty("--theme-out2", theme.out2);
  body.style.setProperty("--theme-border", theme.border);
}
window.netChatApplyChatTheme = applyChatTheme;

function listenToConversationMessages(conversationId) {
  if (messagesUnsubscribe) messagesUnsubscribe();
  applyChatTheme(conversationId);

  const messagesRef = collection(window.netChatDB, "chats", conversationId, "messages");
  const messagesQuery = query(messagesRef, orderBy("timestamp", "asc"));
  let renderRevision = 0;

  const renderSnapshot = async (snapshot, options = {}) => {
    const revision = ++renderRevision;
    const chatMessagesBody = document.getElementById("chatMessagesBody");
    if (!chatMessagesBody) return;
    const myUid = window.netChatAuthUser?.uid;
    const isGroup = activeTargetUser?.isGroup === true || activeTargetUser?.type === "group";
    const visibleDocs = snapshot.docs.filter((messageDoc) => {
      const messageData = messageDoc.data();
      const expiryMs = messageData.expiresAt?.toMillis ? messageData.expiresAt.toMillis() : (messageData.expiresAt ? new Date(messageData.expiresAt).getTime() : 0);
      return !(Array.isArray(messageData.hiddenFor) && messageData.hiddenFor.includes(myUid)) && !(expiryMs && expiryMs <= Date.now());
    });
    const messageProfiles = new Map();
    if (isGroup) {
      const senderIds = new Set();
      visibleDocs.forEach((messageDoc) => {
        const data = messageDoc.data();
        if (data.senderId) senderIds.add(data.senderId);
        if (data.replyTo?.senderId) senderIds.add(data.replyTo.senderId);
      });
      await Promise.all([...senderIds].map(async (uid) => {
        const profile = await getSenderProfile(uid);
        messageProfiles.set(uid, profile);
      }));
    }
    if (revision !== renderRevision || activeConversationId !== conversationId) return;

    window.currentChatSnapshotDocs = snapshot.docs;
    const previousTop = chatMessagesBody.scrollTop;
    const nearBottom = chatMessagesBody.scrollHeight - previousTop - chatMessagesBody.clientHeight < 150;
    const serverClientIds = new Set(snapshot.docs.map((messageDoc) => messageDoc.data().clientId).filter(Boolean));
    const optimisticRows = [...chatMessagesBody.querySelectorAll(".optimistic-message")].filter((row) => !serverClientIds.has(row.dataset.clientMessageId));
    let messagesHTML = "";
    let previousDay = "";
    const unreadDocs = [];

    visibleDocs.forEach((messageDoc) => {
      const messageData = messageDoc.data();
      const isOutgoing = messageData.senderId === myUid;
      const messageId = messageDoc.id;
      const fullText = messageData.text || "";
      const replyTo = messageData.replyTo;
      const isDeleted = messageData.deleted === true;
      const isSystem = messageData.type === "system";
      const visibleLength = expandedMessageLengths.get(messageId) || 500;
      const displayText = fullText.slice(0, visibleLength);
      if (!isOutgoing && messageData.status !== "read") unreadDocs.push(messageDoc);

      const date = messageData.timestamp?.toDate ? messageData.timestamp.toDate() : null;
      const messageTime = date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      const day = messageDateLabel(messageData.timestamp);
      if (day && day !== previousDay) {
        messagesHTML += `<div class="nx-message-day" role="separator"><span>${escapeHTML(day)}</span></div>`;
        previousDay = day;
      }

      if (isSystem) {
        messagesHTML += `<div class="nx-system-message" data-message-id="${escapeHTML(messageId)}"><span class="material-symbols-outlined">info</span><p>${escapeHTML(fullText)}</p>${messageTime ? `<small>${escapeHTML(messageTime)}</small>` : ""}</div>`;
        return;
      }

      const status = ["sent", "delivered", "read"].includes(messageData.status) ? messageData.status : "sent";
      const statusIcon = isOutgoing ? `<span class="material-symbols-outlined msg-status ${status}">${status === "delivered" || status === "read" ? "done_all" : "done"}</span>` : "";
      const hasMore = visibleLength < fullText.length;
      const replySender = replyTo?.senderId === myUid ? (window.netChatUserData?.userFullname || "You") : (messageProfiles.get(replyTo?.senderId)?.userFullname || replyTo?.senderName || "NetChat User");
      const replyHTML = !isDeleted && replyTo ? `<div class="message-reply" data-reply-to="${escapeHTML(replyTo.messageId || "")}"><span class="material-symbols-outlined">reply</span><div class="message-reply-content"><small>${escapeHTML(replySender)}</small><p>${escapeHTML(replyTo.text || "Media message")}</p></div></div>` : "";

      const mediaArray = isDeleted ? [] : (Array.isArray(messageData.media) ? messageData.media : []);
      const visualMedia = mediaArray.filter((media) => media.resourceType === "image" || media.resourceType === "video" || (!media.resourceType && media.url));
      const otherMedia = mediaArray.filter((media) => !visualMedia.includes(media));
      const maxVisible = 4;
      const overflowCount = Math.max(0, visualMedia.length - maxVisible);
      const mediaItemsHTML = visualMedia.slice(0, maxVisible).map((media, index) => {
        const isVideo = media.resourceType === "video";
        const isUploading = media.uploadState === "uploading";
        const isFailed = media.uploadState === "failed";
        const url = safeMessageMediaUrl(media.url);
        if (isFailed || !url) return `<div class="chat-message-media-failed"><span class="material-symbols-outlined">error</span><span>${isFailed ? "Upload failed" : "Media unavailable"}</span></div>`;
        const showOverflowBadge = overflowCount > 0 && index === maxVisible - 1;
        return `<div class="chat-media-container">${isVideo ? `<video class="chat-message-video" src="${escapeHTML(url)}" ${isUploading ? "muted playsinline" : "controls playsinline"}></video>` : `<img class="chat-message-image" src="${escapeHTML(url)}" alt="Shared media" loading="lazy">`}${isUploading ? `<div class="media-upload-overlay"><span class="material-symbols-outlined spin">${isVideo ? "videocam" : "progress_activity"}</span><span class="upload-text">Uploading…</span></div>` : ""}${showOverflowBadge ? `<div class="media-overflow-overlay"><span>+${overflowCount}</span></div>` : ""}</div>`;
      }).join("");
      const mediaHTML = visualMedia.length ? `<div class="chat-media-grid" data-count="${Math.min(visualMedia.length, maxVisible)}">${mediaItemsHTML}</div>` : "";
      const attachmentsHTML = otherMedia.map((media, index) => media.resourceType === "audio" ? renderVoiceOrAudio(media, index) : renderDocumentMessage(media)).join("");
      const pollHTML = !isDeleted && messageData.type === "poll" ? renderPollMessage(messageData, messageId) : "";
      const readButton = fullText.length > 500 ? `<button class="read-more-btn" data-message-id="${escapeHTML(messageId)}">${hasMore ? "Read more" : "Read less"}</button>` : "";
      const messageReactions = messageData.reactions || {};
      const reactionChipsHTML = Object.entries(messageReactions).filter(([reactionUid]) => reactionUid && reactionUid !== "undefined").map(([reactionUid, emoji]) => `<button class="msg-reaction-chip ${reactionUid === myUid ? "mine" : ""}" data-react-uid="${escapeHTML(reactionUid)}">${escapeHTML(emoji)}</button>`).join("");
      const reactionsHTML = reactionChipsHTML ? `<div class="msg-reactions">${reactionChipsHTML}</div>` : "";
      const sender = messageProfiles.get(messageData.senderId) || { uid: messageData.senderId, userFullname: "NetChat User", profileImage: "" };
      const groupAvatar = isGroup && !isOutgoing ? `<button type="button" class="msg-sender-avatar sender-tone-${senderTone(messageData.senderId)}" data-sender-id="${escapeHTML(messageData.senderId)}" aria-label="View ${escapeHTML(sender.userFullname)}"><img src="${escapeHTML(sender.profileImage || "default-avatar.png")}" alt=""></button>` : "";
      const senderName = isGroup && !isOutgoing ? `<button type="button" class="msg-sender-name sender-tone-${senderTone(messageData.senderId)}" data-sender-id="${escapeHTML(messageData.senderId)}">${escapeHTML(sender.userFullname)}</button>` : "";
      const bubble = `<div class="msg-bubble">${senderName}${replyHTML}${mediaHTML}${attachmentsHTML}${pollHTML}${!isDeleted && fullText ? `<p class="msg-text">${escapeHTML(displayText)}</p>` : ""}${isDeleted ? `<p class="msg-text msg-deleted">This message was deleted</p>` : ""}${readButton}<div class="msg-meta"><span class="msg-time">${escapeHTML(messageTime)}</span>${statusIcon}</div>${reactionsHTML}</div>`;
      messagesHTML += `<div class="msg-row ${isOutgoing ? "outgoing" : "incoming"} ${isGroup && !isOutgoing ? "group-incoming" : ""}" data-message-id="${escapeHTML(messageId)}" data-sender-uid="${escapeHTML(messageData.senderId || "")}">${groupAvatar}${isGroup && !isOutgoing ? `<div class="msg-group-content">${bubble}</div>` : bubble}</div>`;
    });

    const groupInfo = activeChatData || activeTargetUser || {};
    const welcomeHTML = isGroup ? `<div class="nx-group-welcome"><span class="nx-group-welcome-icon"><span class="material-symbols-outlined">groups</span></span><div><b>${escapeHTML(groupInfo.groupName || "Group conversation")}</b><p>${escapeHTML(groupInfo.groupDescription || "You can view the group description, members and settings in Group info.")}</p><button type="button" data-open-group-info>View group info <span class="material-symbols-outlined">arrow_forward</span></button></div></div>` : "";
    chatMessagesBody.innerHTML = welcomeHTML + (messagesHTML || `<div class="chat-empty-state"><span class="material-symbols-outlined">forum</span><b>No messages yet</b><p>Start the conversation with your first message.</p></div>`);
    optimisticRows.forEach((row) => chatMessagesBody.appendChild(row));

    chatMessagesBody.querySelectorAll(".message-reply").forEach((replyElement) => {
      replyElement.addEventListener("click", () => {
        const originalMessageId = replyElement.dataset.replyTo;
        if (!originalMessageId) return;
        const originalMessage = [...chatMessagesBody.querySelectorAll("[data-message-id]")].find((row) => row.dataset.messageId === originalMessageId);
        if (!originalMessage) return;
        originalMessage.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => { originalMessage.classList.add("reply-highlight"); setTimeout(() => originalMessage.classList.remove("reply-highlight"), 1500); }, 350);
      });
    });

    chatMessagesBody.querySelectorAll(".msg-row").forEach((messageRow) => {
      let startX = 0, currentX = 0, isSwiping = false;
      messageRow.addEventListener("touchstart", (event) => { startX = currentX = event.touches[0].clientX; isSwiping = false; }, { passive: true });
      messageRow.addEventListener("touchmove", (event) => {
        currentX = event.touches[0].clientX;
        const distance = currentX - startX;
        if (distance > 10) { isSwiping = true; messageRow.style.transform = `translateX(${Math.min(distance, 80)}px)`; }
      }, { passive: true });
      messageRow.addEventListener("touchend", () => {
        const distance = currentX - startX;
        messageRow.style.transform = "";
        if (isSwiping && distance >= 50) {
          const messageDoc = snapshot.docs.find((item) => item.id === messageRow.dataset.messageId);
          if (!messageDoc || messageDoc.data().type === "system") return;
          const data = messageDoc.data();
          replyingToMessage = { id: messageDoc.id, text: data.text || data.poll?.question || "Media message", senderId: data.senderId, senderName: data.senderId === myUid ? (window.netChatUserData?.userFullname || "You") : (messageProfiles.get(data.senderId)?.userFullname || activeTargetUser?.userFullname || "NetChat User") };
          const replyPreview = document.getElementById("replyPreview");
          const replyPreviewText = document.getElementById("replyPreviewText");
          if (replyPreview && replyPreviewText) { replyPreviewText.textContent = replyingToMessage.text; replyPreview.style.display = "flex"; }
        }
        isSwiping = false;
      });
    });

    chatMessagesBody.querySelectorAll(".read-more-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const messageId = button.dataset.messageId;
        const currentLength = expandedMessageLengths.get(messageId) || 500;
        const messageDoc = snapshot.docs.find((item) => item.id === messageId);
        if (!messageDoc) return;
        const fullText = messageDoc.data().text || "";
        if (currentLength < fullText.length) expandedMessageLengths.set(messageId, Math.min(currentLength + 500, fullText.length));
        else expandedMessageLengths.delete(messageId);
        renderSnapshot(snapshot, { preserveScroll: true });
      });
    });

    const cancelReplyBtn = document.getElementById("cancelReplyBtn");
    if (cancelReplyBtn) cancelReplyBtn.onclick = () => { replyingToMessage = null; const replyPreview = document.getElementById("replyPreview"); if (replyPreview) replyPreview.style.display = "none"; };

    chatMessagesBody.querySelectorAll(".msg-reaction-chip").forEach((chip) => {
      chip.addEventListener("click", async (event) => {
        event.stopPropagation();
        const ownerUid = chip.dataset.reactUid;
        if (ownerUid !== myUid) return;
        const rowEl = chip.closest(".msg-row");
        const messageDoc = snapshot.docs.find((item) => item.id === rowEl?.dataset.messageId);
        if (messageDoc) await updateDoc(messageDoc.ref, { [`reactions.${ownerUid}`]: deleteField() });
      });
    });

    chatMessagesBody.querySelectorAll(".msg-bubble").forEach((bubble) => {
      let pressTimer = null;
      const startPress = (event) => {
        const targetId = bubble.closest(".msg-row")?.dataset.messageId;
        if (!targetId) return;
        const pointX = event.touches?.[0]?.clientX ?? event.clientX ?? window.innerWidth / 2;
        const pointY = event.touches?.[0]?.clientY ?? event.clientY ?? window.innerHeight / 2;
        pressTimer = setTimeout(() => { pressTimer = null; openMessageActions(targetId, pointX, pointY); }, 480);
      };
      const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      bubble.addEventListener("touchstart", startPress, { passive: true });
      bubble.addEventListener("touchend", cancelPress);
      bubble.addEventListener("touchmove", cancelPress);
      bubble.addEventListener("mousedown", startPress);
      bubble.addEventListener("mouseup", cancelPress);
      bubble.addEventListener("mouseleave", cancelPress);
      bubble.addEventListener("contextmenu", (event) => event.preventDefault());
    });

    if (options.preserveScroll) chatMessagesBody.scrollTop = Math.min(previousTop, chatMessagesBody.scrollHeight);
    else if (nearBottom || !chatMessagesBody.dataset.rendered) chatMessagesBody.scrollTo({ top: chatMessagesBody.scrollHeight, behavior: chatMessagesBody.dataset.rendered ? "smooth" : "auto" });
    chatMessagesBody.dataset.rendered = "true";
    window.dispatchEvent(new CustomEvent("netchat:messages-rendered", { detail: { conversationId, snapshot } }));

    if (unreadDocs.length > 0) {
      unreadDocs.forEach((messageDoc) => updateDoc(messageDoc.ref, { status: "read", readAt: serverTimestamp() }).catch((error) => console.warn("Read receipt update denied:", error)));
      updateDoc(doc(window.netChatDB, "chats", conversationId), { lastMessageStatus: "read", [`unreadCount.${myUid}`]: 0 }).catch((error) => console.warn("Chat read state update denied:", error));
    }
  };

  messagesUnsubscribe = onSnapshot(messagesQuery, (snapshot) => { renderSnapshot(snapshot).catch((error) => { console.error("Message rendering failed:", error); toast("Some messages could not be displayed"); }); }, (error) => {
    console.error(`NetChat message listener failed for chats/${conversationId}/messages:`, error);
    toast(`Could not load messages (${error.code || "Firestore error"}). Check chat participant rules.`);
  });
}

let currentPresenceUnsubscribe = null;
let currentTypingUnsubscribe = null;

async function listenToUserPresence(userId) {
  if (currentPresenceUnsubscribe) {
    currentPresenceUnsubscribe();
    currentPresenceUnsubscribe = null;
  }

  const userRef = doc(window.netChatDB, "user", userId);
  const userSnapshot = await getDoc(userRef);
  if (!userSnapshot.exists()) return;

  const userData = userSnapshot.data();
  let lastSeenPrivacy = userData.privacy?.lastSeen || "Everyone";
  if (lastSeenPrivacy === "My Contacts") {
    const relationship = await getContactRelationship(window.netChatAuthUser.uid).catch(() => "none");
    const theyHaveMe = await getDoc(doc(window.netChatDB, "user", userId, "contacts", window.netChatAuthUser.uid)).catch(() => null);
    if (!theyHaveMe?.exists()) lastSeenPrivacy = "Nobody";
  }

  const statusElement = document.getElementById("chatUserStatus");
  if (!statusElement) return;

  if (lastSeenPrivacy === "Nobody") {
    statusElement.textContent = "";
    return;
  }

  const presenceRef = ref(window.netChatRealtimeDB, `presence/${userId}`);

  currentPresenceUnsubscribe = onValue(presenceRef, (snapshot) => {
    const presenceData = snapshot.val();

    if (!presenceData) {
      statusElement.textContent = "";
      return;
    }

    if (presenceData.online === true) {
      statusElement.textContent = "online";
      return;
    }

    if (presenceData.lastSeen) {
      const lastSeenDate = new Date(presenceData.lastSeen);
      statusElement.textContent = `last seen ${lastSeenDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
  });
}

function listenToTypingStatus(conversationId, otherUserId) {
  if (currentTypingUnsubscribe) {
    currentTypingUnsubscribe();
    currentTypingUnsubscribe = null;
  }

  const typingRef = ref(window.netChatRealtimeDB, `typing/${conversationId}/${otherUserId}`);

  currentTypingUnsubscribe = onValue(typingRef, (snapshot) => {
    const value = snapshot.val();
    const isTyping = value === true || (value?.active === true && Date.now() - Number(value.updatedAt || 0) < 6000);
    const statusElement = document.getElementById("chatUserStatus");
    if (!statusElement) return;

    if (isTyping) {
      statusElement.textContent = "typing...";
    } else {
      listenToUserPresence(otherUserId);
    }
  });
}

async function markMessagesAsRead(conversationId) {
  const currentUserId = window.netChatAuthUser.uid;
  const conversationRef = doc(window.netChatDB, "chats", conversationId);
  const conversationSnapshot = await getDoc(conversationRef);
  if (!conversationSnapshot.exists()) return;

  const conversationData = conversationSnapshot.data();
  const lastMessageId = conversationData.lastMessageId;

  const messagesRef = collection(window.netChatDB, "chats", conversationId, "messages");
  const messagesSnapshot = await getDocs(messagesRef);

  for (const messageDoc of messagesSnapshot.docs) {
    const messageData = messageDoc.data();
    const isIncoming = messageData.senderId !== currentUserId;

    if (isIncoming && messageData.status !== "read" && window.netChatUserData?.privacy?.readReceipts !== false) {
      await updateDoc(messageDoc.ref, { status: "read", readAt: serverTimestamp() });

      if (messageDoc.id === lastMessageId) {
        await updateDoc(conversationRef, {
          lastMessageStatus: "read",
          [`unreadCount.${currentUserId}`]: 0
        });
      }
    }
  }
}

async function syncPendingMessagesToDelivered() {
  const currentUserId = window.netChatAuthUser.uid;
  const chatsRef = collection(window.netChatDB, "chats");
  const chatsQuery = query(chatsRef, where("participants", "array-contains", currentUserId));
  const chatsSnapshot = await getDocs(chatsQuery);

  for (const chatDoc of chatsSnapshot.docs) {
    const messagesRef = collection(window.netChatDB, "chats", chatDoc.id, "messages");
    const messagesSnapshot = await getDocs(messagesRef);

    for (const messageDoc of messagesSnapshot.docs) {
      const messageData = messageDoc.data();
      const isIncoming = messageData.senderId !== currentUserId;

      if (isIncoming && messageData.status === "sent") {
        await updateDoc(messageDoc.ref, { status: "delivered", deliveredAt: serverTimestamp() });

        if (chatDoc.data().lastMessageId === messageDoc.id) {
          await updateDoc(chatDoc.ref, { lastMessageStatus: "delivered" });
        }
      }
    }
  }
}

function listenForIncomingMessages() {
  const currentUserId = window.netChatAuthUser.uid;
  const chatsRef = collection(window.netChatDB, "chats");
  const chatsQuery = query(chatsRef, where("participants", "array-contains", currentUserId));
  const messageListeners = new Map();

  onSnapshot(chatsQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const conversationId = change.doc.id;

      if (change.doc.data()?.groupDeleted === true || change.type === "removed") {
        const unsubscribe = messageListeners.get(conversationId);
        if (unsubscribe) {
          unsubscribe();
          messageListeners.delete(conversationId);
        }
        return;
      }

      if (messageListeners.has(conversationId)) return;

      const messagesRef = collection(window.netChatDB, "chats", conversationId, "messages");
      const messagesQuery = query(messagesRef, where("status", "==", "sent"));

      const unsubscribe = onSnapshot(messagesQuery, async (messagesSnapshot) => {
        for (const messageDoc of messagesSnapshot.docs) {
          const messageData = messageDoc.data();
          if (messageData.senderId === currentUserId) continue;

          const isViewingThisChat = activeConversationId === conversationId;

          try {
            if (isViewingThisChat) {
              if (window.netChatUserData?.privacy?.readReceipts !== false) await updateDoc(messageDoc.ref, { status: "read", readAt: serverTimestamp() });
              await updateDoc(doc(window.netChatDB, "chats", conversationId), {
                [`unreadCount.${currentUserId}`]: 0,
                ...(window.netChatUserData?.privacy?.readReceipts !== false ? { lastMessageStatus: "read" } : {})
              });
            } else {
              await updateDoc(messageDoc.ref, { status: "delivered", deliveredAt: serverTimestamp() });
              await updateDoc(doc(window.netChatDB, "chats", conversationId), {
                lastMessageStatus: "delivered"
              });
            }
          } catch (writeError) {
            console.warn(`Could not update delivery/read state for ${conversationId}/${messageDoc.id}:`, writeError);
          }
        }
      }, (error) => {
        console.error(`Incoming-message listener failed for chats/${conversationId}/messages:`, error);
      });

      messageListeners.set(conversationId, unsubscribe);
    });
  }, (error) => {
    console.error("Incoming chat listener failed for chats:", error);
    toast(`Chat sync failed (${error.code || "Firestore error"}). Check the Firestore rules.`);
  });
}

let netChatSystemItems = [];

function renderNetChatSystemCard() {
  if (!chatList) return;

  const existingCard = chatList.querySelector(".netchat-system-card");
  if (existingCard) existingCard.remove();

  const activeSystemItems = netChatSystemItems.filter(item => item.resolved !== true);
  if (!activeSystemItems.length) return;

  const latestItem = [...activeSystemItems].sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() || 0;
    const bTime = b.createdAt?.toMillis?.() || 0;
    return bTime - aTime;
  })[0];

  const unreadCount = activeSystemItems.filter(item => item.read !== true).length;

  const card = document.createElement("div");
  card.className = "chat-card netchat-system-card";

  card.innerHTML = `
    <div class="netchat-system-card-avatar">
      <span class="material-symbols-outlined">verified</span>
    </div>
    <div class="chat-info">
      <h3>NetChat</h3>
      <p>${escapeHTML(
        latestItem.type === "contact_request"
          ? "Someone sent you a contact request"
          : "You have a new NetChat message"
      )}</p>
    </div>
    <div class="chat-right">
      ${unreadCount > 0 ? `<span class="badge">${unreadCount}</span>` : ""}
    </div>
  `;

  card.addEventListener("click", () => openNetChatSystem());
  chatList.prepend(card);
}

async function renderNetChatSystemItems() {
  const body = document.getElementById("netChatSystemBody");
  if (!body) return;

  body.innerHTML = "";

  const visibleItems = netChatSystemItems.filter(item => item.resolved !== true);

  if (!visibleItems.length) {
    body.innerHTML = `
      <div class="netchat-system-empty">
        <span class="material-symbols-outlined">verified</span>
        <p>No new messages from NetChat.</p>
      </div>
    `;
    return;
  }

  for (const item of visibleItems) {
    if (item.type === "contact_request") {
      const senderRef = doc(window.netChatDB, "user", item.fromUid);
      const senderSnap = await getDoc(senderRef);
      if (!senderSnap.exists()) continue;

      const sender = senderSnap.data();
      const requestCard = document.createElement("div");
      requestCard.className = "netchat-system-item";

      requestCard.innerHTML = `
        <div class="netchat-request-card">
          <div class="netchat-request-header">
            <div class="netchat-request-avatar">
              <img src="${sender.profileImage || 'default-avatar.png'}" alt="User Avatar" />
              <div class="netchat-avatar-badge">
                <span class="material-symbols-outlined">add</span>
              </div>
            </div>
            <div class="netchat-request-content">
              <div class="netchat-request-tag">
                <span class="material-symbols-outlined">person_add</span>
                Contact Request
              </div>
              <h4>${escapeHTML(sender.userFullname || "NetChat User")}</h4>
              <p>wants to add you to their contacts.</p>
            </div>
          </div>
          <div class="netchat-request-actions">
            <button type="button" class="netchat-accept-btn" data-request-id="${item.requestId}">
              <span class="material-symbols-outlined">check</span>
              Accept
            </button>
            <button type="button" class="netchat-decline-btn" data-request-id="${item.requestId}">
              <span class="material-symbols-outlined">close</span>
              Decline
            </button>
          </div>
        </div>
      `;

      body.appendChild(requestCard);

      requestCard.querySelector(".netchat-accept-btn")?.addEventListener("click", async () => {
        const requestId = requestCard.querySelector(".netchat-accept-btn").dataset.requestId;
        const success = await acceptContactRequest(requestId);
        if (success) await renderNetChatSystemItems();
      });

      requestCard.querySelector(".netchat-decline-btn")?.addEventListener("click", async () => {
        const requestId = requestCard.querySelector(".netchat-decline-btn").dataset.requestId;
        const success = await declineContactRequest(requestId);
        if (success) await renderNetChatSystemItems();
      });
    }
  }
}

// Global Chat Initialization
window.netChatUserReady.then(() => {
  refreshStatusFeed();
  console.log("AUTH USER:", window.netChatAuthUser);

  const currentUserId = window.netChatAuthUser.uid;

  const systemInboxRef = collection(window.netChatDB, "systemInbox", currentUserId, "items");

  onSnapshot(systemInboxRef, (snapshot) => {
    netChatSystemItems = snapshot.docs.map((systemDoc) => ({
      id: systemDoc.id,
      ...systemDoc.data()
    }));
    console.log("NetChat system inbox:", netChatSystemItems);
    renderNetChatSystemCard();
  }, (error) => {
    console.error("NetChat system inbox listener failed:", error);
  });

  const presenceRef = ref(window.netChatRealtimeDB, `presence/${currentUserId}`);
  const connectedRef = ref(window.netChatRealtimeDB, ".info/connected");

  onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() !== true) return;

    await onDisconnect(presenceRef).set({
      online: false,
      lastSeen: rtdbServerTimestamp()
    });

    await set(presenceRef, {
      online: true,
      lastSeen: rtdbServerTimestamp()
    });
  });

  syncPendingMessagesToDelivered();
  listenForIncomingMessages();
  listenForIncomingCalls();

  const chatsRef = collection(window.netChatDB, "chats");
  const chatsQuery = query(chatsRef, where("participants", "array-contains", currentUserId));

  onSnapshot(chatsQuery, async (snapshot) => {
    let archiveStates = new Map();
    try {
      const archivedSnapshot = await getDocs(collection(window.netChatDB, "user", currentUserId, "archivedChats"));
      archivedSnapshot.docs.forEach((archiveDoc) => archiveStates.set(archiveDoc.id, archiveDoc.data()));
    } catch (error) { console.warn("Archive state could not be loaded:", error); }
    const chatDataPromises = snapshot.docs.map(async (chatDoc) => {
      const chatData = chatDoc.data();
      if (chatData.groupDeleted === true) return null;
      const archive = archiveStates.get(chatDoc.id);
      if (archive && !archive.deletedAt) return null;
      if (archive?.deletedAt && (!chatData.lastMessageAt || (chatData.lastMessageAt.toMillis?.() || 0) <= (archive.deletedAt.toMillis?.() || 0))) return null;
      const participants = Array.isArray(chatData.participants) ? chatData.participants : [];
      const otherUserId = participants.find((uid) => uid !== currentUserId);
      if (chatData.isGroup || chatData.type === "group") {
        return {
          chatId: chatDoc.id,
          chatData,
          otherUserData: {
            ...chatData,
            uid: otherUserId || chatDoc.id,
            userFullname: chatData.groupName || chatData.name || "Group chat",
            profileImage: chatData.groupImage || "",
            isGroup: true,
            participants,
            createdBy: chatData.createdBy,
            groupName: chatData.groupName || chatData.name || "Group chat"
          }
        };
      }
      if (!otherUserId) return null;

      const otherUserRef = doc(window.netChatDB, "user", otherUserId);
      const otherUserSnapshot = await getDoc(otherUserRef);
      if (!otherUserSnapshot.exists()) return null;

      return {
        chatId: chatDoc.id,
        chatData,
        otherUserData: { ...otherUserSnapshot.data(), ...(await getSenderProfile(otherUserId)), uid: otherUserId, isGroup: false }
      };
    });

    const resolvedChats = (await Promise.all(chatDataPromises)).filter(Boolean);
    resolvedChats.sort((a, b) => Number((b.chatData.pinnedBy || []).includes(currentUserId)) - Number((a.chatData.pinnedBy || []).includes(currentUserId)) || ((b.chatData.lastMessageAt?.toMillis?.() || 0) - (a.chatData.lastMessageAt?.toMillis?.() || 0)));

    if (activeConversationId && !resolvedChats.some((c) => c.chatId === activeConversationId)) {
      if (messagesUnsubscribe) { messagesUnsubscribe(); messagesUnsubscribe = null; }
      activeConversationId = null;
      activeTargetUser = null;
      const activeChatScreen = document.getElementById("chatScreen");
      if (activeChatScreen) activeChatScreen.style.display = "none";
    }

    chatList.innerHTML = "";

    resolvedChats.forEach(({ chatId, chatData, otherUserData }) => {
      const chatCard = document.createElement("div");
      chatCard.dataset.conversationId = chatId;
      chatCard.className = `chat-card${(chatData.pinnedBy || []).includes(currentUserId) ? " is-pinned" : ""}${(chatData.mutedBy || []).includes(currentUserId) ? " is-muted" : ""}`;
      chatCard.tabIndex = 0;
      chatCard.setAttribute("role", "button");
      chatCard.setAttribute("aria-label", `Open chat with ${otherUserData.userFullname || "NetChat User"}`);
      chatCard.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openConversation(otherUserData, chatId); } });
      chatCard.dataset.isGroup = String(!!otherUserData.isGroup);
      const isFavoriteInitially = chatData.favorites?.[currentUserId] === true || chatData.favoriteBy?.includes?.(currentUserId) || chatData.favouriteBy?.includes?.(currentUserId);
      chatCard.dataset.isFavorite = String(!!isFavoriteInitially);

      const unread = chatData.unreadCount?.[currentUserId] || 0;
      const clearedAt = chatData.clearedFor?.[currentUserId];
      const lastAt = chatData.lastMessageAt;
      const clearedLastMessage = !!(clearedAt && lastAt &&
        typeof clearedAt.toMillis === "function" &&
        typeof lastAt.toMillis === "function" &&
        clearedAt.toMillis() >= lastAt.toMillis());
      const lastMessageHiddenForMe = !!(chatData.lastMessageId &&
        chatData.hiddenLastMessageFor?.[currentUserId] === chatData.lastMessageId);
      const previewText = clearedLastMessage
        ? "No messages yet"
        : (lastMessageHiddenForMe ? "Message deleted for you" : (chatData.lastMessage || ""));

      chatCard.innerHTML = `
        <img src="${otherUserData.profileImage || "default-avatar.png"}" alt="User Avatar">
        <div class="chat-info">
          <h3>${otherUserData.userFullname || "NetChat User"}</h3>
          <p>
            ${
              !clearedLastMessage && !lastMessageHiddenForMe && chatData.lastMessageSenderId === currentUserId
                ? `<span class="material-symbols-outlined msg-status ${chatData.lastMessageStatus}">
                     ${chatData.lastMessageStatus === "delivered" || chatData.lastMessageStatus === "read" ? "done_all" : "done"}
                   </span>`
                : ""
            }
            ${escapeHTML(previewText)}
          </p>
        </div>
        <div class="chat-right">
          <span>${formatChatTime(chatData.lastMessageAt)}</span>
          ${unread > 0 ? `<span class="badge">${unread}</span>` : ""}
        </div>
      `;

      const favoriteButton = document.createElement("button");
      favoriteButton.type = "button";
      favoriteButton.className = "chat-favorite-toggle";
      favoriteButton.title = isFavoriteInitially ? "Remove from favourites" : "Add to favourites";
      favoriteButton.innerHTML = `<span class="material-symbols-outlined">${isFavoriteInitially ? "star" : "star_outline"}</span>`;
      favoriteButton.addEventListener("click", async (event) => {
        event.preventDefault(); event.stopPropagation();
        const next = chatCard.dataset.isFavorite !== "true";
        try {
          await updateDoc(doc(window.netChatDB, "chats", chatId), { [`favorites.${currentUserId}`]: next });
          chatCard.dataset.isFavorite = String(next);
          favoriteButton.title = next ? "Remove from favourites" : "Add to favourites";
          favoriteButton.innerHTML = `<span class="material-symbols-outlined">${next ? "star" : "star_outline"}</span>`;
          applyChatListFilters();
        } catch (error) { console.error("Could not update favourite", error); toast("Could not save favourite. Check Firestore rules."); }
      });
      chatCard.appendChild(favoriteButton);

      let longPressTimer = null;
      let longPressTriggered = false;
      const showChatQuickActions = () => {
        document.querySelector(".nx-chat-quick-actions")?.remove();
        const pinned = (chatData.pinnedBy || []).includes(currentUserId);
        const sheet = document.createElement("div");
        sheet.className = "nx-chat-quick-actions";
        sheet.innerHTML = `<button data-chat-action="pin"><span class="material-symbols-outlined">push_pin</span>${pinned ? "Unpin chat" : "Pin chat"}</button><button data-chat-action="mute"><span class="material-symbols-outlined">notifications_off</span>Mute notifications</button><button data-chat-action="close"><span class="material-symbols-outlined">close</span>Cancel</button>`;
        document.body.appendChild(sheet);
        const closeSheet = () => sheet.remove();
        sheet.addEventListener("click", async (event) => {
          const action = event.target.closest("[data-chat-action]")?.dataset.chatAction;
          if (!action) return;
          if (action === "close") return closeSheet();
          try {
            if (action === "pin") {
              const next = pinned ? (chatData.pinnedBy || []).filter(id => id !== currentUserId) : [...new Set([...(chatData.pinnedBy || []), currentUserId])];
              await updateDoc(doc(window.netChatDB, "chats", chatId), { pinnedBy: next });
              toast(next.includes(currentUserId) ? "Chat pinned" : "Chat unpinned");
            } else if (action === "mute") {
              const muted = (chatData.mutedBy || []).includes(currentUserId);
              const next = muted ? (chatData.mutedBy || []).filter(id => id !== currentUserId) : [...new Set([...(chatData.mutedBy || []), currentUserId])];
              await updateDoc(doc(window.netChatDB, "chats", chatId), { mutedBy: next });
              toast(next.includes(currentUserId) ? "Chat muted" : "Chat unmuted");
            }
          } catch (error) { console.error("Chat quick action failed", error); toast("Could not update this chat"); }
          closeSheet();
        });
      };
      chatCard.addEventListener("touchstart", () => {
        longPressTriggered = false;
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => { longPressTriggered = true; showChatQuickActions(); }, 600);
      }, { passive: true });
      ["touchend", "touchmove", "touchcancel"].forEach(type => chatCard.addEventListener(type, () => clearTimeout(longPressTimer), { passive: true }));
      chatCard.addEventListener("contextmenu", (event) => { event.preventDefault(); showChatQuickActions(); });
      chatCard.addEventListener("click", (event) => { if (longPressTriggered) { event.preventDefault(); longPressTriggered = false; return; } openConversation(otherUserData, chatId); });

      chatList.appendChild(chatCard);
    });

    renderNetChatSystemCard();
    applyChatListFilters();
  }, (error) => {
    console.error("NetChat chat-list listener failed for chats where participants contains current user:", error);
    toast(`Chat list failed (${error.code || "Firestore error"}). Check the chats read rule.`);
  });
});

// Search and Modals
const fabWrapper = document.getElementById('fabWrapper');
const fabBtn = document.getElementById('fabBtn');
const closeSearchBtn = document.getElementById('closeSearchBtn');
const fabBackdrop = document.getElementById('fabBackdrop');
const userSearchInput = document.getElementById('userSearchingInput');
const closeProfileModal = document.getElementById("closeProfileModal");

if (closeProfileModal) {
  closeProfileModal.addEventListener("click", () => {
    document.getElementById("userProfileModal").classList.remove("active");
    document.getElementById("profileBackdrop").classList.remove("active");
  });
}

if (fabBtn) {
  fabBtn.addEventListener('click', () => {
    fabWrapper.classList.add('active');
    setTimeout(() => userSearchInput.focus(), 200);
  });
}

const closeSearch = () => {
  if (fabWrapper) fabWrapper.classList.remove('active');
  if (userSearchInput) userSearchInput.value = '';
};

if (closeSearchBtn) closeSearchBtn.addEventListener('click', closeSearch);
if (fabBackdrop) fabBackdrop.addEventListener('click', closeSearch);

if (userSearchInput) {
  userSearchInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      const searchValue = userSearchInput.value.trim();
      if (!searchValue) return;

      const usersRef = window.netChatCollection(window.netChatDB, "user");
      const searchQuery = window.netChatQuery(usersRef, window.netChatWhere("netChatID", "==", searchValue));
      const results = await window.netChatGetDocs(searchQuery);

      results.forEach((doc) => {
        const userData = doc.data();

        activeTargetUser = { ...userData, uid: doc.id };

        const modalAvatar = document.getElementById("modalUserAvatar");
        if (modalAvatar) modalAvatar.src = userData.profileImage || "default-avatar.png";

        document.getElementById("modalNetchatId").textContent = userData.netChatID || "";
        document.getElementById("modalUserName").textContent = userData.userFullname || "NetChat User";
        document.getElementById("modalUserBio").textContent = userData.about || "No bio available yet.";

        document.getElementById("userProfileModal").classList.add("active");
        document.getElementById("profileBackdrop").classList.add("active");

        updateAddContactButton();
      });
    }
  });
}

const btnAddContact = document.getElementById("btnAddContact");

async function updateAddContactButton() {
  if (!btnAddContact) return;

  const targetUser = activeTargetUser;
  if (!targetUser?.uid) return;

  const relationship = await getContactRelationship(targetUser.uid);

  if (relationship === "contact") {
    btnAddContact.querySelector(".btn-label").textContent = "Contact";
    btnAddContact.disabled = true;
    return;
  }

  if (relationship === "request_sent") {
    btnAddContact.querySelector(".btn-label").textContent = "Request Sent";
    btnAddContact.disabled = true;
    return;
  }

  if (relationship === "request_received") {
    btnAddContact.querySelector(".btn-label").textContent = "Respond to Request";
    btnAddContact.disabled = false;
    return;
  }

  btnAddContact.querySelector(".btn-label").textContent = "Add Contact";
  btnAddContact.disabled = false;
}

btnAddContact?.addEventListener("click", async () => {
  if (!activeTargetUser?.uid) return;

  const relationship = await getContactRelationship(activeTargetUser.uid);

  if (relationship === "none") {
    btnAddContact.disabled = true;
    btnAddContact.classList.add("is-loading");

    btnAddContact.innerHTML = `
      <span class="contact-spinner"></span>
      <span class="btn-label">Sending Request...</span>
    `;

    try {
      await sendContactRequest();
      btnAddContact.classList.remove("is-loading");
      btnAddContact.innerHTML = `
        <span class="material-symbols-outlined">person_add</span>
        <span class="btn-label">Request Sent</span>
      `;
    } catch (error) {
      console.error("Failed to send contact request:", error);
      btnAddContact.classList.remove("is-loading");
      btnAddContact.disabled = false;
      btnAddContact.innerHTML = `
        <span class="material-symbols-outlined">person_add</span>
        <span class="btn-label">Add Contact</span>
      `;
    }

    return;
  }

  if (relationship === "request_received") {
    openNetChatSystem();
  }
});

const btnMessage = document.getElementById("btnMessage");

if (btnMessage) {
  btnMessage.addEventListener("click", async () => {
    document.getElementById("userProfileModal").classList.remove("active");
    document.getElementById("profileBackdrop").classList.remove("active");
    closeSearch();
    if (!activeTargetUser) return;
    const targetUid = activeTargetUser.theNewCreatedUser || activeTargetUser.uid;
    await openConversation(activeTargetUser, createConversationId(window.netChatAuthUser.uid, targetUid), { focus: true });
  });
}

const closeChatBtn = document.getElementById("closeChatBtn");

if (closeChatBtn) {
  closeChatBtn.addEventListener("click", () => {
    setTypingStatus(false);
    clearTimeout(typingTimeout);

    cleanupConversationListeners();
    activeConversationId = null;
    activeTargetUser = null;
    activeChatData = null;
    window.dispatchEvent(new CustomEvent("netchat:chat-closed"));

    const chatScreen = document.getElementById("chatScreen");
    if (chatScreen) chatScreen.style.display = "none";
  });
}

// Typing Indicator Broadcaster & Send Message Handler
const messageInput = document.getElementById("messageInput");
const sendMsgBtn = document.getElementById("sendMsgBtn");
let typingTimeout = null;

function setTypingStatus(isTyping) {
  if (!activeConversationId || !window.netChatAuthUser) return;

  const currentUserId = window.netChatAuthUser.uid;
  const typingRef = ref(window.netChatRealtimeDB, `typing/${activeConversationId}/${currentUserId}`);
  const allowed = window.netChatUserData?.privacy?.typing !== false;
  set(typingRef, isTyping && allowed ? { active: true, updatedAt: Date.now() } : null).catch((error) => console.warn("Typing state could not be saved:", error));
}








document.addEventListener('DOMContentLoaded', () => {
  if (messageInput) {
    messageInput.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });
  }
});















if (messageInput) {
  messageInput.addEventListener("input", () => {
    if (document.body.classList.contains("vera-mode")) return;
    const text = messageInput.value.trim();

    if (text.length > 0) {
      setTypingStatus(true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => setTypingStatus(false), 2000);
    } else {
      clearTimeout(typingTimeout);
      setTypingStatus(false);
    }
  });
}


/* Enter-to-send (respects the Chat Settings toggle, on by default) */
messageInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    let enterSend = true;
    try {
      const saved = localStorage.getItem("nx:enterSend");
      if (saved !== null) enterSend = JSON.parse(saved);
    } catch {}
    if (enterSend) {
      event.preventDefault();
      sendMsgBtn?.click();
    }
  }
});

function uploadChatMediaToCloudinary(file, onProgress = null) {
  return new Promise((resolve, reject) => {
    if (!file.name) file = new File([file], `status-${Date.now()}.${file.type.startsWith("video/") ? "mp4" : "jpg"}`, { type: file.type || "image/jpeg" });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "My_NetChat_chat");
    const isAudio = file.type.startsWith("audio/") || file.name.toLowerCase().endsWith(".webm");
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    const endpoint = isAudio || isVideo ? "video" : isImage ? "image" : "raw";
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/haludoui/${endpoint}/upload`);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && typeof onProgress === "function") onProgress(Math.round(event.loaded / event.total * 100));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during Cloudinary upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.addEventListener("load", () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch {}
      if (xhr.status < 200 || xhr.status >= 300 || !data.secure_url) {
        reject(new Error(data.error?.message || `Cloudinary upload failed (${xhr.status})`));
        return;
      }
      resolve({
        url: data.secure_url,
        publicId: data.public_id,
        resourceType: isAudio ? "audio" : isVideo ? "video" : isImage ? "image" : "document",
        cloudResourceType: data.resource_type,
        format: data.format || file.name.split(".").pop() || "",
        width: data.width || null,
        height: data.height || null,
        duration: data.duration || null,
        bytes: data.bytes || file.size,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        uploadState: "ready"
      });
    });
    xhr.send(formData);
  });
}

function validateChatFile(file) {
  const max = file.type.startsWith("image/") ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
  if (!file.size || file.size > max) throw new Error(`${file.name}: ${file.type.startsWith("image/") ? "Images" : "Files"} must be smaller than ${max / 1024 / 1024} MB`);
  const supported = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|webm|wav|x-m4a)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.|zip|x-zip-compressed)|text\/plain)/.test(file.type || "application/octet-stream");
  const extensionOk = /\.(jpe?g|png|webp|gif|mp4|webm|mov|mp3|m4a|ogg|wav|pdf|docx?|zip|txt)$/i.test(file.name);
  if (!supported && !extensionOk) throw new Error(`${file.name}: this file type is not supported`);
}

const failedDrafts = new Map();
function renderOptimisticMessage(clientId, text, files, extra = {}) {
  const body = document.getElementById("chatMessagesBody");
  if (!body) return null;
  body.querySelector(".chat-empty-state")?.remove();
  const row = document.createElement("div");
  row.className = "msg-row outgoing optimistic-message";
  row.dataset.clientMessageId = clientId;
  const previews = files.map((file) => {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("image/")) return `<img class="chat-message-image" src="${url}" alt="Uploading image">`;
    if (file.type.startsWith("video/")) return `<video class="chat-message-video" src="${url}" muted playsinline></video>`;
    if (file.type.startsWith("audio/") || file.name.endsWith(".webm")) return `<span class="material-symbols-outlined">graphic_eq</span><span>${escapeHTML(file.name)}</span>`;
    return `<span class="material-symbols-outlined">description</span><span>${escapeHTML(file.name)}</span>`;
  }).join("");
  row.innerHTML = `<div class="msg-bubble">${previews}${text ? `<p class="msg-text">${escapeHTML(text)}</p>` : ""}${extra.poll ? `<p class="msg-text">${escapeHTML(extra.poll.question)}</p>` : ""}<div class="msg-meta"><span class="pending-label">Sending…</span><span class="material-symbols-outlined msg-status">schedule</span></div><div class="send-failure" hidden><p></p><button type="button">Retry</button></div><div class="send-progress" hidden><i></i><small></small></div></div>`;
  body.appendChild(row);
  body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
  return row;
}

async function sendMessagePayload(payload = {}) {
  const messageText = String(payload.text ?? messageInput.value).trim();
  const filesToUpload = [...(payload.files || selectedChatMedia)];
  const extra = payload.extra || {};
  const user = window.netChatAuthUser;
  if (!user || !activeTargetUser || !activeConversationId) { toast("Open a conversation before sending"); return false; }
  if (!messageText && !filesToUpload.length && !extra.poll) return false;
  if (activeTargetUser.isGroup) {
    const chat = activeChatData || activeTargetUser;
    if (!(chat.participants || []).includes(user.uid)) { toast("You are no longer a member of this group"); return false; }
    if (chat.groupDeleted) { toast("This group was deleted"); return false; }
    if (chat.onlyAdminsCanMessage === true && chat.createdBy !== user.uid && !(chat.admins || []).includes(user.uid)) { toast("Only admins can send messages in this group"); return false; }
  }
  try { filesToUpload.forEach(validateChatFile); }
  catch (error) { toast(error.message || "This file cannot be sent"); return false; }
  const clientId = crypto.randomUUID();
  const replyData = replyingToMessage ? { messageId: replyingToMessage.id, text: String(replyingToMessage.text || "").slice(0, 200), senderId: replyingToMessage.senderId, senderName: replyingToMessage.senderName } : null;
  const optimistic = renderOptimisticMessage(clientId, messageText, filesToUpload, extra);
  const progress = optimistic?.querySelector(".send-progress");
  if (progress && filesToUpload.length) progress.hidden = false;
  sendMsgBtn.disabled = true;
  sendMsgBtn.setAttribute("aria-busy", "true");
  replyingToMessage = null;
  const replyPreview = document.getElementById("replyPreview");
  if (replyPreview) replyPreview.style.display = "none";
  messageInput.value = "";
  messageInput.dispatchEvent(new Event("input", { bubbles: true }));
  messageInput.style.height = "auto";
  selectedChatMedia = [];
  if (chatMediaPreview) chatMediaPreview.hidden = true;
  if (chatMediaPreviewList) chatMediaPreviewList.innerHTML = "";
  setTypingStatus(false);
  clearTimeout(typingTimeout);

  try {
    const targetUid = activeTargetUser.theNewCreatedUser || activeTargetUser.uid;
    const isGroup = activeTargetUser.isGroup === true || activeTargetUser.type === "group";
    const conversationId = isGroup ? activeConversationId : createConversationId(user.uid, targetUid);
    if (conversationId !== activeConversationId) throw new Error("The active conversation changed. Please retry.");
    const conversationRef = doc(window.netChatDB, "chats", conversationId);
    let conversationSnapshot = await getDoc(conversationRef);
    const uploadedMedia = [];
    for (let index = 0; index < filesToUpload.length; index++) {
      const uploaded = await uploadChatMediaToCloudinary(filesToUpload[index], (percent) => {
        if (progress) { progress.querySelector("i").style.width = `${percent}%`; progress.querySelector("small").textContent = `Uploading ${index + 1}/${filesToUpload.length} · ${percent}%`; }
      });
      uploadedMedia.push(uploaded);
    }
    if (!conversationSnapshot.exists()) {
      if (isGroup) throw new Error("This group no longer exists");
      await setDoc(conversationRef, {
        unreadCount: { [targetUid]: 0, [user.uid]: 0 },
        participants: [user.uid, targetUid],
        lastMessage: "",
        lastMessageSenderId: user.uid,
        lastMessageAt: serverTimestamp(),
        lastMessageStatus: "sent",
        createdAt: serverTimestamp()
      });
      conversationSnapshot = await getDoc(conversationRef);
    }
    const messageRef = await addDoc(collection(conversationRef, "messages"), {
      clientId,
      senderId: user.uid,
      text: messageText,
      media: uploadedMedia,
      timestamp: serverTimestamp(),
      status: "sent",
      replyTo: replyData,
      ...extra,
      ...(conversationSnapshot.exists() && Number(conversationSnapshot.data().disappearingSeconds) > 0 ? { expiresAt: new Date(Date.now() + Number(conversationSnapshot.data().disappearingSeconds) * 1000) } : {})
    });
    let preview = messageText || (extra.poll ? `📊 ${extra.poll.question}` : "");
    if (!preview && uploadedMedia.length) {
      const kind = uploadedMedia[0].resourceType;
      preview = kind === "video" ? "🎥 Video" : kind === "audio" ? "🎙 Voice note" : kind === "document" ? `📄 ${uploadedMedia[0].fileName}` : uploadedMedia.length > 1 ? `📷 ${uploadedMedia.length} photos` : "📷 Photo";
    }
    const chatUpdate = { lastMessage: preview, lastMessageSenderId: user.uid, lastMessageAt: serverTimestamp(), lastMessageStatus: "sent", lastMessageId: messageRef.id };
    if (isGroup) (activeTargetUser.participants || activeChatData?.participants || []).filter((uid) => uid !== user.uid).forEach((uid) => { chatUpdate[`unreadCount.${uid}`] = increment(1); });
    else chatUpdate[`unreadCount.${targetUid}`] = increment(1);
    try { await updateDoc(conversationRef, chatUpdate); }
    catch (previewError) { console.warn("Message was sent, but the chat-list preview update failed:", previewError); toast("Message sent. The chat-list preview will resync later."); }
    window.netChatTrackAchievementEvent?.("message");
    window.netChatPlaySound?.("sent");
    failedDrafts.delete(clientId);
    return true;
  } catch (error) {
    console.error("Message send failed:", error);
    failedDrafts.set(clientId, { text: messageText, files: filesToUpload, extra });
    if (optimistic) {
      optimistic.classList.add("send-failed");
      const failure = optimistic.querySelector(".send-failure");
      failure.hidden = false;
      failure.querySelector("p").textContent = error.message || "Message not sent";
      optimistic.querySelector(".pending-label").textContent = "Not sent";
      if (progress) progress.hidden = true;
    }
    toast(error.message || "Message not sent. Use Retry on the message.");
    return false;
  } finally {
    sendMsgBtn.disabled = false;
    sendMsgBtn.removeAttribute("aria-busy");
  }
}
window.netChatSendMessage = sendMessagePayload;

document.getElementById("chatMessagesBody")?.addEventListener("click", async (event) => {
  const retry = event.target.closest(".send-failure button");
  if (!retry) return;
  const row = retry.closest("[data-client-message-id]");
  const draft = failedDrafts.get(row?.dataset.clientMessageId);
  if (!draft) return;
  row.remove();
  failedDrafts.delete(row.dataset.clientMessageId);
  await sendMessagePayload(draft);
});

if (sendMsgBtn) sendMsgBtn.addEventListener("click", () => sendMessagePayload());

// STUN Server Configuration for NAT Traversal
const rtcServers = {
  iceServers: [
    { urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] }
  ]
};

// Global Connection & Stream References
let peerConnection = null;
let localStream = null;
let remoteStream = null;

// Global Listener Unsubscribe Hooks (Prevents Memory Leaks)
let currentCallUnsubscribe = null;
let candidatesUnsubscribe = null;
let incomingCallUnsubscribe = null;
let currentCallDocId = null;

// Buffer for ICE Candidates arriving before Remote Description is set
let pendingIceCandidates = [];

// ==========================================
// 1. START OUTGOING VIDEO CALL
// ==========================================
async function startVideoCall(withVideo = true) {
  if (!activeConversationId || !activeTargetUser) return;
  if (activeTargetUser.isGroup) { toast("Calls from group chats are not supported yet."); return; }

  const currentUserId = window.netChatAuthUser.uid;
  const targetUserId = activeTargetUser.theNewCreatedUser || activeTargetUser.uid;
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: withVideo, audio: true });
  } catch (err) {
    alert(withVideo ? "Camera and microphone permissions are required for a video call." : "Microphone permission is required for a voice call.");
    return;
  }

  pendingIceCandidates = [];

  const videoCallScreen = document.getElementById("videoCallScreen");
  if (videoCallScreen) videoCallScreen.style.display = "flex";

  const callUserName = document.getElementById("callUserName");
  if (callUserName) callUserName.textContent = activeTargetUser.userFullname || "NetChat User";

  const callUserAvatar = document.getElementById("callUserAvatar");
  if (callUserAvatar) callUserAvatar.src = activeTargetUser.profileImage || "default-avatar.png";

  const callStatusText = document.getElementById("callStatusText");
  if (callStatusText) callStatusText.textContent = "Calling...";

  remoteStream = new MediaStream();
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");

  if (localVideo) { localVideo.srcObject = localStream; localVideo.hidden = !withVideo; }
  if (remoteVideo) { remoteVideo.srcObject = remoteStream; remoteVideo.hidden = !withVideo; }

  peerConnection = new RTCPeerConnection(rtcServers);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
    if (remoteVideo) remoteVideo.srcObject = remoteStream;
  };

  const callDocRef = doc(collection(window.netChatDB, "calls"));
  currentCallDocId = callDocRef.id;

  const offerCandidates = collection(callDocRef, "offerCandidates");
  const answerCandidates = collection(callDocRef, "answerCandidates");

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) addDoc(offerCandidates, event.candidate.toJSON());
  };

  const offerDescription = await peerConnection.createOffer();

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
    callerId: currentUserId,
    receiverId: targetUserId,
    conversationId: activeConversationId,
    status: "calling",
    callType: withVideo ? "video" : "voice",
    createdAt: serverTimestamp()
  };

  // Create the parent call document before ICE candidates can be written.
  await setDoc(callDocRef, { offer, status: "calling" });
  await peerConnection.setLocalDescription(offerDescription);
  window.netChatTrackAchievementEvent?.("call");

  candidatesUnsubscribe = onSnapshot(answerCandidates, (candSnap) => {
    candSnap.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        const candidateData = change.doc.data();
        if (peerConnection && peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidateData)).catch(() => {});
        } else {
          pendingIceCandidates.push(candidateData);
        }
      }
    });
  }, (error) => {
    console.error("WebRTC answer-candidate listener failed:", error);
  });

  currentCallUnsubscribe = onSnapshot(callDocRef, async (snapshot) => {
    const data = snapshot.data();
    if (!data) return;

    if (!peerConnection.remoteDescription && data.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(answerDescription);

      if (callStatusText) callStatusText.textContent = "Connected";

      while (pendingIceCandidates.length > 0) {
        const candidate = pendingIceCandidates.shift();
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    }

    if (data.status === "ended" || data.status === "rejected") {
      endCall(false);
    }
  }, (error) => {
    console.error("Active call listener failed:", error);
    toast(`Call connection failed (${error.code || "Firestore error"}). Check call participant rules.`);
  });
}

// ==========================================
// 2. LISTEN FOR INCOMING CALLS
// ==========================================
function listenForIncomingCalls() {
  if (!window.netChatAuthUser) return;

  const currentUserId = window.netChatAuthUser.uid;
  const callsRef = collection(window.netChatDB, "calls");

  const incomingQuery = query(
    callsRef,
    where("offer.receiverId", "==", currentUserId),
    where("status", "==", "calling")
  );

  incomingCallUnsubscribe = onSnapshot(incomingQuery, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        const callDocId = change.doc.id;
        const callData = change.doc.data();
        const callerId = callData.offer.callerId;

        const callerDoc = await getDoc(doc(window.netChatDB, "user", callerId));
        if (!callerDoc.exists()) return;

        const callerData = callerDoc.data();

        const avatarEl = document.getElementById("callerAvatar");
        const nameEl = document.getElementById("callerName");
        const modalEl = document.getElementById("incomingCallModal");

        if (avatarEl) avatarEl.src = callerData.profileImage || "default-avatar.png";
        if (nameEl) nameEl.textContent = callerData.userFullname || "NetChat User";
        if (modalEl) modalEl.style.display = "flex";

        const acceptBtn = document.getElementById("acceptCallBtn");
        if (acceptBtn) {
          acceptBtn.onclick = () => {
            if (modalEl) modalEl.style.display = "none";
            answerIncomingCall(callDocId, callData.offer, callerData);
          };
        }

        const rejectBtn = document.getElementById("rejectCallBtn");
        if (rejectBtn) {
          rejectBtn.onclick = async () => {
            if (modalEl) modalEl.style.display = "none";
            await updateDoc(doc(window.netChatDB, "calls", callDocId), { status: "rejected" }).catch(() => {});
          };
        }
      }
    });
  }, (error) => {
    console.error("Incoming call listener failed:", error);
  });
}

// ==========================================
// 3. ANSWER INCOMING VIDEO CALL
// ==========================================
async function answerIncomingCall(callDocId, offer, callerData) {
  currentCallDocId = callDocId;
  pendingIceCandidates = [];

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: offer.callType !== "voice", audio: true });
  } catch (err) {
    alert(offer.callType === "voice" ? "Microphone access is required to answer this voice call." : "Camera and microphone access are required to answer this video call.");
    await updateDoc(doc(window.netChatDB, "calls", callDocId), { status: "rejected" }).catch(() => {});
    return;
  }

  const videoCallScreen = document.getElementById("videoCallScreen");
  if (videoCallScreen) videoCallScreen.style.display = "flex";

  const callUserName = document.getElementById("callUserName");
  if (callUserName) callUserName.textContent = callerData.userFullname || "NetChat User";

  const callUserAvatar = document.getElementById("callUserAvatar");
  if (callUserAvatar) callUserAvatar.src = callerData.profileImage || "default-avatar.png";

  const callStatusText = document.getElementById("callStatusText");
  if (callStatusText) callStatusText.textContent = "Connecting...";

  remoteStream = new MediaStream();
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");

  if (localVideo) { localVideo.srcObject = localStream; localVideo.hidden = offer.callType === "voice"; }
  if (remoteVideo) { remoteVideo.srcObject = remoteStream; remoteVideo.hidden = offer.callType === "voice"; }

  peerConnection = new RTCPeerConnection(rtcServers);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
    if (remoteVideo) remoteVideo.srcObject = remoteStream;
  };

  const callDocRef = doc(window.netChatDB, "calls", callDocId);
  const answerCandidates = collection(callDocRef, "answerCandidates");
  const offerCandidates = collection(callDocRef, "offerCandidates");

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) addDoc(answerCandidates, event.candidate.toJSON());
  };

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  while (pendingIceCandidates.length > 0) {
    const candidate = pendingIceCandidates.shift();
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  }

  candidatesUnsubscribe = onSnapshot(offerCandidates, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        const candidateData = change.doc.data();
        if (peerConnection && peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidateData)).catch(() => {});
        } else {
          pendingIceCandidates.push(candidateData);
        }
      }
    });
  }, (error) => {
    console.error("WebRTC offer-candidate listener failed:", error);
  });

  const answerDescription = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answerDescription);

  await updateDoc(callDocRef, {
    answer: { type: answerDescription.type, sdp: answerDescription.sdp },
    status: "connected"
  });

  if (callStatusText) callStatusText.textContent = "Connected";

  currentCallUnsubscribe = onSnapshot(callDocRef, (snapshot) => {
    const data = snapshot.data();
    if (data?.status === "ended") endCall(false);
  }, (error) => {
    console.error("Answered call listener failed:", error);
  });
}

// ==========================================
// 4. END CALL & COMPLETE TEARDOWN
// ==========================================
async function endCall(notifyPeer = true) {
  if (notifyPeer && currentCallDocId) {
    const callDocRef = doc(window.netChatDB, "calls", currentCallDocId);
    await updateDoc(callDocRef, { status: "ended" }).catch(() => {});
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
    remoteStream = null;
  }

  const localVid = document.getElementById("localVideo");
  const remoteVid = document.getElementById("remoteVideo");
  if (localVid) localVid.srcObject = null;
  if (remoteVid) remoteVid.srcObject = null;

  if (currentCallUnsubscribe) {
    currentCallUnsubscribe();
    currentCallUnsubscribe = null;
  }
  if (candidatesUnsubscribe) {
    candidatesUnsubscribe();
    candidatesUnsubscribe = null;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  pendingIceCandidates = [];
  currentCallDocId = null;

  const videoCallScreen = document.getElementById("videoCallScreen");
  const incomingCallModal = document.getElementById("incomingCallModal");
  if (videoCallScreen) videoCallScreen.style.display = "none";
  if (incomingCallModal) incomingCallModal.style.display = "none";
}

// ==========================================
// 5. BUTTON LISTENERS & CONTROLS
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  const toggleMicBtn = document.getElementById("toggleMicBtn");
  if (toggleMicBtn) {
    toggleMicBtn.addEventListener("click", () => {
      if (!localStream) return;
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const icon = toggleMicBtn.querySelector(".material-symbols-outlined");
        if (icon) icon.textContent = audioTrack.enabled ? "mic" : "mic_off";
      }
    });
  }

  const toggleCameraBtn = document.getElementById("toggleCameraBtn");
  if (toggleCameraBtn) {
    toggleCameraBtn.addEventListener("click", () => {
      if (!localStream) return;
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const icon = toggleCameraBtn.querySelector(".material-symbols-outlined");
        if (icon) icon.textContent = videoTrack.enabled ? "videocam" : "videocam_off";
      }
    });
  }

  const endCallBtn = document.getElementById("endCallBtn");
  if (endCallBtn) {
    endCallBtn.addEventListener("click", () => endCall(true));
  }

  const minimizeCallBtn = document.getElementById("minimizeCallBtn");
  if (minimizeCallBtn) {
    minimizeCallBtn.addEventListener("click", () => {
      const videoCallScreen = document.getElementById("videoCallScreen");
      if (!videoCallScreen) return;
      videoCallScreen.classList.add("minimized");
    });
  }

  const videoCallScreen = document.getElementById("videoCallScreen");

  if (videoCallScreen) {
    let draggingCall = false;
    let movedCall = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    videoCallScreen.addEventListener("pointerdown", (event) => {
      if (!videoCallScreen.classList.contains("minimized")) return;

      draggingCall = true;
      movedCall = false;

      const rect = videoCallScreen.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      videoCallScreen.setPointerCapture(event.pointerId);
    });

    videoCallScreen.addEventListener("pointermove", (event) => {
      if (!draggingCall) return;

      if (Math.abs(event.clientX - startX) > 5 || Math.abs(event.clientY - startY) > 5) {
        movedCall = true;
      }

      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      const width = videoCallScreen.offsetWidth;
      const height = videoCallScreen.offsetHeight;

      let newLeft = startLeft + (event.clientX - startX);
      let newTop = startTop + (event.clientY - startY);

      const margin = 8;

      newLeft = Math.max(margin, Math.min(newLeft, screenWidth - width - margin));
      newTop = Math.max(margin, Math.min(newTop, screenHeight - height - margin));

      videoCallScreen.style.left = `${newLeft}px`;
      videoCallScreen.style.top = `${newTop}px`;
      videoCallScreen.style.right = "auto";
      videoCallScreen.style.bottom = "auto";
    });

    videoCallScreen.addEventListener("pointerup", () => {
      if (!draggingCall) return;
      draggingCall = false;

      const rect = videoCallScreen.getBoundingClientRect();
      const screenWidth = window.innerWidth;

      const distanceToLeft = rect.left;
      const distanceToRight = screenWidth - rect.right;

      if (distanceToLeft <= distanceToRight) {
        videoCallScreen.style.left = "8px";
      } else {
        videoCallScreen.style.left = `${screenWidth - rect.width - 8}px`;
      }

      videoCallScreen.style.right = "auto";

      if (!movedCall) {
        videoCallScreen.classList.remove("minimized");
        videoCallScreen.style.left = "";
        videoCallScreen.style.top = "";
        videoCallScreen.style.right = "";
        videoCallScreen.style.bottom = "";
      }
    });
  }

  const startCallBtn = document.getElementById("startCallBtn");
  if (startCallBtn) {
    startCallBtn.addEventListener("click", () => startVideoCall());
  }

  const btnVideoCall = document.getElementById("btnVideoCall");
  if (btnVideoCall) {
    btnVideoCall.addEventListener("click", () => {
      document.getElementById("userProfileModal")?.classList.remove("active");
      document.getElementById("profileBackdrop")?.classList.remove("active");
      closeSearch();
      if (activeTargetUser && !activeConversationId) {
        activeConversationId = createConversationId(window.netChatAuthUser.uid, activeTargetUser.theNewCreatedUser || activeTargetUser.uid);
      }
      startVideoCall();
    });
  }
});

const chatMenuBtn = document.getElementById("chatMenuBtn");
const chatDropdown = document.getElementById("chatDropdown");
const mainMenuView = document.getElementById("mainMenuView");
const moreMenuView = document.getElementById("moreMenuView");
const openMoreBtn = document.getElementById("openMoreBtn");
const backToMainMenuBtn = document.getElementById("backToMainMenuBtn");

function resetMenuView() {
  mainMenuView.classList.remove("hidden");
  moreMenuView.classList.add("hidden");
}

if (chatMenuBtn) {
  chatMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isActive = chatDropdown.classList.contains("active");

    if (isActive) {
      chatDropdown.classList.remove("active");
      resetMenuView();
    } else {
      chatDropdown.classList.add("active");
    }
  });
}

if (openMoreBtn) {
  openMoreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    mainMenuView.classList.add("hidden");
    moreMenuView.classList.remove("hidden");
  });
}

if (backToMainMenuBtn) {
  backToMainMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    moreMenuView.classList.add("hidden");
    mainMenuView.classList.remove("hidden");
  });
}

document.addEventListener("click", (e) => {
  if (!chatDropdown) return;
  if (!chatDropdown.contains(e.target) && e.target !== chatMenuBtn) {
    chatDropdown.classList.remove("active");
    resetMenuView();
  }
});

const viewContactBtn = document.getElementById("viewContactBtn");

if (viewContactBtn) {
  viewContactBtn.addEventListener("click", () => {
    if (!activeTargetUser) return;
    if (activeTargetUser.isGroup) { document.getElementById("groupMembersBtn")?.click(); chatDropdown?.classList.remove("active"); return; }

    const modalAvatar = document.getElementById("modalUserAvatar");
    const modalNetchatId = document.getElementById("modalNetchatId");
    const modalUserName = document.getElementById("modalUserName");
    const modalUserBio = document.getElementById("modalUserBio");
    const profileModal = document.getElementById("userProfileModal");
    const profileBackdrop = document.getElementById("profileBackdrop");

    if (modalAvatar) modalAvatar.src = activeTargetUser.profileImage || "default-avatar.png";
    if (modalNetchatId) modalNetchatId.textContent = activeTargetUser.netChatID || "";
    if (modalUserName) modalUserName.textContent = activeTargetUser.userFullname || "NetChat User";
    if (modalUserBio) modalUserBio.textContent = activeTargetUser.about || "No bio available yet.";

    chatDropdown.classList.remove("active");
    resetMenuView();

    if (profileModal) profileModal.classList.add("active");
    if (profileBackdrop) profileBackdrop.classList.add("active");
  });
}

const filterButtons = document.querySelectorAll(".fitter-side .top-item");
let activeChatFilter = "all";
let chatSearchTerm = "";

function applyChatListFilters() {
  const cards = [...document.querySelectorAll("#chatList .chat-card")];
  let visibleCount = 0;

  cards.forEach((card) => {
    const name = (card.querySelector("h3")?.textContent || "").toLowerCase();
    const matchesSearch = name.includes(chatSearchTerm);
    const matchesFilter = activeChatFilter === "all" ||
      (activeChatFilter === "unread" && !!card.querySelector(".badge")) ||
      (activeChatFilter === "favourites" && card.dataset.isFavorite === "true") ||
      (activeChatFilter === "groups" && card.dataset.isGroup === "true");
    const visible = matchesSearch && matchesFilter;
    card.style.display = visible ? "" : "none";
    if (visible) visibleCount++;
  });

  let emptyState = document.getElementById("chatFilterEmpty");
  if (!emptyState && chatList) {
    emptyState = document.createElement("p");
    emptyState.id = "chatFilterEmpty";
    emptyState.className = "chat-filter-empty";
    emptyState.style.cssText = "padding:20px 8px;text-align:center;color:var(--wa-text-muted);font-size:13px;";
    chatList.appendChild(emptyState);
  }

  if (emptyState) {
    const hasChatCards = cards.length > 0;
    emptyState.hidden = !hasChatCards || visibleCount > 0;
    emptyState.textContent = activeChatFilter === "unread"
      ? "No unread chats."
      : activeChatFilter === "favourites"
        ? "No favourite chats yet. Tap the star on a chat to save it here."
        : activeChatFilter === "groups"
          ? "No group chats yet. Create one from the quick menu."
          : (chatSearchTerm ? "No chats match your search." : "No chats yet.");
  }
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const requested = button.textContent.trim().toLowerCase();
    if (["all", "unread", "favourites", "groups"].includes(requested)) {
      activeChatFilter = requested;
      filterButtons.forEach((btn) => btn.classList.toggle("active", btn === button));
      applyChatListFilters();
      return;
    }
  });
});

const bottomNavItems = document.querySelectorAll(".bottom-nav .nav-item");

bottomNavItems.forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();

    bottomNavItems.forEach((btn) => btn.classList.remove("active"));
    item.classList.add("active");
  });
});

const updatesNavBtn = document.getElementById("updatesNavBtn");
const updatesScreen = document.getElementById("updatesScreen");

if (updatesNavBtn && updatesScreen) {
  updatesNavBtn.addEventListener("click", (event) => {
    event.preventDefault();
    chatList.style.display = "none";
    updatesScreen.style.display = "block";
    refreshStatusFeed();
  });
}

const chatsNavBtn = document.getElementById("chatsNavBtn");

if (chatsNavBtn && updatesScreen) {
  chatsNavBtn.addEventListener("click", (event) => {
    event.preventDefault();
    updatesScreen.style.display = "none";
    chatList.style.display = "";
  });
}

["communities", "calls"].forEach((feature) => {
  const button = document.getElementById(`${feature}NavBtn`);
  button?.addEventListener("click", (event) => {
    event.preventDefault();
    if (updatesScreen) updatesScreen.style.display = "none";
    if (chatList) chatList.style.display = "";
    window.netChatOpenFeature?.(feature);
  });
});

/* ============================================================
   NETCHAT — STATUS MODULE — real Firestore backend
   Contacts → statuses → privacy → viewers. No demo data.
   ============================================================ */
'use strict';

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DAY = 24 * 60 * 60 * 1000;
const now = () => Date.now();

const isLive = status => {
  if (!status?.expiresAt) return false;
  const expiresAt = status.expiresAt.toMillis
    ? status.expiresAt.toMillis()
    : new Date(status.expiresAt).getTime();
  return expiresAt > Date.now();
};

const statusTime = ts => {
  if (!ts) return Date.now();
  return ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
};

const timeAgo = ts => {
  const m = Math.floor((now() - statusTime(ts)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ago';
};

const expiresIn = ts => {
  if (!ts) return '';
  const ms = statusTime(ts) - now();
  const h = Math.max(0, Math.ceil(ms / 3600000));
  return h <= 1 ? 'less than 1h left' : 'expires in ' + h + 'h';
};

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- avatar helper (SVG data-URI) ---------- */
function avatarURI(name, color) {
  const initials = String(name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='${color}' stop-opacity='.45'/><stop offset='1' stop-color='%230b0f17'/>
    </linearGradient></defs>
    <rect width='96' height='96' fill='url(%23g)'/>
    <text x='48' y='58' font-family='Arial' font-size='30' font-weight='bold' fill='${color}' text-anchor='middle'>${initials}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/%2523/g, '%23');
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

/* text status backgrounds */
const TEXT_BGS = [
  'linear-gradient(135deg,#0ea5e9,#6366f1)',
  'linear-gradient(135deg,#9d4edd,#4c1d95)',
  'linear-gradient(135deg,#00f0ff,#0e7490)',
  'linear-gradient(135deg,#f472b6,#be123c)',
  'linear-gradient(135deg,#34d399,#065f46)',
  'linear-gradient(135deg,#fbbf24,#b45309)',
];

const PRIVACY_LABELS = {
  contacts: 'My contacts',
  except: 'My contacts except…',
  only: 'Only share with…'
};

/* ============================================================
   MY STATUSES
   ============================================================ */
async function loadMyStatuses() {
  const user = window.netChatAuthUser;
  if (!user) {
    console.log("STATUS: no authenticated user");
    return [];
  }

  try {
    const statusesRef = collection(db, "user", user.uid, "statuses");
    const snapshot = await getDocs(statusesRef);

    // Silently delete expired docs so storage doesn't fill up
    snapshot.docs.forEach(d => {
      if (!isLive(d.data())) deleteDoc(d.ref).catch(() => {});
    });

    const statuses = snapshot.docs.map(statusDoc => ({
      id: statusDoc.id,
      ...statusDoc.data()
    }));

    console.log("STATUS: my Firestore statuses loaded:", statuses);
    return statuses;
  } catch (error) {
    console.error("STATUS: failed to load my statuses:", error);
    return [];
  }
}

/* ============================================================
   STATUS PRIVACY (stored on the owner's user doc)
   ============================================================ */
const STATUS_PRIVACY_DEFAULT = { mode: "contacts", excluded: [], included: [] };

async function getStatusPrivacy(ownerUid) {
  try {
    const snap = await getDoc(doc(db, "user", ownerUid));
    if (!snap.exists()) return STATUS_PRIVACY_DEFAULT;
    return { ...STATUS_PRIVACY_DEFAULT, ...(snap.data().statusPrivacy || {}) };
  } catch (e) {
    return STATUS_PRIVACY_DEFAULT;
  }
}

function isStatusVisibleTo(privacy, viewerUid) {
  if (privacy.mode === "except") return !(privacy.excluded || []).includes(viewerUid);
  if (privacy.mode === "only")   return (privacy.included || []).includes(viewerUid);
  return true; // "contacts"
}

/* ============================================================
   REAL CONTACT STATUS FEED
   Source of truth: user/{myUid}/contacts — never the chats list.
   ============================================================ */
let realStatusContacts = [];

async function loadContactStatuses() {
  const user = window.netChatAuthUser;
  if (!user) {
    console.log("STATUS: no authenticated user yet");
    return [];
  }

  try {
    const contactsRef = collection(db, "user", user.uid, "contacts");
    const contactsSnapshot = await getDocs(contactsRef);

    console.log("STATUS: contacts path:", `user/${user.uid}/contacts`);
    console.log("STATUS: raw contact docs:",
      contactsSnapshot.docs.map(d => ({ uid: d.id, ...d.data() })));

    const myUid = user.uid;
    const results = [];

    for (const contactDoc of contactsSnapshot.docs) {
      const contactUid = contactDoc.id;
      const rel = contactDoc.data();

      if (rel.status !== "accepted") {
        console.log(`STATUS: skip ${contactUid} — relationship status is "${rel.status}"`);
        continue;
      }

      const [userSnap, privacy] = await Promise.all([
        getDoc(doc(db, "user", contactUid)),
        getStatusPrivacy(contactUid)
      ]);

      if (!userSnap.exists()) {
        console.log(`STATUS: skip ${contactUid} — user profile doc missing`);
        continue;
      }

      if (!isStatusVisibleTo(privacy, myUid)) {
        console.log(`STATUS: skip ${contactUid} — their privacy (${privacy.mode}) hides it from you`);
        continue;
      }

      const userData = userSnap.data();
      const statusesSnap = await getDocs(collection(db, "user", contactUid, "statuses"));

      const all = statusesSnap.docs.map(s => ({ id: s.id, ...s.data() }));
      const live = all.filter(isLive).sort(
        (a, b) => statusTime(a.createdAt) - statusTime(b.createdAt)
      );

      console.log(`STATUS: ${userData.userFullname || contactUid} — ${all.length} total, ${live.length} live`);

      if (!live.length) continue; // WhatsApp rule: no live status → not shown

      results.push({
        id: contactUid,
        name: userData.userFullname || "NetChat User",
        color: "#00f0ff",
        profileImage: userData.profileImage || "",
        statuses: live
      });
    }

    console.log("STATUS: real contact statuses loaded:", results);
    return results;
  } catch (error) {
    console.error("STATUS: failed to load contact statuses:", error);
    return [];
  }
}

/* Have I already viewed this specific status? (real viewer doc) */
async function hasViewedStatus(ownerUid, statusId) {
  const me = window.netChatAuthUser;
  if (!me) return false;
  try {
    const snap = await getDoc(
      doc(db, "user", ownerUid, "statuses", statusId, "viewers", me.uid)
    );
    return snap.exists();
  } catch {
    return false;
  }
}

async function refreshStatusFeed() {
  realStatusContacts = await loadContactStatuses();
  renderLists();
}

/* ============================================================
   RENDER — my card + contact lists
   ============================================================ */
async function renderMyCard() {
  const statuses = await loadMyStatuses();
  const live = statuses.filter(isLive);

  const av = $('#myStatusAvatar');

  const profileImage = window.netChatUserData?.profileImage;
  if (profileImage) {
    const img = $('#myAvatarImg');
    if (img) {
      img.src = profileImage;
      img.style.display = 'block';
    }
  }

  av.classList.toggle('has-ring', live.length > 0);

  $('#myStatusTitle').textContent = 'My status';
  $('#myStatusSub').innerHTML = live.length
    ? `<b>${live.length}</b> update${live.length > 1 ? 's' : ''}`
    : 'Tap to add a status update';
  $('#myStatusChevron').textContent = live.length ? 'visibility' : 'chevron_right';

  const myPrivacyMode = window.netChatUserData?.statusPrivacy?.mode || 'contacts';
  $('#privacyLabel').textContent = PRIVACY_LABELS[myPrivacyMode];
}

async function renderLists() {
  const recentList = $('#recentList');
  const viewedList = $('#viewedList');

  if (!realStatusContacts.length) {
    recentList.innerHTML = `<div class="status-empty">No recent updates</div>`;
    viewedList.innerHTML = "";
    $('#viewedSection').style.display = 'none';
    return;
  }

  const recent = [];
  const viewed = [];

  for (const c of realStatusContacts) {
    const flags = await Promise.all(
      c.statuses.map(s => hasViewedStatus(c.id, s.id))
    );
    const hasViewed = flags.some(Boolean);
(hasViewed ? viewed : recent).push(c);
  }

  recentList.innerHTML = recent.length
    ? recent.map(contactCardHTML).join('')
    : `<div class="status-empty">No recent updates</div>`;

  viewedList.innerHTML = viewed.length
    ? viewed.map(contactCardHTML).join('')
    : `<div class="status-empty">Statuses you open will appear here</div>`;

  $('#viewedSection').style.display = viewed.length ? '' : 'none';

  $$('#recentList .status-contact-card, #viewedList .status-contact-card').forEach(el => {
    el.onclick = () => {
      const c = realStatusContacts.find(x => x.id === el.dataset.id);
      if (c) openViewer(c);
    };
  });
}

function contactCardHTML(c) {
  const live = c.statuses.filter(isLive);
  const avatar = c.profileImage || avatarURI(c.name, c.color);
  return `<button class="status-contact-card" data-id="${c.id}">
    <div class="sc-avatar" style="--nx-t:${c.color}"><div><img src="${avatar}" alt=""></div></div>
    <div class="sc-meta"><b>${esc(c.name)}</b><small>${live.length} update${live.length > 1 ? 's' : ''} · ${timeAgo(live[0].createdAt)}</small></div>
  </button>`;
}

/* ============================================================
   CREATE SHEET → COMPOSER
   ============================================================ */
let composerMode = 'text', composerBg = 0, mediaData = null, mediaMime = '';

function openSheet(sheet, bk) { sheet.classList.add('open'); bk.classList.add('show'); }
function closeSheet(sheet, bk) { sheet.classList.remove('open'); bk.classList.remove('show'); }

$('#addStatusBtn').addEventListener('click', e => {
  e.stopPropagation();
  openSheet($('#createSheet'), $('#createSheetBk'));
});
$('#createSheetBk').onclick = () => closeSheet($('#createSheet'), $('#createSheetBk'));
$('#createSheetCancel').onclick = () => closeSheet($('#createSheet'), $('#createSheetBk'));

$('#myStatusCard').addEventListener('click', async () => {
  const statuses = await loadMyStatuses();
  const liveStatuses = statuses.filter(isLive);

  if (liveStatuses.length > 0) {
    openViewer(null);
  } else {
    openSheet($('#createSheet'), $('#createSheetBk'));
  }
});

/* text-mode background chips */
$('#bgChips').innerHTML = TEXT_BGS.map((b, i) =>
  `<div class="bg-chip${i === 0 ? ' on' : ''}" data-i="${i}" style="background:${b}"></div>`).join('');
$$('#bgChips .bg-chip').forEach(ch => ch.onclick = () => {
  composerBg = +ch.dataset.i;
  $$('#bgChips .bg-chip').forEach(x => x.classList.toggle('on', x === ch));
  $('#textStage').style.background = TEXT_BGS[composerBg];
  $('#charCount').style.color = '#fff';
});
$('#textStage').style.background = TEXT_BGS[0];
$('#charCount').style.color = '#fff';

$('#statusText').addEventListener('input', e =>
  $('#charCount').textContent = e.target.value.length + '/700');

$$('.create-opt').forEach(btn => btn.onclick = () => {
  closeSheet($('#createSheet'), $('#createSheetBk'));
  openComposer(btn.dataset.mode);
});

function openComposer(mode) {
  composerMode = mode; mediaData = null; mediaMime = '';
  $('#composerTitle').textContent = mode === 'text' ? 'New text status' : mode === 'image' ? 'New photo status' : 'New video status';
  $('#textMode').hidden = mode !== 'text';
  $('#mediaMode').hidden = mode === 'text';

  if (mode !== 'text') {
    $('#mediaPreview').innerHTML = mode === 'image'
      ? `<span class="mp-empty">Opening camera / gallery…</span>`
      : `<span class="mp-empty">Opening camera…</span>`;
  }

  $('#mediaCaption').value = '';

  if (mode === 'text') {
    $('#composer').classList.add('active');
    setTimeout(() => $('#statusText').focus(), 380);
  } else {
    pickMedia(mode);
  }
}

$('#composerClose').onclick = () => $('#composer').classList.remove('active');

/* pick media: gallery file input (camera capture via `capture` on mobile) */
function pickMedia(mode) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = mode === 'image' ? 'image/*' : 'video/*';
  if (navigator.mediaDevices?.getUserMedia) inp.setAttribute('capture', 'environment');

  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      mediaData = r.result; mediaMime = f.type;
      $('#mediaPreview').innerHTML = mode === 'image'
        ? `<img src="${mediaData}" alt="">`
        : `<video src="${mediaData}" muted loop autoplay playsinline></video>`;
      $('#composer').classList.add('active');
    };
    r.readAsDataURL(f);
  };

  inp.click();
}

/* post — text statuses save to Firestore now; media upload (Cloudinary) is next step */
$('#postStatusBtn').onclick = async () => {
  if (composerMode === 'text') {
    const txt = $('#statusText').value.trim();
    if (!txt) return toast('Write something first');

    const user = window.netChatAuthUser;
    if (!user) return toast('You must be signed in');

    try {
      await addDoc(collection(db, 'user', user.uid, 'statuses'), {
        type: 'text',
        text: txt,
        background: composerBg,
        createdAt: serverTimestamp(),
        expiresAt: new Date(Date.now() + DAY)
      });
      window.netChatTrackAchievementEvent?.("status");
    } catch (error) {
      console.error('STATUS: failed to save text status:', error);
      return toast('Failed to post status');
    }

    $('#statusText').value = '';
    $('#charCount').textContent = '0/700';
    $('#composer').classList.remove('active');
    renderMyCard();
    toast('Status posted');
    return;
  }

  if (!mediaData) return toast('Pick a ' + composerMode + ' first');

  const statusUser = window.netChatAuthUser;
  if (!statusUser) return toast('You must be signed in');

  const statusPostBtn = $('#postStatusBtn');
  statusPostBtn.disabled = true;

  try {
    toast('Uploading status…');
    const blob = await (await fetch(mediaData)).blob();
    const uploaded = await uploadChatMediaToCloudinary(blob);

    await addDoc(collection(db, 'user', statusUser.uid, 'statuses'), {
      type: composerMode === 'video' ? 'video' : 'image',
      mediaUrl: uploaded.url,
      caption: $('#mediaCaption').value.trim() || null,
      mime: mediaMime || null,
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + DAY)
    });
    window.netChatTrackAchievementEvent?.("status");

    $('#composer').classList.remove('active');
    mediaData = null;
    $('#mediaCaption').value = '';
    await renderMyCard();
    await refreshStatusFeed();
    toast('Status posted');
  } catch (error) {
    console.error('STATUS: media upload failed:', error);
    toast('Failed to upload status');
  } finally {
    statusPostBtn.disabled = false;
  }
  return;
};

/* ============================================================
   STATUS VIEWER ENGINE
   ============================================================ */
const viewer = { open: false, mine: false, list: [], idx: 0, raf: null, start: 0, remaining: 0, paused: false, videoEl: null };

async function buildQueue(contact) {
  if (contact) {
    return contact.statuses
      .filter(isLive)
      .map(s => ({ ...s, author: contact }));
  }

  const statuses = await loadMyStatuses();
  return statuses
    .filter(isLive)
    .map(s => ({ ...s, author: null }));
}

async function openViewer(contact, startIdx = 0) {
  viewer.mine = !contact;
  viewer.list = await buildQueue(contact);
  if (!viewer.list.length) return toast('No active updates');

  $('#viewer').classList.add('active');
  $('#viewer').classList.toggle('mine', viewer.mine);
  viewer.open = true;
  showItem(startIdx);
}

function closeViewer() {
  viewer.open = false; stopTimer(); killVideo();
  $('#viewer').classList.remove('active', 'paused');
  renderMyCard();
  renderLists();
}

function killVideo() {
  if (viewer.videoEl) {
    viewer.videoEl.pause();
    viewer.videoEl.remove();
    viewer.videoEl = null;
  }
}

function renderProgress() {
  $('#vProgress').innerHTML = viewer.list.map((_, i) =>
    `<div class="v-seg"><i style="width:${i < viewer.idx ? 100 : 0}%"></i></div>`).join('');
}

function showItem(idx) {
  viewer.idx = idx; stopTimer(); killVideo();
  const it = viewer.list[idx];
  renderProgress();

  const author = it.author || {
    name: window.netChatUserData?.userFullname || 'My status',
    color: '#00f0ff',
    img: window.netChatUserData?.profileImage || ''
  };

  const authorImg = it.author
    ? (it.author.profileImage || avatarURI(author.name, author.color))
    : (author.img || avatarURI(author.name, '#00f0ff'));

  $('#vUser').innerHTML = it.author
    ? `<img src="${authorImg}" alt=""><div><b>${esc(author.name)}</b><small>${timeAgo(it.createdAt)}</small></div>`
    : `<img src="${authorImg}" alt=""><div><b>My status</b><small>${expiresIn(it.expiresAt)}</small></div>`;

  $('#vTime').textContent = timeAgo(it.createdAt);
  $('#vCaption').textContent = it.caption || '';

  const stage = $('#vStage');
  stage.querySelectorAll('.v-media, .v-text').forEach(n => n.remove());

  let dur = 5000;

  if (it.type === 'text') {
    const div = document.createElement('div');
    div.className = 'v-text';
    div.style.background = TEXT_BGS[it.background || 0];
    div.innerHTML = `<p>${esc(it.text || '')}</p>`;
    stage.prepend(div);
  } else if (it.type === 'image') {
    const mediaSrc = it.mediaUrl || it.content || '';
    if (!mediaSrc) return nextItem();
    const div = document.createElement('div');
    div.className = 'v-media';
    div.innerHTML = `<img src="${mediaSrc}" alt="">`;
    stage.prepend(div);
  } else {
    const mediaSrc = it.mediaUrl || it.content || '';
    if (!mediaSrc) return nextItem();
    const div = document.createElement('div');
    div.className = 'v-media';
    const v = document.createElement('video');
    v.src = mediaSrc;
    v.autoplay = true; v.playsInline = true; v.muted = false;
    if (it.mime) v.type = it.mime;
    v.addEventListener('loadedmetadata', () => {
      if (v.duration && isFinite(v.duration)) dur = Math.min(v.duration * 1000, 60000);
      startTimer(dur);
    }, { once: true });
    v.addEventListener('error', () => startTimer(5000), { once: true });
    div.appendChild(v);
    stage.prepend(div);
    viewer.videoEl = v;
  }

      if (it.author) {
  console.log("STATUS: recording view for:", it.author.id, it.id);
  recordStatusView(it.author.id, it.id);
}

  if (viewer.mine && window.netChatAuthUser) {
    loadStatusViewers(window.netChatAuthUser.uid, it.id)
      .then(vs => { $('#vViewCount').textContent = vs.length; })
      .catch(() => {});
  }

  if (it.type !== 'video') startTimer(dur);
}

/* ---------- timer with pause support ---------- */
function startTimer(dur) {
  viewer.remaining = dur; viewer.start = performance.now(); viewer.paused = false;
  $('#viewer').classList.remove('paused');
  tick();
}

function tick() {
  cancelAnimationFrame(viewer.raf);
  const step = t => {
    if (viewer.paused) { viewer.raf = requestAnimationFrame(step); return; }
    const p = Math.min((t - viewer.start) / viewer.remaining, 1);
    const seg = $$('#vProgress .v-seg')[viewer.idx];
    if (seg) seg.firstElementChild.style.width = (p * 100) + '%';
    if (p >= 1) nextItem(); else viewer.raf = requestAnimationFrame(step);
  };
  viewer.raf = requestAnimationFrame(step);
}

function stopTimer() { cancelAnimationFrame(viewer.raf); }

function pauseAll() {
  if (viewer.paused) return;
  viewer.paused = true;
  const seg = $$('#vProgress .v-seg')[viewer.idx];
  if (seg) viewer.remaining *= 1 - (parseFloat(seg.firstElementChild.style.width) || 0) / 100;
  viewer.start = performance.now();
  if (viewer.videoEl) viewer.videoEl.pause();
  $('#viewer').classList.add('paused');
}

function resumeAll() {
  if (!viewer.paused) return;
  viewer.paused = false; viewer.start = performance.now();
  if (viewer.videoEl) viewer.videoEl.play().catch(() => {});
  $('#viewer').classList.remove('paused');
}

function nextItem() {
  if (viewer.idx < viewer.list.length - 1) showItem(viewer.idx + 1);
  else closeViewer();
}

function prevItem() { showItem(viewer.idx > 0 ? viewer.idx - 1 : 0); }

/* tap zones + hold-to-pause + swipe-down-to-close */
(() => {
  const stage = $('#vStage');
  let pd = 0, py = 0, swiping = false;

  stage.addEventListener('pointerdown', e => {
    pd = performance.now(); py = e.clientY; swiping = false;
    pauseAll();
  });

  stage.addEventListener('pointermove', e => {
    if (!pd) return;
    const dy = e.clientY - py;
    if (dy > 12) swiping = true;
    if (swiping) stage.parentElement.style.transform = `translateY(${Math.max(0, dy)}px)`;
  });

  const end = e => {
    if (!pd) return;
    const held = performance.now() - pd;
    const dy = (e.clientY || py) - py;

    if (swiping && dy > 110) {
      stage.parentElement.style.transform = '';
      pd = 0;
      closeViewer();
      return;
    }

    stage.parentElement.style.transform = '';
    pd = 0;
    resumeAll();

    if (held < 260 && Math.abs(dy) < 12) {
      (e.clientX - stage.getBoundingClientRect().left) < stage.offsetWidth * 0.32
        ? prevItem()
        : nextItem();
    }
  };

  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', e => { if (pd) end(e); });
})();

$('#vClose').onclick = closeViewer;

document.addEventListener('keydown', e => {
  if (!viewer.open) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowRight') nextItem();
  if (e.key === 'ArrowLeft') prevItem();
});

/* ---------- view recording ---------- */
async function recordStatusView(ownerUid, statusId) {
  const me = window.netChatAuthUser;
  if (!me) return;
  if (me.uid === ownerUid) return; // never record the owner

  try {
    await setDoc(
      doc(db, 'user', ownerUid, 'statuses', statusId, 'viewers', me.uid),
      { viewedAt: serverTimestamp() }
    );
    console.log('STATUS: viewer recorded');
  } catch (error) {
    console.error('STATUS: failed to record viewer:', error);
  }
}

async function loadStatusViewers(ownerUid, statusId) {
  try {
    const viewersRef = collection(
      db, 'user', ownerUid, 'statuses', statusId, 'viewers'
    );
    const snapshot = await getDocs(viewersRef);

    const viewers = snapshot.docs.map(viewerDoc => ({
      uid: viewerDoc.id,
      ...viewerDoc.data()
    }));

    console.log('STATUS: viewers loaded:', viewers);
    return viewers;
  } catch (error) {
    console.error('STATUS: failed to load viewers:', error);
    return [];
  }
}

async function refreshViewerQueue() {
  viewer.list = await buildQueue(null);
  if (viewer.idx >= viewer.list.length) viewer.idx = 0;
  renderProgress();
  showItem(viewer.idx);
}

/* ============================================================
   OWN-STATUS TOOLS: viewers / add / repost / delete
   ============================================================ */
$('#vViewersBtn').onclick = async () => {
  const it = viewer.list[viewer.idx];
  const me = window.netChatAuthUser;
  if (!it || !me) return;

  const viewerDocs = await loadStatusViewers(me.uid, it.id);

  const rows = await Promise.all(viewerDocs.map(async (v) => {
    let name = "NetChat User", img = "";
    try {
      const u = await getDoc(doc(db, "user", v.uid));
      if (u.exists()) {
        name = u.data().userFullname || name;
        img = u.data().profileImage || "";
      }
    } catch {}
    return `
      <div class="viewer-row">
        <img src="${img || avatarURI(name, "#00f0ff")}" alt="">
        <div class="vr-meta"><b>${esc(name)}</b><small>Viewed your status</small></div>
        <span class="vr-time">${v.viewedAt ? timeAgo(v.viewedAt) : ""}</span>
      </div>`;
  }));

  $('#viewersCount').textContent = viewerDocs.length;
  $('#viewersList').innerHTML = rows.join('') ||
    `<div class="status-empty">No views yet</div>`;

  openSheet($('#viewersSheet'), $('#viewersBk'));
};

$('#viewersBk').onclick = () => closeSheet($('#viewersSheet'), $('#viewersBk'));

$('#vAddMoreBtn').onclick = e => {
  e.stopPropagation();
  openSheet($('#createSheet'), $('#createSheetBk'));
};

/* repost — creates a NEW real Firestore status with a fresh 24h window */
$('#vRepostBtn').onclick = async () => {
  const it = viewer.list[viewer.idx];
  const me = window.netChatAuthUser;
  if (!it || !me) return;

  try {
    await addDoc(collection(db, 'user', me.uid, 'statuses'), {
      type: it.type,
      text: it.text || null,
      background: (it.background ?? null),
      mediaUrl: it.mediaUrl || null,
      caption: it.caption || null,
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + DAY)
    });
    window.netChatTrackAchievementEvent?.("status");

    await renderMyCard();
    await refreshViewerQueue();
    toast('Reposted — visible for another 24h');
  } catch (error) {
    console.error('STATUS: repost failed:', error);
    toast('Failed to repost');
  }
};

/* delete with confirm */
$('#vDeleteBtn').onclick = () => $('#confirmBk').classList.add('show');
$('#confirmNo').onclick = () => $('#confirmBk').classList.remove('show');
$('#confirmBk').addEventListener('click', e => {
  if (e.target === $('#confirmBk')) $('#confirmBk').classList.remove('show');
});

$('#confirmYes').onclick = async () => {
  const it = viewer.list[viewer.idx];
  const user = window.netChatAuthUser;
  if (!user) return toast('You must be signed in');

  try {
    await deleteDoc(doc(db, 'user', user.uid, 'statuses', it.id));
  } catch (error) {
    console.error('STATUS: failed to delete status:', error);
    $('#confirmBk').classList.remove('show');
    return toast('Failed to delete status');
  }

  viewer.list = await buildQueue(null);
  $('#confirmBk').classList.remove('show');

  if (!viewer.list.length) {
    closeViewer();
    renderMyCard();
    toast('Status deleted');
  } else {
    showItem(Math.min(viewer.idx, viewer.list.length - 1));
    renderMyCard();
    toast('Status deleted');
  }
};

/* ============================================================
   PRIVACY SHEET — persisted in Firestore on the user doc
   ============================================================ */
$('#privacyRow').onclick = async () => {
  const me = window.netChatAuthUser;
  if (!me) return;

  let p = STATUS_PRIVACY_DEFAULT;
  try {
    const snap = await getDoc(doc(db, 'user', me.uid));
    if (snap.exists()) {
      p = { ...STATUS_PRIVACY_DEFAULT, ...(snap.data().statusPrivacy || {}) };
    }
  } catch {}

  $$('input[name="privacy"]').forEach(r => r.checked = r.value === p.mode);
  $('#privacyLabel').textContent = PRIVACY_LABELS[p.mode];
  openSheet($('#privacySheet'), $('#privacyBk'));
};

$('#privacyBk').onclick = () => closeSheet($('#privacySheet'), $('#privacyBk'));

$$('input[name="privacy"]').forEach(r => r.addEventListener('change', async () => {
  const me = window.netChatAuthUser;
  if (!me) return;

  try {
    const snap = await getDoc(doc(db, 'user', me.uid));
    const current = {
      ...STATUS_PRIVACY_DEFAULT,
      ...((snap.exists() && snap.data().statusPrivacy) || {})
    };
    current.mode = r.value;

    await setDoc(doc(db, 'user', me.uid), { statusPrivacy: current }, { merge: true });

    $('#privacyLabel').textContent = PRIVACY_LABELS[r.value];
    closeSheet($('#privacySheet'), $('#privacyBk'));

    toast({
      contacts: 'Status shared with all contacts',
      except: 'Mode saved — contact picker comes next',
      only: 'Mode saved — contact picker comes next'
    }[r.value]);
  } catch (error) {
    console.error('STATUS: privacy save failed:', error);
    toast('Failed to update privacy');
  }
}));

/* my avatar: offline fallback */
(() => {
  const img = $('#myAvatarImg');
  if (!img) return;
  img.onerror = () => {
    const d = document.createElement('div');
    d.className = 'avatar-fallback';
    d.textContent = 'ME';
    img.replaceWith(d);
  };
  if (!img.complete || img.naturalWidth === 0) img.onerror();
})();

/* ============================================================
   NETCHAT SYSTEM INBOX SCREEN
   ============================================================ */
const netChatSystemScreen = document.getElementById("netChatSystemScreen");
const closeNetChatSystemBtn = document.getElementById("closeNetChatSystemBtn");

function openNetChatSystem() {
  if (!netChatSystemScreen) return;
  netChatSystemScreen.style.display = "flex";
  renderNetChatSystemItems();
}

function closeNetChatSystem() {
  if (!netChatSystemScreen) return;
  netChatSystemScreen.style.display = "none"
}

closeNetChatSystemBtn?.addEventListener("click", closeNetChatSystem);




















const chatMediaPreview = document.getElementById("chatMediaPreview");
const chatMediaPreviewList = document.getElementById("chatMediaPreviewList");

const chatImageBtn = document.getElementById("chatImageBtn");
const chatImageInput = document.getElementById("chatImageInput");

const chatGalleryBtn = document.getElementById("chatGalleryBtn");
const chatGalleryInput = document.getElementById("chatGalleryInput");

const chatMediaViewer = document.getElementById("chatMediaViewer");
const chatMediaViewerContent = document.getElementById("chatMediaViewerContent");
const chatMediaViewerCounter = document.getElementById("chatMediaViewerCounter");
const chatMediaViewerClose = document.getElementById("chatMediaViewerClose");

let selectedChatMedia = [];
let chatMediaViewerIndex = 0;
let chatMediaViewerUrl = null;


// ===============================
// CAMERA BUTTON
// ===============================

if (chatImageBtn && chatImageInput) {
  chatImageBtn.addEventListener("click", () => {
    chatImageInput.click();
  });
}


// ===============================
// GALLERY BUTTON
// ===============================

if (chatGalleryBtn && chatGalleryInput) {
  chatGalleryBtn.addEventListener("click", () => {
    chatGalleryInput.click();
  });
}


// ===============================
// CAMERA SELECTION
// ===============================

chatImageInput?.addEventListener("change", () => {
  const file = chatImageInput.files?.[0];
  
  if (!file) return;
  
  selectedChatMedia = [file];
  
  renderChatMediaPreview();
  
  chatImageInput.value = "";
});


// ===============================
// GALLERY SELECTION
// ===============================

chatGalleryInput?.addEventListener("change", () => {
  const files = Array.from(chatGalleryInput.files || []);
  
  if (!files.length) return;
  
  selectedChatMedia = files;
  
  renderChatMediaPreview();
  
  chatGalleryInput.value = "";
});


// ===============================
// RENDER MEDIA PREVIEW
// ===============================

function renderChatMediaPreview() {
  if (!chatMediaPreviewList) return;
  
  chatMediaPreviewList.innerHTML = "";
  
  selectedChatMedia.forEach((file) => {
    const item = document.createElement("div");
    
    item.className = "chat-media-preview-item";
    
    const mediaUrl = URL.createObjectURL(file);
    
    if (file.type.startsWith("image/")) {
      item.innerHTML = `
        <img
          src="${mediaUrl}"
          alt="Selected image"
        >
      `;
    } else if (file.type.startsWith("video/")) {
      item.innerHTML = `
        <video
          src="${mediaUrl}"
          muted
          playsinline
        ></video>
      `;
    }
    
    const removeBtn = document.createElement("button");
    
    removeBtn.type = "button";
    removeBtn.className = "chat-media-remove";
    
    removeBtn.innerHTML = `
      <span class="material-symbols-outlined">close</span>
    `;
    
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      
      URL.revokeObjectURL(mediaUrl);
      
      const mediaIndex = selectedChatMedia.indexOf(file);
      
      if (mediaIndex !== -1) {
        selectedChatMedia.splice(mediaIndex, 1);
      }
      
      item.remove();
      
      if (!selectedChatMedia.length) {
        chatMediaPreview.hidden = true;
      }
    });
    
    item.appendChild(removeBtn);
    
    // Tap thumbnail → open full-screen viewer
    item.addEventListener("click", () => {
      const mediaIndex = selectedChatMedia.indexOf(file);
      
      if (mediaIndex !== -1) {
        openChatMediaViewer(mediaIndex);
      }
    });
    
    chatMediaPreviewList.appendChild(item);
  });
  
  chatMediaPreview.hidden = selectedChatMedia.length === 0;
}


// ===============================
// OPEN MEDIA VIEWER
// ===============================

function openChatMediaViewer(index) {
  if (!selectedChatMedia.length) return;
  
  const file = selectedChatMedia[index];
  
  if (!file) return;
  
  chatMediaViewerIndex = index;
  
  chatMediaViewerContent.innerHTML = "";
  
  if (chatMediaViewerUrl) {
    URL.revokeObjectURL(chatMediaViewerUrl);
  }
  
  chatMediaViewerUrl = URL.createObjectURL(file);
  
  if (file.type.startsWith("image/")) {
    const image = document.createElement("img");
    
    image.src = chatMediaViewerUrl;
    image.alt = "Selected image";
    
    chatMediaViewerContent.appendChild(image);
  }
  
if (file.type.startsWith("video/")) {
  const video = document.createElement("video");
  
  video.controls = true;
  video.muted = true;
  video.playsInline = true;
  
  video.addEventListener("error", () => {
    alert(
      "Chrome could not play this video.\n\n" +
      "File type: " + file.type + "\n" +
      "Error code: " + (video.error?.code || "unknown")
    );
  });
  
  chatMediaViewerContent.appendChild(video);
  
  video.src = chatMediaViewerUrl;
  video.load();
}
  
  chatMediaViewerCounter.textContent =
    `${chatMediaViewerIndex + 1} / ${selectedChatMedia.length}`;
  
  chatMediaViewer.hidden = false;
}


// ===============================
// CLOSE MEDIA VIEWER
// ===============================

function closeChatMediaViewer() {
  chatMediaViewer.hidden = true;
  
  chatMediaViewerContent.innerHTML = "";
  
  if (chatMediaViewerUrl) {
    URL.revokeObjectURL(chatMediaViewerUrl);
    chatMediaViewerUrl = null;
  }
}


let chatMediaTouchStartX = 0;
let chatMediaTouchEndX = 0;

chatMediaViewerContent.addEventListener("touchstart", (event) => {
  chatMediaTouchStartX = event.touches[0].clientX;
});

chatMediaViewerContent.addEventListener("touchend", (event) => {
  chatMediaTouchEndX = event.changedTouches[0].clientX;

  const swipeDistance =
    chatMediaTouchEndX - chatMediaTouchStartX;

  // Ignore very small movements
  if (Math.abs(swipeDistance) < 50) return;

  if (swipeDistance < 0) {
    // Swipe left → next media
    showNextChatMedia();
  } else {
    // Swipe right → previous media
    showPreviousChatMedia();
  }
});


function showNextChatMedia() {
  if (!selectedChatMedia.length) return;

  const nextIndex =
    chatMediaViewerIndex + 1;

  if (nextIndex >= selectedChatMedia.length) return;

  openChatMediaViewer(nextIndex);
}


function showPreviousChatMedia() {
  if (!selectedChatMedia.length) return;

  const previousIndex =
    chatMediaViewerIndex - 1;

  if (previousIndex < 0) return;

  openChatMediaViewer(previousIndex);
}

chatMediaViewerClose?.addEventListener(
  "click",
  closeChatMediaViewer
);























// ============================================================
// WHATSAPP-STYLE MEDIA FEED & LIGHTBOX ENGINE
// ============================================================

// State Tracking
let currentFeedMedia = [];
let currentFeedSender = "";
let currentFeedMessageId = null;
let currentLightboxIndex = 0;
let longPressTimer = null;

// DOM Elements
const mediaFeedModal = document.getElementById("mediaFeedModal");
const closeMediaFeedBtn = document.getElementById("closeMediaFeedBtn");
const mediaFeedSenderName = document.getElementById("mediaFeedSenderName");
const mediaFeedMetaCount = document.getElementById("mediaFeedMetaCount");
const mediaFeedBody = document.getElementById("mediaFeedBody");
const mediaReactionPopup = document.getElementById("mediaReactionPopup");

const mediaLightboxModal = document.getElementById("mediaLightboxModal");
const closeLightboxBtn = document.getElementById("closeLightboxBtn");
const lightboxSenderName = document.getElementById("lightboxSenderName");
const lightboxTimestamp = document.getElementById("lightboxTimestamp");
const lightboxMediaContent = document.getElementById("lightboxMediaContent");

// ------------------------------------------------------------
// 1. OPEN VERTICAL MEDIA FEED
// ------------------------------------------------------------
function openMediaFeed(mediaList, senderName, messageId) {
  if (!mediaList || !mediaList.length) return;

  currentFeedMedia = mediaList;
  currentFeedSender = senderName || "Media";
  currentFeedMessageId = messageId || null;

  // Calculate Photos vs Videos count
  const photoCount = mediaList.filter(m => m.resourceType !== "video").length;
  const videoCount = mediaList.filter(m => m.resourceType === "video").length;

  const countParts = [];
  if (photoCount > 0) countParts.push(`${photoCount} photo${photoCount > 1 ? "s" : ""}`);
  if (videoCount > 0) countParts.push(`${videoCount} video${videoCount > 1 ? "s" : ""}`);

  mediaFeedSenderName.textContent = currentFeedSender;
  mediaFeedMetaCount.textContent = countParts.join(", ");

  // Render vertical list
  mediaFeedBody.innerHTML = mediaList.map((media, index) => {
    const isVideo = media.resourceType === "video";
    return `
      <div class="media-feed-item" data-index="${index}">
        ${
          isVideo
            ? `<video src="${escapeHTML(media.url)}" controls playsinline></video>`
            : `<img src="${escapeHTML(media.url)}" alt="Media item">`
        }
      </div>
    `;
  }).join("");

  // Attach click & long-press event listeners
  mediaFeedBody.querySelectorAll(".media-feed-item").forEach((item) => {
    const index = parseInt(item.dataset.index, 10);

    // Long Press Handler (Hold for reactions)
    item.addEventListener("touchstart", (e) => {
      longPressTimer = setTimeout(() => {
        currentActionMessageId = currentFeedMessageId;
        showReactionPopup(e.touches[0].clientX, e.touches[0].clientY);
      }, 500);
    });

    item.addEventListener("touchend", () => clearTimeout(longPressTimer));
    item.addEventListener("touchmove", () => clearTimeout(longPressTimer));

    // Tap Handler (Open Lightbox)
    item.addEventListener("click", (e) => {
      // Don't open lightbox if clicking video controls
      if (e.target.tagName.toLowerCase() === "video") return;
      openLightbox(index);
    });
  });

  mediaFeedModal.hidden = false;
}

// Close Vertical Feed
closeMediaFeedBtn?.addEventListener("click", () => {
  mediaFeedModal.hidden = true;
  hideReactionPopup();
});


// ------------------------------------------------------------
// 2. REACTION POPUP (LONG-PRESS)
// ------------------------------------------------------------
function showReactionPopup(x, y) {
  if (!mediaReactionPopup) return;
  mediaReactionPopup.style.top = `${Math.max(20, y - 60)}px`;
  mediaReactionPopup.style.left = `${Math.min(window.innerWidth - 300, Math.max(10, x - 140))}px`;
  mediaReactionPopup.hidden = false;
}

function hideReactionPopup() {
  if (mediaReactionPopup) mediaReactionPopup.hidden = true;
}

document.addEventListener("click", (e) => {
  if (mediaReactionPopup && !mediaReactionPopup.contains(e.target)) {
    hideReactionPopup();
  }
});


// ------------------------------------------------------------
// 3. FULL-SCREEN LIGHTBOX GALLERY (SWIPE VIEW)
// ------------------------------------------------------------
function openLightbox(index) {
  if (index < 0 || index >= currentFeedMedia.length) return;

  currentLightboxIndex = index;
  const media = currentFeedMedia[index];
  const isVideo = media.resourceType === "video";

  lightboxSenderName.textContent = currentFeedSender;
  lightboxTimestamp.textContent = `${index + 1} of ${currentFeedMedia.length}`;

  lightboxMediaContent.innerHTML = isVideo
    ? `<video src="${escapeHTML(media.url)}" controls autoplay playsinline></video>`
    : `<img src="${escapeHTML(media.url)}" alt="Full view">`;

  mediaLightboxModal.hidden = false;
}

closeLightboxBtn?.addEventListener("click", () => {
  mediaLightboxModal.hidden = true;
  lightboxMediaContent.innerHTML = "";
});


// ------------------------------------------------------------
// 4. TOUCH SWIPE LOGIC FOR LIGHTBOX (LEFT / RIGHT)
// ------------------------------------------------------------
let lightboxStartX = 0;
let lightboxEndX = 0;

lightboxMediaContent?.addEventListener("touchstart", (e) => {
  lightboxStartX = e.touches[0].clientX;
});

lightboxMediaContent?.addEventListener("touchend", (e) => {
  lightboxEndX = e.changedTouches[0].clientX;
  const diffX = lightboxEndX - lightboxStartX;

  // Swipe threshold
  if (Math.abs(diffX) > 50) {
    if (diffX < 0 && currentLightboxIndex < currentFeedMedia.length - 1) {
      // Swipe Left → Next Media
      openLightbox(currentLightboxIndex + 1);
    } else if (diffX > 0 && currentLightboxIndex > 0) {
      // Swipe Right → Previous Media
      openLightbox(currentLightboxIndex - 1);
    }
  }
});


// ------------------------------------------------------------
// 5. ATTACH CLICK LISTENER TO CHAT BUBBLE GRIDS
// ------------------------------------------------------------
// Call this inside `listenToConversationMessages` or delegate dynamically:
document.getElementById("chatMessagesBody")?.addEventListener("click", (e) => {
  const grid = e.target.closest(".chat-media-grid");
  if (!grid) return;

  const msgRow = grid.closest(".msg-row");
  if (!msgRow) return;

  const messageId = msgRow.dataset.messageId;
  
  // Find current message document data from snapshot
  const messageDoc = window.currentChatSnapshotDocs?.find(doc => doc.id === messageId);
  if (!messageDoc) return;

  const messageData = messageDoc.data();
  const isOutgoing = messageData.senderId === window.netChatAuthUser.uid;
  const senderName = isOutgoing
    ? "You"
    : (senderProfileCache.get(messageData.senderId)?.userFullname || activeTargetUser?.userFullname || "NetChat User");
  const visualMedia = (messageData.media || []).filter((media) => media.resourceType === "image" || media.resourceType === "video" || (!media.resourceType && media.url));
  if (!visualMedia.length) return;
  openMediaFeed(visualMedia, senderName, messageId);
});


/* ============================================================
   NETCHAT UPGRADE PATCH — message actions, reactions,
   chat tools, global wiring
   ============================================================ */
let currentActionMessageId = null;
let msgActionBackdrop = null;
let msgActionSheet = null;
let nxReactionBar = null;
let messageIdForReaction = null;

function ensureMsgActionSheet() {
  if (msgActionBackdrop) return;
  msgActionBackdrop = document.createElement("div");
  msgActionBackdrop.style.cssText = "position:fixed;inset:0;background:rgba(4,7,12,.62);backdrop-filter:blur(3px);z-index:2900;display:none;align-items:center;justify-content:center;padding:24px;";
  msgActionSheet = document.createElement("div");
  msgActionSheet.style.cssText = "width:100%;max-width:320px;background:rgba(16,21,33,.97);border:1px solid rgba(255,255,255,.08);border-radius:22px;padding:10px;display:flex;flex-direction:column;gap:2px;box-shadow:0 24px 70px rgba(0,0,0,.6);";
  msgActionBackdrop.appendChild(msgActionSheet);
  msgActionBackdrop.addEventListener("click", (e) => { if (e.target === msgActionBackdrop) closeMessageActions(); });
  document.body.appendChild(msgActionBackdrop);
}

function msgActionButton(label, iconName, danger, onClick) {
  const btn = document.createElement("button");
  btn.style.cssText = "display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;border:none;border-radius:14px;background:transparent;font-size:14px;font-weight:600;cursor:pointer;text-align:left;color:" + (danger ? "#fb7185" : "#f8fafc") + ";";
  btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;color:${danger ? "#fb7185" : "#00e5ff"}">${iconName}</span>${label}`;
  btn.addEventListener("mouseenter", () => { btn.style.background = danger ? "rgba(244,63,94,.1)" : "rgba(255,255,255,.05)"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; });
  btn.addEventListener("click", onClick);
  return btn;
}

function openMessageActions(messageId, x, y) {
  const docs = window.currentChatSnapshotDocs || [];
  const messageDoc = docs.find((d) => d.id === messageId);
  if (!messageDoc) return;
  const messageData = messageDoc.data();
  if (messageData.deleted) return;
  currentActionMessageId = messageId;
  ensureMsgActionSheet();
  const myUid = window.netChatAuthUser?.uid;
  const isOutgoing = messageData.senderId === myUid;
  msgActionSheet.innerHTML = "";

  msgActionSheet.appendChild(msgActionButton("Reply", "reply", false, () => {
    closeMessageActions();
    replyingToMessage = {
      id: messageId,
      text: (messageData.text || "").slice(0, 200),
      senderId: messageData.senderId,
      senderName: isOutgoing ? (window.netChatUserData?.userFullname || "You") : (senderProfileCache.get(messageData.senderId)?.userFullname || activeTargetUser?.userFullname || "NetChat User")
    };
    const rp = document.getElementById("replyPreview");
    const rt = document.getElementById("replyPreviewText");
    if (rp && rt) { rt.textContent = messageData.text || "Media"; rp.style.display = "flex"; }
    setTimeout(() => messageInput?.focus(), 50);
  }));

  if (messageData.text) {
    msgActionSheet.appendChild(msgActionButton("Copy text", "content_copy", false, async () => {
      closeMessageActions();
      try { await navigator.clipboard.writeText(messageData.text); toast("Copied to clipboard"); } catch {}
    }));
  }

  const isStarredByMe = messageData.stars?.[myUid] === true ||
    (Array.isArray(messageData.starredBy) && messageData.starredBy.includes(myUid));
  msgActionSheet.appendChild(msgActionButton(isStarredByMe ? "Remove star" : "Star message", "star", false, async () => {
    closeMessageActions();
    try {
      await updateDoc(messageDoc.ref, { [`stars.${myUid}`]: !isStarredByMe });
      toast(isStarredByMe ? "Star removed" : "Message starred");
    } catch (error) { console.error(error); toast("Could not save star. Check Firestore rules."); }
  }));

  msgActionSheet.appendChild(msgActionButton("React", "add_reaction", false, () => {
    closeMessageActions();
    showNxReactionBar(messageId, x, y);
  }));

  if (isOutgoing) {
    msgActionSheet.appendChild(msgActionButton("Delete for everyone", "delete", true, () => {
      closeMessageActions();
      deleteMessageForEveryone(messageDoc.ref);
    }));
  }

  msgActionSheet.appendChild(msgActionButton("Delete for me", "delete_sweep", true, () => {
    closeMessageActions();
    deleteMessageForMe(messageDoc.ref, messageId);
  }));

  msgActionBackdrop.style.display = "flex";
}

function closeMessageActions() {
  if (msgActionBackdrop) msgActionBackdrop.style.display = "none";
  currentActionMessageId = null;
}

async function deleteMessageForEveryone(messageRef) {
  try {
    await updateDoc(messageRef, { deleted: true, text: "", media: [], reactions: {} });
    toast("Message deleted for everyone");
  } catch (error) {
    console.error("Delete failed:", error);
    toast("Could not delete message");
  }
}

async function deleteMessageForMe(messageRef, messageId) {
  try {
    const uid = window.netChatAuthUser?.uid;
    if (!uid) throw new Error("You must be signed in");
    await updateDoc(messageRef, { hiddenFor: arrayUnion(uid) });
    if (activeConversationId) {
      const convRef = doc(window.netChatDB, "chats", activeConversationId);
      const convSnap = await getDoc(convRef);
      if (convSnap.exists() && convSnap.data().lastMessageId === messageId) {
        await updateDoc(convRef, { [`hiddenLastMessageFor.${uid}`]: messageId });
      }
    }
    toast("Message deleted for you");
  } catch (error) {
    console.error("Delete for me failed:", error);
    toast("Could not delete for you. Check Firestore rules.");
  }
}

function showNxReactionBar(messageId, x, y) {
  if (!nxReactionBar) {
    nxReactionBar = document.createElement("div");
    nxReactionBar.style.cssText = "position:fixed;z-index:3500;display:none;background:#233138;border-radius:30px;padding:6px 10px;gap:2px;box-shadow:0 4px 14px rgba(0,0,0,.5);";
    ["👍", "❤️", "😂", "😮", "😢", "🙏", "👏"].forEach((emoji) => {
      const b = document.createElement("button");
      b.textContent = emoji;
      b.style.cssText = "background:none;border:none;font-size:23px;cursor:pointer;padding:4px;transition:transform .1s;";
      b.addEventListener("mouseenter", () => { b.style.transform = "scale(1.25)"; });
      b.addEventListener("mouseleave", () => { b.style.transform = "none"; });
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleMessageReaction(messageIdForReaction, emoji);
        hideNxReactionBar();
      });
      nxReactionBar.appendChild(b);
    });
    document.body.appendChild(nxReactionBar);
  }
  messageIdForReaction = messageId;
  const barWidth = 300;
  nxReactionBar.style.left = Math.min(window.innerWidth - barWidth - 10, Math.max(10, (x || window.innerWidth / 2) - barWidth / 2)) + "px";
  nxReactionBar.style.top = Math.max(70, (y || window.innerHeight / 2) - 70) + "px";
  nxReactionBar.style.display = "flex";
  setTimeout(() => document.addEventListener("click", nxReactionOutside, { once: true }), 20);
}

function nxReactionOutside(e) {
  if (nxReactionBar && nxReactionBar.contains(e.target)) {
    setTimeout(() => document.addEventListener("click", nxReactionOutside, { once: true }), 20);
  } else {
    hideNxReactionBar();
  }
}

function hideNxReactionBar() {
  if (nxReactionBar) nxReactionBar.style.display = "none";
  messageIdForReaction = null;
}

async function toggleMessageReaction(messageId, emoji) {
  if (!messageId || !emoji) return;
  const docs = window.currentChatSnapshotDocs || [];
  const messageDoc = docs.find((d) => d.id === messageId);
  if (!messageDoc) return;
  const myUid = window.netChatAuthUser.uid;
  try {
    if (messageDoc.data().reactions?.[myUid] === emoji) {
      await updateDoc(messageDoc.ref, { [`reactions.${myUid}`]: deleteField() });
    } else {
      await updateDoc(messageDoc.ref, { [`reactions.${myUid}`]: emoji });
    }
  } catch (error) {
    console.error("Reaction failed:", error);
  }
}

/* ---- chat dropdown tools (clear chat, search, media, etc.) ---- */
const moreMenuViewForGroup = document.getElementById("moreMenuView");
if (moreMenuViewForGroup && !document.getElementById("deleteGroupMenuItem")) {
  const groupDeleteItem = document.createElement("li");
  groupDeleteItem.className = "menu-item danger";
  groupDeleteItem.id = "deleteGroupMenuItem";
  groupDeleteItem.innerHTML = '<span class="material-symbols-outlined">delete_forever</span> Delete group for everyone';
  moreMenuViewForGroup.appendChild(groupDeleteItem);
}
document.getElementById("deleteGroupMenuItem")?.addEventListener("click", async () => {
  chatDropdown.classList.remove("active");
  resetMenuView();
  const uid = window.netChatAuthUser?.uid;
  if (!activeConversationId || !activeTargetUser?.isGroup || !uid) {
    toast("Open a group chat to use this action");
    return;
  }
  if (activeTargetUser.createdBy !== uid) {
    toast("Only the group creator can delete this group");
    return;
  }
  if (!confirm("Delete this group for everyone? The group will disappear from all participants' chat lists.")) return;
  try {
    await updateDoc(doc(window.netChatDB, "chats", activeConversationId), {
      groupDeleted: true,
      deletedAt: serverTimestamp()
    });
    if (messagesUnsubscribe) { messagesUnsubscribe(); messagesUnsubscribe = null; }
    activeConversationId = null;
    activeTargetUser = null;
    const chatScreen = document.getElementById("chatScreen");
    if (chatScreen) chatScreen.style.display = "none";
    toast("Group deleted for everyone");
  } catch (error) {
    console.error("Delete group failed:", error);
    toast("Could not delete group. Check the Firestore rules.");
  }
});
document.querySelectorAll("#chatDropdown .menu-item").forEach((item) => {
  const label = (item.textContent || "").replace(/\s+/g, " ").trim();

  if (label.startsWith("Clear chat")) {
    item.addEventListener("click", async () => {
      chatDropdown.classList.remove("active");
      resetMenuView();
      if (!activeConversationId || !window.netChatAuthUser) return;
      if (!confirm("Clear all messages from your view? Other participants will still see their messages.")) return;
      try {
        const uid = window.netChatAuthUser.uid;
        const messagesRef = collection(window.netChatDB, "chats", activeConversationId, "messages");
        const snap = await getDocs(messagesRef);
        const docs = snap.docs;
        for (let offset = 0; offset < docs.length; offset += 450) {
          const batch = writeBatch(window.netChatDB);
          docs.slice(offset, offset + 450).forEach((d) => batch.update(d.ref, { hiddenFor: arrayUnion(uid) }));
          await batch.commit();
        }
        await updateDoc(doc(window.netChatDB, "chats", activeConversationId), {
          [`clearedFor.${uid}`]: serverTimestamp(),
          [`unreadCount.${uid}`]: 0
        });
        if (messagesUnsubscribe) listenToConversationMessages(activeConversationId);
        toast("Chat cleared for you");
      } catch (error) {
        console.error("Clear chat failed:", error);
        toast("Could not clear chat. Check Firestore rules.");
      }
    });
  }

  if (label.startsWith("Search")) {
    item.addEventListener("click", () => {
      chatDropdown.classList.remove("active");
      resetMenuView();
      const term = prompt("Search messages in this chat:")?.trim().toLowerCase();
      if (!term) return;
      const match = (window.currentChatSnapshotDocs || []).find((d) => String(d.data().text || d.data().poll?.question || "").toLowerCase().includes(term));
      if (!match) return toast("No matching message found");
      const row = document.querySelector(`#chatMessagesBody [data-message-id="${CSS.escape(match.id)}"]`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.classList.add("reply-highlight");
      setTimeout(() => row?.classList.remove("reply-highlight"), 1800);
    });
  }

  if (label.startsWith("Media, links")) {
    item.addEventListener("click", () => {
      chatDropdown.classList.remove("active");
      resetMenuView();
      const docs = window.currentChatSnapshotDocs || [];
      const media = [];
      docs.forEach((d) => (d.data().media || []).forEach((m) => { if (m.url && (m.resourceType === "image" || m.resourceType === "video" || !m.resourceType)) media.push(m); }));
      if (!media.length) return toast("No media in this chat yet");
      openMediaFeed(media, activeTargetUser?.userFullname || "Media");
    });
  }

  if (label.startsWith("Mute notifications")) {
    item.addEventListener("click", async () => {
      chatDropdown.classList.remove("active"); resetMenuView();
      if (!activeConversationId || !window.netChatAuthUser) return toast("Open a chat first");
      const uid = window.netChatAuthUser.uid;
      const chatRef = doc(window.netChatDB, "chats", activeConversationId);
      const snap = await getDoc(chatRef).catch(() => null);
      const muted = !!snap?.data()?.mutedBy?.includes?.(uid);
      try {
        await updateDoc(chatRef, { mutedBy: muted ? (snap.data().mutedBy || []).filter(x => x !== uid) : [...(snap?.data()?.mutedBy || []), uid] });
        toast(muted ? "Notifications unmuted" : "Notifications muted for this chat");
      } catch (error) { toast("Could not save notification setting"); }
    });
  }
  if (label.startsWith("Disappearing messages")) {
    item.addEventListener("click", async () => {
      chatDropdown.classList.remove("active"); resetMenuView();
      if (!activeConversationId) return toast("Open a chat first");
      const choice = prompt("Disappearing messages: enter 0 to turn off, 3600 for 1 hour, 86400 for 24 hours, or 604800 for 7 days.", "86400");
      if (choice === null) return;
      const seconds = Number(choice);
      if (![0, 3600, 86400, 604800].includes(seconds)) return toast("Choose 0, 3600, 86400, or 604800 seconds");
      try { await updateDoc(doc(window.netChatDB, "chats", activeConversationId), { disappearingSeconds: seconds }); toast(seconds ? `Disappearing messages set to ${seconds/3600} hour(s) for new messages` : "Disappearing messages turned off"); }
      catch (error) { console.error(error); toast("Could not save disappearing-message setting"); }
    });
  }
  // Per-conversation Chat Theme system
  const CHAT_THEMES = [
    { id:"ocean", name:"Ocean Glow", style:"Deep indigo", wall:"#071923", pattern:"radial-gradient(rgba(0,229,255,.10) 1px,transparent 1px)", incoming:"rgba(17,43,55,.88)", out1:"#4338CA", out2:"#6366F1", border:"rgba(129,140,248,.38)", shape:"round", fx:"" },
    { id:"sunset", name:"Sunset", style:"Pink + orange", wall:"#211018", pattern:"radial-gradient(rgba(255,125,170,.11) 1px,transparent 1px)", incoming:"rgba(64,31,49,.90)", out1:"#ff5f8f", out2:"#ff8a3d", border:"rgba(255,120,150,.30)", shape:"round", fx:"" },
    { id:"aurora", name:"Aurora", style:"Purple + mint", wall:"#100d24", pattern:"radial-gradient(rgba(157,78,221,.13) 1px,transparent 1px)", incoming:"rgba(39,30,67,.90)", out1:"#9d4edd", out2:"#2dd4bf", border:"rgba(157,78,221,.32)", shape:"pill", fx:"neon" },
    { id:"forest", name:"Forest", style:"Emerald calm", wall:"#081b16", pattern:"radial-gradient(rgba(52,211,153,.10) 1px,transparent 1px)", incoming:"rgba(19,55,43,.90)", out1:"#10b981", out2:"#047857", border:"rgba(52,211,153,.30)", shape:"round", fx:"" },
    { id:"rose", name:"Rose", style:"Soft pink", wall:"#211016", pattern:"radial-gradient(rgba(244,114,182,.10) 1px,transparent 1px)", incoming:"rgba(65,31,48,.90)", out1:"#f472b6", out2:"#db2777", border:"rgba(244,114,182,.28)", shape:"pill", fx:"" },
    { id:"gold", name:"Golden Hour", style:"Amber warmth", wall:"#21190a", pattern:"radial-gradient(rgba(251,191,36,.11) 1px,transparent 1px)", incoming:"rgba(62,48,20,.92)", out1:"#fbbf24", out2:"#d97706", border:"rgba(251,191,36,.30)", shape:"round", fx:"" },
    { id:"ice", name:"Ice", style:"Clean blue", wall:"#081722", pattern:"radial-gradient(rgba(125,211,252,.12) 1px,transparent 1px)", incoming:"rgba(25,48,64,.92)", out1:"#38bdf8", out2:"#2563eb", border:"rgba(125,211,252,.28)", shape:"sharp", fx:"glass" },
    { id:"lavender", name:"Lavender", style:"Dreamy violet", wall:"#171022", pattern:"radial-gradient(rgba(196,181,253,.10) 1px,transparent 1px)", incoming:"rgba(49,35,72,.90)", out1:"#c084fc", out2:"#7c3aed", border:"rgba(196,181,253,.28)", shape:"pill", fx:"glass" },
    { id:"cherry", name:"Cherry", style:"Bold red", wall:"#200a0f", pattern:"radial-gradient(rgba(248,113,113,.10) 1px,transparent 1px)", incoming:"rgba(67,27,34,.90)", out1:"#ef4444", out2:"#be123c", border:"rgba(248,113,113,.28)", shape:"sharp", fx:"neon" },
    { id:"midnight", name:"Midnight", style:"Deep neon", wall:"#050912", pattern:"radial-gradient(rgba(0,240,255,.07) 1px,transparent 1px)", incoming:"rgba(20,28,44,.94)", out1:"#00f0ff", out2:"#2563eb", border:"rgba(0,240,255,.32)", shape:"sharp", fx:"neon" },
    { id:"glass", name:"Crystal Glass", style:"Frosted bubbles", wall:"#0d1420", pattern:"linear-gradient(135deg,rgba(255,255,255,.04) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.04) 50%,rgba(255,255,255,.04) 75%,transparent 75%)", incoming:"rgba(255,255,255,.08)", out1:"rgba(0,229,255,.78)", out2:"rgba(124,58,237,.78)", border:"rgba(255,255,255,.20)", shape:"round", fx:"glass" },
    { id:"paper", name:"Paper", style:"Warm minimal", wall:"#1b1915", pattern:"linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px)", incoming:"rgba(66,61,52,.92)", out1:"#d97706", out2:"#b45309", border:"rgba(251,191,36,.22)", shape:"sharp", fx:"paper" }
  ];

  const chatThemeStore = {
    key(conversationId) { return `netchat:chat-theme:${conversationId}`; },
    get(conversationId) { try { return localStorage.getItem(this.key(conversationId)) || "ocean"; } catch { return "ocean"; } },
    set(conversationId, themeId) { try { localStorage.setItem(this.key(conversationId), themeId); } catch {} }
  };
  function getChatTheme(id) { return CHAT_THEMES.find(t => t.id === id) || CHAT_THEMES[0]; }
  function applyChatTheme(conversationId, themeId = chatThemeStore.get(conversationId)) {
    const body = document.getElementById("chatMessagesBody");
    if (!body) return;
    const t = getChatTheme(themeId);
    body.classList.add("nc-chat-themed");
    [...body.classList].filter(c => /^theme-(round|sharp|pill|glass|neon|paper)$/.test(c)).forEach(c => body.classList.remove(c));
    body.classList.add(`theme-${t.shape}`); if (t.fx) body.classList.add(`theme-${t.fx}`);
    body.style.setProperty("--theme-wall", t.wall); body.style.setProperty("--theme-pattern", t.pattern);
    body.style.setProperty("--theme-in", t.incoming); body.style.setProperty("--theme-out1", t.out1); body.style.setProperty("--theme-out2", t.out2); body.style.setProperty("--theme-border", t.border);
  }
  function openChatThemePicker() {
    const modal = document.getElementById("chatThemeModal");
    const grid = document.getElementById("chatThemeGrid");
    if (!modal || !grid || !activeConversationId) return toast("Open a chat first");
    const current = chatThemeStore.get(activeConversationId);
    grid.innerHTML = CHAT_THEMES.map(t => `<button type="button" class="nc-theme-card ${t.id === current ? "active" : ""}" data-chat-theme="${t.id}"><div class="nc-theme-thumb" style="--thumb-wall:${t.wall};--thumb-pattern:${t.pattern};--thumb-in:${t.incoming};--thumb-out1:${t.out1};--thumb-out2:${t.out2};"><i></i><i></i><i></i><span class="nc-theme-check"><span class="material-symbols-outlined">check</span></span></div><span class="nc-theme-name">${escapeHTML(t.name)}</span><span class="nc-theme-style">${escapeHTML(t.style)}</span></button>`).join("");
    const preview = document.getElementById("chatThemePreview");
    const paintPreview = (id) => { const t = getChatTheme(id); preview.style.setProperty("--theme-wall",t.wall); preview.style.setProperty("--theme-pattern",t.pattern); preview.style.setProperty("--theme-in",t.incoming); preview.style.setProperty("--theme-out1",t.out1); preview.style.setProperty("--theme-out2",t.out2); preview.style.setProperty("--theme-border",t.border); preview.className=`nc-theme-preview theme-${t.shape} ${t.fx ? `theme-${t.fx}` : ""}`; };
    paintPreview(current);
    grid.querySelectorAll("[data-chat-theme]").forEach(card => card.addEventListener("click", () => {
      const id = card.dataset.chatTheme; chatThemeStore.set(activeConversationId, id); applyChatTheme(activeConversationId, id); grid.querySelectorAll(".nc-theme-card").forEach(c => c.classList.toggle("active", c === card)); paintPreview(id); toast(`${getChatTheme(id).name} applied to this chat`);
    }));
    document.getElementById("resetChatThemeBtn")?.addEventListener("click", () => { chatThemeStore.set(activeConversationId, "ocean"); applyChatTheme(activeConversationId, "ocean"); openChatThemePicker(); });
    modal.hidden = false; modal.setAttribute("aria-hidden", "false");
  }
  function closeChatThemePicker() { const modal = document.getElementById("chatThemeModal"); if (!modal) return; modal.hidden = true; modal.setAttribute("aria-hidden","true"); }
  document.addEventListener("click", e => { if (e.target.closest("[data-close-chat-theme]")) closeChatThemePicker(); if (e.target.closest("#chatThemeModal .nc-theme-close")) closeChatThemePicker(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeChatThemePicker(); });
  window.netChatOpenChatThemePicker = openChatThemePicker;

  if (label.startsWith("Chat theme")) {
    item.addEventListener("click", () => {
      chatDropdown.classList.remove("active");
      resetMenuView();
      window.netChatOpenChatThemePicker?.();
    });
  }
  if (label.startsWith("New group")) {
    item.addEventListener("click", () => { chatDropdown.classList.remove("active"); resetMenuView(); window.netChatOpenFeature?.("newGroup"); });
  }
  if (label.startsWith("Report")) {
    item.addEventListener("click", async () => {
      chatDropdown.classList.remove("active"); resetMenuView();
      const user = window.netChatAuthUser;
      if (!user || !activeTargetUser?.uid) return toast("Open a chat before reporting");
      const reason = prompt(activeTargetUser.isGroup ? "Why are you reporting this group? (Optional)" : "Why are you reporting this contact? (Optional)", "Spam or abuse");
      if (reason === null) return;
      try { await addDoc(collection(window.netChatDB, "user", user.uid, "reports"), { targetUid: activeTargetUser.uid, targetType: activeTargetUser.isGroup ? "group" : "user", targetName: activeTargetUser.userFullname || "NetChat User", reason, conversationId: activeConversationId || null, createdAt: serverTimestamp(), status: "submitted" }); toast("Report submitted"); }
      catch (error) { console.error(error); toast("Could not submit report. Check Firestore rules."); }
    });
  }
  if (label.startsWith("Block")) {
    item.addEventListener("click", async () => {
      chatDropdown.classList.remove("active"); resetMenuView();
      const user = window.netChatAuthUser;
      if (!user || !activeTargetUser?.uid || activeTargetUser.isGroup) return toast("Open an individual contact chat first");
      const shouldBlock = confirm(`Block ${activeTargetUser.userFullname || "this contact"}? You can manage blocked users in Settings → Privacy.`);
      if (!shouldBlock) return;
      try { await setDoc(doc(window.netChatDB, "user", user.uid, "blockedUsers", activeTargetUser.uid), { uid: activeTargetUser.uid, userFullname: activeTargetUser.userFullname || "NetChat User", profileImage: activeTargetUser.profileImage || "", blockedAt: serverTimestamp() }); toast("Contact blocked"); }
      catch (error) { console.error(error); toast("Could not block contact. Check Firestore rules."); }
    });
  }
  if (label.startsWith("Export chat")) {
    item.addEventListener("click", async () => {
      chatDropdown.classList.remove("active"); resetMenuView();
      if (!activeConversationId) return toast("Open a chat first");
      try {
        const snap = await getDocs(query(collection(window.netChatDB, "chats", activeConversationId, "messages"), orderBy("timestamp", "asc")));
        const payload = snap.docs.map(d => ({ id: d.id, ...d.data(), timestamp: d.data().timestamp?.toDate?.().toISOString?.() || null }));
        const blob = new Blob([JSON.stringify({ conversationId: activeConversationId, exportedAt: new Date().toISOString(), messages: payload }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `netchat-${activeConversationId}-export.json`; a.click(); URL.revokeObjectURL(url); toast("Chat export downloaded");
      } catch (error) { console.error(error); toast("Could not export chat"); }
    });
  }
  if (label.startsWith("Add shortcut")) {
    item.addEventListener("click", () => { chatDropdown.classList.remove("active"); resetMenuView(); toast("Use your browser menu → Add to Home screen. NetChat cannot install a shortcut without the browser prompt."); });
  }
  if (label.startsWith("Add to list")) {
    item.addEventListener("click", async () => {
      chatDropdown.classList.remove("active"); resetMenuView();
      if (!activeConversationId || !window.netChatAuthUser) return;
      try {
        const uid = window.netChatAuthUser.uid;
        const chatRef = doc(window.netChatDB, "chats", activeConversationId);
        const snap = await getDoc(chatRef);
        const next = snap.data()?.favorites?.[uid] !== true;
        await updateDoc(chatRef, { [`favorites.${uid}`]: next });
        toast(next ? "Added to favourites" : "Removed from favourites");
      } catch (error) { console.error(error); toast("Could not update favourites"); }
    });
  }
});

/* ---- mark all as read (used by the ⋮ quick menu) ---- */
async function netChatMarkAllRead() {
  try {
    const uid = window.netChatAuthUser.uid;
    const q = query(collection(window.netChatDB, "chats"), where("participants", "array-contains", uid));
    const snap = await getDocs(q);
    snap.docs.forEach((chatDoc) => {
      if ((chatDoc.data().unreadCount?.[uid] || 0) > 0) {
        updateDoc(chatDoc.ref, { [`unreadCount.${uid}`]: 0 });
      }
    });
    document.querySelectorAll("#chatList .badge").forEach((b) => b.remove());
    toast("All chats marked as read");
  } catch (error) {
    console.error("Mark all read failed:", error);
    toast("Could not update chats");
  }
}
window.netChatMarkAllRead = netChatMarkAllRead;

/* ---- chat list live search ---- */
document.getElementById("firstSearchBar")?.addEventListener("input", (event) => {
  chatSearchTerm = (event.target.value || "").trim().toLowerCase();
  applyChatListFilters();
});

/* ---- voice call button in chat header ---- */
document.getElementById("startVoiceCallBtn")?.addEventListener("click", () => startVideoCall(false));

/* ---- header camera → status composer ---- */
document.querySelector(".header-actions .icon-btn")?.addEventListener("click", () => openComposer("image"));

/* ---- copy NetChat ID from profile modal ---- */
document.querySelector("#userProfileModal .copy-icon")?.addEventListener("click", async () => {
  const id = document.getElementById("modalNetchatId")?.textContent || "";
  if (!id) return;
  try { await navigator.clipboard.writeText(id); toast("NetChat ID copied ✦"); } catch { toast(id); }
});

/* ---- lightbox reply input actually sends the message ---- */
document.getElementById("lightboxReplyInput")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const text = event.target.value.trim();
  if (!text || !messageInput) return;
  event.target.value = "";
  document.getElementById("mediaLightboxModal").hidden = true;
  messageInput.value = text;
  sendMsgBtn?.click();
});

/* ---- media-feed reaction buttons now write to Firestore ---- */
document.querySelectorAll("#mediaReactionPopup .reaction-emoji").forEach((btn) => {
  btn.addEventListener("click", () => {
    toggleMessageReaction(currentFeedMessageId || currentActionMessageId, btn.dataset.emoji);
    hideReactionPopup();
  });
});
const moreReactionsBtn = document.getElementById("moreReactionsBtn");
if (moreReactionsBtn) moreReactionsBtn.addEventListener("click", () => {
  const messageId = currentFeedMessageId || currentActionMessageId;
  if (!messageId) return toast("Open a message first");
  const emoji = prompt("Enter a reaction emoji (for example 🔥, 🎉, 😍, 👏):", "🔥");
  if (!emoji || !emoji.trim()) return;
  toggleMessageReaction(messageId, emoji.trim().slice(0, 8));
  hideReactionPopup();
});

/* ---- Esc closes message action sheet / reaction bar ---- */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeMessageActions(); hideNxReactionBar(); }
});


/* ============================================================
   NETCHAT FEATURE SCREENS — Communities, Calls, Achievements,
   New Group, Broadcast, Starred Messages and Linked Devices.
   Data is stored per signed-in user where supported by current rules.
   ============================================================ */
(() => {
  const safe = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let featureRoot, featureBody, featureTitle, activeFeature = "";
  const localKey = (suffix) => `netchat:${window.netChatAuthUser?.uid || "guest"}:${suffix}`;
  const localRead = (key, fallback=[]) => { try { return JSON.parse(localStorage.getItem(localKey(key)) || JSON.stringify(fallback)); } catch { return fallback; } };
  const localWrite = (key, value) => { try { localStorage.setItem(localKey(key), JSON.stringify(value)); } catch {} };
  function ensureRoot() {
    if (featureRoot) return;
    featureRoot = document.createElement("section");
    featureRoot.id = "netChatFeatureScreen";
    featureRoot.className = "nc-feature-screen";
    featureRoot.innerHTML = `<header class="nc-feature-head"><button type="button" class="nc-back" aria-label="Back"><span class="material-symbols-outlined">arrow_back</span></button><div><h2 id="ncFeatureTitle">NetChat</h2><p id="ncFeatureSubtitle">Your space</p></div><button type="button" class="nc-refresh" aria-label="Refresh"><span class="material-symbols-outlined">refresh</span></button></header><div class="nc-feature-body" id="ncFeatureBody"></div><div class="nc-feature-toast" id="ncFeatureToast" role="status"></div>`;
    document.querySelector(".main-app")?.appendChild(featureRoot);
    featureBody = featureRoot.querySelector("#ncFeatureBody");
    featureTitle = featureRoot.querySelector("#ncFeatureTitle");
    featureRoot.querySelector(".nc-back").addEventListener("click", closeFeature);
    featureRoot.querySelector(".nc-refresh").addEventListener("click", () => renderFeature(activeFeature));
  }
  function featureToast(message) {
    ensureRoot(); const el = featureRoot.querySelector("#ncFeatureToast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2600);
  }
  function closeFeature() {
    featureRoot?.classList.remove("open"); activeFeature = "";
    const chatListEl = document.getElementById("chatList");
    const updatesEl = document.getElementById("updatesScreen");
    if (chatListEl) chatListEl.style.display = "";
    if (updatesEl) updatesEl.style.display = "none";
    document.querySelectorAll(".bottom-nav .nav-item").forEach(n => n.classList.toggle("active", n.id === "chatsNavBtn"));
  }
  function openFeature(id) { ensureRoot(); activeFeature = id; featureRoot.classList.add("open"); renderFeature(id); }
  window.netChatOpenFeature = openFeature;
  window.netChatCloseFeature = closeFeature;
  window.netChatTrackAchievementEvent = async (kind) => {
    const user = window.netChatAuthUser;
    if (!user || !window.netChatDB) return;
    try {
      await setDoc(doc(window.netChatDB, "user", user.uid, "appStats", "progress"), { [kind]: increment(1), updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) { const stats = localRead("stats", {}); stats[kind] = (stats[kind] || 0) + 1; localWrite("stats", stats); }
  };
  const icon = (name) => `<span class="material-symbols-outlined">${name}</span>`;
  const empty = (title, text, action="") => `<div class="nc-empty">${icon("inbox")}<h3>${title}</h3><p>${text}</p>${action}</div>`;
  async function userAndDb() {
    try { await window.netChatUserReady; } catch {}
    const user = window.netChatAuthUser;
    if (!user || !window.netChatDB) throw new Error("Please sign in to use this feature.");
    return { user, db: window.netChatDB };
  }
  async function renderFeature(id) {
    ensureRoot(); activeFeature = id;
    const titles = { communities:"Communities", calls:"Calls", achievements:"Achievements", newGroup:"Create a group", broadcast:"Broadcast", starred:"Starred messages", linkedDevices:"Linked devices", archived:"Archived chats", blocked:"Blocked users" };
    featureTitle.textContent = titles[id] || "NetChat";
    featureRoot.querySelector("#ncFeatureSubtitle").textContent = id === "achievements" ? "Your progress, saved to your account" : "Connected to your NetChat account";
    featureBody.innerHTML = `<div class="nc-loading">${icon("progress_activity")} Loading…</div>`;
    try {
      if (id === "communities") return await renderCommunities();
      if (id === "calls") return await renderCalls();
      if (id === "achievements") return await renderAchievements();
      if (id === "newGroup") return await renderNewGroup();
      if (id === "broadcast") return await renderBroadcast();
      if (id === "starred") return await renderStarred();
      if (id === "linkedDevices") return renderLinkedDevices();
      if (id === "archived") return await renderArchived();
      if (id === "blocked") return await renderBlocked();
      featureBody.innerHTML = empty("Feature unavailable", "This section has no connected implementation in the supplied project.");
    } catch (error) {
      console.error(`NetChat ${id} screen failed:`, error);
      featureBody.innerHTML = `<div class="nc-error">${icon("cloud_off")}<h3>Could not load this screen</h3><p>${safe(error.message || "Check your connection and Firebase permissions.")}</p><button class="nc-btn" data-retry>Try again</button></div>`;
      featureBody.querySelector("[data-retry]")?.addEventListener("click", () => renderFeature(id));
    }
  }
  async function renderCommunities() {
    const {user,db}=await userAndDb();
    const uid=user.uid;
    let mine=[], publicList=[], invitations=[];
    // One-time migration for communities created by the older account-private implementation.
    try {
      const legacySnap=await getDocs(collection(db,"user",uid,"communities"));
      for(const oldDoc of legacySnap.docs){
        const old=oldDoc.data(); const sharedRef=doc(db,"communities",oldDoc.id); const existing=await getDoc(sharedRef);
        if(existing.exists()) continue;
        const batch=writeBatch(db);
        batch.set(sharedRef,{name:String(old.name||"Community").slice(0,60),description:String(old.description||"").slice(0,240),visibility:"private",ownerId:uid,createdAt:old.createdAt||serverTimestamp(),deleted:false,migratedFromLegacy:true});
        batch.set(doc(db,"communities",oldDoc.id,"members",uid),{uid,role:"owner",joinedAt:serverTimestamp()});
        batch.set(doc(db,"user",uid,"communityMemberships",oldDoc.id),{communityId:oldDoc.id,role:"owner",joinedAt:serverTimestamp()});
        batch.delete(oldDoc.ref); await batch.commit();
      }
    } catch(e) { console.warn("Legacy community migration skipped; old records were left untouched",e); }
    try {
      const mineSnap=await getDocs(collection(db,"user",uid,"communityMemberships"));
      const ids=mineSnap.docs.map(d=>({id:d.id,...d.data()}));
      mine=await Promise.all(ids.map(async m=>{try{const snap=await getDoc(doc(db,"communities",m.id));return snap.exists()?{id:snap.id,...snap.data(),membershipRole:m.role||"member"}:null;}catch(e){return null;}}));
      mine=mine.filter(c=>c&&!c.deleted);
    } catch(e) { console.warn("Community memberships could not be loaded",e); }
    try {
      const snap=await getDocs(query(collection(db,"communities"),where("visibility","==","public"),where("deleted","==",false)));
      publicList=snap.docs.map(d=>({id:d.id,...d.data()})).filter(c=>!c.deleted&&!mine.some(m=>m.id===c.id));
    } catch(e) { console.warn("Public community directory could not be loaded",e); }
    try {
      const snap=await getDocs(collection(db,"user",uid,"communityInvites"));
      invitations=await Promise.all(snap.docs.map(async d=>{try{const c=await getDoc(doc(db,"communities",d.id));return c.exists()?{id:c.id,...c.data(),inviteData:d.data()}:null;}catch(e){return null;}}));
      invitations=invitations.filter(c=>c&&!c.deleted);
    } catch(e) { console.warn("Community invitations could not be loaded",e); }

    const card=(c,mode)=>`<article class="nc-list-card"><div class="nc-avatar">${icon("groups")}</div><div class="nc-list-copy"><b>${safe(c.name||"Community")}</b><p>${safe(c.description||"No description yet")}</p><small>${c.visibility==="public"?"Public":"Private"} · ${safe(c.ownerId===uid?"Owner":(c.membershipRole||"Member"))}</small><div class="nc-community-actions">${mode==="mine"?`<button class="nc-btn secondary" data-community-open="${safe(c.id)}">Open</button><button class="nc-btn secondary" data-community-group="${safe(c.id)}">Create group</button>${c.ownerId===uid?`<button class="nc-btn secondary" data-community-invite="${safe(c.id)}">Invite by UID</button><button class="nc-btn danger" data-community-delete="${safe(c.id)}">Delete</button>`:""}`:mode==="public"?`<button class="nc-btn" data-community-join="${safe(c.id)}">Join community</button>`:`<button class="nc-btn" data-community-accept="${safe(c.id)}">Accept invitation</button><button class="nc-btn secondary" data-community-decline="${safe(c.id)}">Decline</button>`}</div></div></article>`;

    featureBody.innerHTML=`<div class="nc-hero"><div class="nc-hero-icon">${icon("groups_3")}</div><div><h3>Communities</h3><p>Create public or private spaces, discover public communities, invite members, and create group chats inside a community.</p></div></div>
      <form id="ncCommunityForm" class="nc-form"><label>Community name<input name="name" maxlength="60" required placeholder="e.g. School Friends"></label><label>Description<textarea name="description" maxlength="240" placeholder="What is this community about?"></textarea></label><label>Who can find it?<select name="visibility"><option value="private">Private — invite only</option><option value="public">Public — listed for discovery</option></select></label><button class="nc-btn" type="submit">${icon("add_circle")} Create community</button></form>
      <h3 class="nc-section-title">Your communities <span>${mine.length}</span></h3><div class="nc-list">${mine.length?mine.map(c=>card(c,"mine")).join(""):empty("No communities yet","Create one above or join a public community below.")}</div>
      <h3 class="nc-section-title">Invitations <span>${invitations.length}</span></h3><div class="nc-list">${invitations.length?invitations.map(c=>card(c,"invite")).join(""):empty("No invitations","Private community invitations sent to your account appear here.")}</div>
      <h3 class="nc-section-title">Discover public communities <span>${publicList.length}</span></h3><div class="nc-list">${publicList.length?publicList.map(c=>card(c,"public")).join(""):empty("No public communities found","Create a public community or check back later.")}</div>
      <p class="nc-note">Public communities can be discovered and joined. Private communities stay out of the directory and require an invitation. Community group chats use your existing Chats list and message system.</p>`;

    featureBody.querySelector("#ncCommunityForm").addEventListener("submit",async e=>{
      e.preventDefault(); const fd=new FormData(e.currentTarget); const name=String(fd.get("name")||"").trim(); const description=String(fd.get("description")||"").trim(); const visibility=String(fd.get("visibility")||"private"); if(!name)return;
      try {
        const communityRef=doc(collection(db,"communities")); const batch=writeBatch(db);
        batch.set(communityRef,{name,description,visibility,ownerId:uid,createdAt:serverTimestamp(),deleted:false});
        batch.set(doc(db,"communities",communityRef.id,"members",uid),{uid,role:"owner",joinedAt:serverTimestamp()});
        batch.set(doc(db,"user",uid,"communityMemberships",communityRef.id),{communityId:communityRef.id,role:"owner",joinedAt:serverTimestamp()});
        await batch.commit(); await window.netChatTrackAchievementEvent?.("community"); featureToast("Community created"); await renderCommunities();
      } catch(err) { console.error("Create community failed",err); featureToast("Could not create community. Check that the updated Firestore rules are published."); }
    });

    featureBody.querySelectorAll("[data-community-join]").forEach(btn=>btn.addEventListener("click",async()=>{
      const id=btn.dataset.communityJoin; try{const cRef=doc(db,"communities",id);const snap=await getDoc(cRef);if(!snap.exists()||snap.data().visibility!=="public"||snap.data().deleted)throw new Error("This community is not available to join.");const batch=writeBatch(db);batch.set(doc(db,"communities",id,"members",uid),{uid,role:"member",joinedAt:serverTimestamp()});batch.set(doc(db,"user",uid,"communityMemberships",id),{communityId:id,role:"member",joinedAt:serverTimestamp()});await batch.commit();featureToast("Joined community");await renderCommunities();}catch(err){console.error("Join community failed",err);featureToast(err.message||"Could not join community. Check Firestore rules.");}
    }));

    featureBody.querySelectorAll("[data-community-invite]").forEach(btn=>btn.addEventListener("click",async()=>{
      const id=btn.dataset.communityInvite; const targetUid=prompt("Enter the invitee's exact NetChat user UID:"); if(!targetUid||!targetUid.trim()||targetUid.trim()===uid)return; const invitee=targetUid.trim();
      try{const cSnap=await getDoc(doc(db,"communities",id));if(!cSnap.exists()||cSnap.data().ownerId!==uid)throw new Error("Only the owner can invite members.");const batch=writeBatch(db);batch.set(doc(db,"communities",id,"invites",invitee),{inviteeUid:invitee,invitedBy:uid,createdAt:serverTimestamp()});batch.set(doc(db,"user",invitee,"communityInvites",id),{communityId:id,invitedBy:uid,createdAt:serverTimestamp()});await batch.commit();featureToast("Invitation sent to that UID");}catch(err){console.error("Invite failed",err);featureToast("Could not send invitation. Check the UID and Firestore rules.");}
    }));

    featureBody.querySelectorAll("[data-community-accept]").forEach(btn=>btn.addEventListener("click",async()=>{
      const id=btn.dataset.communityAccept; try{const cSnap=await getDoc(doc(db,"communities",id));if(!cSnap.exists()||cSnap.data().deleted)throw new Error("Community not available.");const batch=writeBatch(db);batch.set(doc(db,"communities",id,"members",uid),{uid,role:"member",joinedAt:serverTimestamp()});batch.set(doc(db,"user",uid,"communityMemberships",id),{communityId:id,role:"member",joinedAt:serverTimestamp()});batch.delete(doc(db,"communities",id,"invites",uid));batch.delete(doc(db,"user",uid,"communityInvites",id));await batch.commit();featureToast("Invitation accepted");await renderCommunities();}catch(err){console.error("Accept invite failed",err);featureToast("Could not accept invitation. Check Firestore rules.");}
    }));
    featureBody.querySelectorAll("[data-community-decline]").forEach(btn=>btn.addEventListener("click",async()=>{const id=btn.dataset.communityDecline;try{const batch=writeBatch(db);batch.delete(doc(db,"communities",id,"invites",uid));batch.delete(doc(db,"user",uid,"communityInvites",id));await batch.commit();featureToast("Invitation declined");await renderCommunities();}catch(err){console.error(err);featureToast("Could not decline invitation.");}}));

    featureBody.querySelectorAll("[data-community-open]").forEach(btn=>btn.addEventListener("click",async()=>{
      const id=btn.dataset.communityOpen; const c=mine.find(x=>x.id===id); if(!c)return; let members=[],groups=[];try{const s=await getDocs(collection(db,"communities",id,"members"));members=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){}try{const s=await getDocs(collection(db,"communities",id,"groups"));groups=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){}
      featureBody.innerHTML=`<button class="nc-btn secondary" id="ncCommunityBack">← Back to communities</button><div class="nc-hero"><div class="nc-hero-icon">${icon("groups_3")}</div><div><h3>${safe(c.name)}</h3><p>${safe(c.description||"Community space")} · ${c.visibility==="public"?"Public":"Private"}</p></div></div><h3 class="nc-section-title">Members <span>${members.length}</span></h3><div class="nc-list">${members.length?members.map(m=>`<article class="nc-list-card"><div class="nc-avatar">${icon("person")}</div><div class="nc-list-copy"><b>${safe(m.uid===uid?"You":m.uid)}</b><small>${safe(m.role||"Member")}</small></div></article>`).join(""):empty("No members loaded","Check membership permissions.")}</div><h3 class="nc-section-title">Groups in this community <span>${groups.length}</span></h3><div class="nc-list">${groups.length?groups.map(g=>`<article class="nc-list-card"><div class="nc-avatar">${icon("forum")}</div><div class="nc-list-copy"><b>${safe(g.name||"Group chat")}</b><p>${safe(g.chatId||g.id)}</p></div><button class="nc-btn secondary" data-open-community-chat="${safe(g.chatId||g.id)}">Open chat</button></article>`).join(""):empty("No groups yet","Create a group from this community's card.")}</div>`;
      featureBody.querySelector("#ncCommunityBack")?.addEventListener("click",renderCommunities);featureBody.querySelectorAll("[data-open-community-chat]").forEach(b=>b.addEventListener("click",()=>{const chatId=b.dataset.openCommunityChat;closeFeature();document.getElementById("chatsNavBtn")?.click();const card=[...document.querySelectorAll(".chat-card[data-conversation-id]")].find(el=>el.dataset.conversationId===chatId);if(card)card.click();else featureToast("Group created. If it is not visible yet, refresh Chats and try again.");}));
    }));

    featureBody.querySelectorAll("[data-community-group]").forEach(btn=>btn.addEventListener("click",async()=>{
      const id=btn.dataset.communityGroup; const c=mine.find(x=>x.id===id); if(!c)return; const name=prompt("Name for the new group chat inside "+c.name+":",c.name+" group");if(!name||!name.trim())return;
      try{const membersSnap=await getDocs(collection(db,"communities",id,"members"));const participants=[...new Set(membersSnap.docs.map(d=>d.id))];if(!participants.includes(uid))throw new Error("You are not a member of this community.");if(participants.length<2)throw new Error("Invite at least one other member before creating a group chat.");if(participants.length>100)throw new Error("This group currently supports up to 100 community members.");const chatRef=doc(collection(db,"chats"));const batch=writeBatch(db);batch.set(chatRef,{isGroup:true,type:"group",groupName:name.trim(),createdBy:uid,createdAt:serverTimestamp(),participants,communityId:id,communityName:c.name,unreadCount:Object.fromEntries(participants.map(x=>[x,0])),lastMessage:"Community group created",lastMessageSenderId:uid,lastMessageAt:serverTimestamp(),lastMessageStatus:"sent"});batch.set(doc(db,"communities",id,"groups",chatRef.id),{chatId:chatRef.id,name:name.trim(),createdBy:uid,createdAt:serverTimestamp()});await batch.commit();await window.netChatTrackAchievementEvent?.("group");featureToast("Community group created. Find it in Chats → Groups.");}catch(err){console.error("Create community group failed",err);featureToast(err.message||"Could not create group. Check Firestore rules.");}
    }));

    featureBody.querySelectorAll("[data-community-delete]").forEach(btn=>btn.addEventListener("click",async()=>{const id=btn.dataset.communityDelete;if(!confirm("Delete this community? It will be marked deleted and hidden from the directory."))return;try{await updateDoc(doc(db,"communities",id),{deleted:true,deletedAt:serverTimestamp()});featureToast("Community deleted");await renderCommunities();}catch(err){console.error(err);featureToast("Could not delete community. Only its owner can delete it.");}}));
  }
  async function renderCalls() {
    const {user,db}=await userAndDb(); let records=[];
    try {
      const [outgoing,incoming]=await Promise.all([getDocs(query(collection(db,"calls"),where("offer.callerId","==",user.uid))),getDocs(query(collection(db,"calls"),where("offer.receiverId","==",user.uid)))]);
      const map=new Map(); [...outgoing.docs,...incoming.docs].forEach(d=>map.set(d.id,{id:d.id,...d.data()})); records=[...map.values()].sort((a,b)=>((b.offer?.createdAt?.toMillis?.()||0)-(a.offer?.createdAt?.toMillis?.()||0)));
    } catch(e) { records=localRead("calls",[]); }
    featureBody.innerHTML=`<div class="nc-hero"><div class="nc-hero-icon">${icon("call")}</div><div><h3>Your call history</h3><p>Calls placed and received on this account.</p></div></div><div class="nc-list">${records.length?records.map(c=>{const offer=c.offer||{}; const outgoing=offer.callerId===user.uid; const peer=outgoing?offer.receiverId:offer.callerId; const date=offer.createdAt?.toDate?offer.createdAt.toDate().toLocaleString():"Date unavailable"; const state=c.status||"unknown"; return `<article class="nc-list-card"><div class="nc-avatar">${icon(outgoing?"call_made":"call_received")}</div><div class="nc-list-copy"><b>${outgoing?"Outgoing call":"Incoming call"}</b><p>${safe(peer||"Unknown contact")}</p><small>${safe(date)} · ${safe(state)}</small></div><span class="nc-status ${state==="ended"?"good":""}">${safe(state)}</span></article>`}).join(""):empty("No calls yet","Your completed and missed calls will appear here.",`<button class="nc-btn" data-go-chats>Go to chats</button>`)}</div><p class="nc-note">Call history is read from the calls collection. If it stays empty despite calls, check Firestore read rules for that collection.</p>`;
    featureBody.querySelector("[data-go-chats]")?.addEventListener("click",()=>{closeFeature();document.getElementById("chatsNavBtn")?.click();});
  }
  async function renderAchievements() {
    const {user,db}=await userAndDb(); let stats=localRead("stats",{});
    try { const snap=await getDoc(doc(db,"user",user.uid,"appStats","progress")); if(snap.exists()) stats={...stats,...snap.data()}; } catch(e) {}
    const achievements=[
      {id:"first-message",name:"First Hello",desc:"Send your first message",icon:"waving_hand",key:"message",goal:1},
      {id:"chatter-10",name:"Conversation Starter",desc:"Send 10 messages",icon:"forum",key:"message",goal:10},
      {id:"chatter-100",name:"Chat Champion",desc:"Send 100 messages",icon:"military_tech",key:"message",goal:100},
      {id:"status-1",name:"On the Story",desc:"Post your first status update",icon:"add_a_photo",key:"status",goal:1},
      {id:"status-10",name:"Storyteller",desc:"Post 10 status updates",icon:"auto_stories",key:"status",goal:10},
      {id:"group-1",name:"Team Builder",desc:"Create your first group chat",icon:"groups",key:"group",goal:1},
      {id:"community-1",name:"Community Founder",desc:"Create your first community",icon:"groups_3",key:"community",goal:1},
      {id:"call-1",name:"Say Hello",desc:"Place your first call",icon:"call",key:"call",goal:1}
    ];
    const total=achievements.filter(a=>(Number(stats[a.key]||0)>=a.goal)).length;
    featureBody.innerHTML=`<div class="nc-achievement-summary"><div class="nc-achievement-medal">${icon("emoji_events")}</div><div><strong>${total} / ${achievements.length}</strong><p>Achievements unlocked</p><div class="nc-progress"><i style="width:${Math.round(total/achievements.length*100)}%"></i></div></div></div><div class="nc-achievement-grid">${achievements.map(a=>{const count=Number(stats[a.key]||0),done=count>=a.goal;return `<article class="nc-achievement ${done?"unlocked":"locked"}"><div class="nc-achievement-icon">${icon(a.icon)}</div><div class="nc-achievement-copy"><b>${safe(a.name)}</b><p>${safe(a.desc)}</p><small>${done?"Unlocked":`${Math.min(count,a.goal)} / ${a.goal} progress`}</small></div><span class="nc-achievement-state">${icon(done?"verified":"lock")}</span></article>`}).join("")}</div><p class="nc-note">Progress is tracked from actions performed after this update is installed. Older messages and statuses are not automatically counted.</p>`;
  }
  async function renderNewGroup() {
    const {user,db}=await userAndDb(); let contacts=[];
    try { const snap=await getDocs(collection(db,"user",user.uid,"contacts")); contacts=await Promise.all(snap.docs.map(async d=>{let data=d.data();let uid=d.id; if(data.uid)uid=data.uid; if(data.contactUid)uid=data.contactUid; if(data.userId)uid=data.userId; if(data.userFullname||data.name) return {uid,...data}; const profile=await getDoc(doc(db,"user",uid)); return profile.exists()?{uid,...profile.data()}:null;})); contacts=contacts.filter(c=>c&&c.uid!==user.uid); } catch(e) { console.warn("Contact list could not be loaded",e); }
    featureBody.innerHTML=`<div class="nc-hero"><div class="nc-hero-icon">${icon("group_add")}</div><div><h3>Start a group conversation</h3><p>Choose at least one other contact and give the group a name.</p></div></div><form id="ncGroupForm" class="nc-form"><div class="nc-group-photo-picker"><div class="nc-group-photo-preview" id="ncGroupPhotoPreview"><span class="material-symbols-outlined">groups</span></div><div><b>Group profile photo</b><p>Choose a clear square image. JPG, PNG or WebP, up to 5 MB.</p><label class="nc-btn secondary nc-file-button">Upload photo<input id="ncGroupPhotoFile" type="file" accept="image/png,image/jpeg,image/webp" hidden></label></div></div><label>Group name<input name="name" maxlength="60" required placeholder="e.g. Class of 2026"></label><label>Group description<input name="description" maxlength="240" placeholder="What is this group about?"></label><label>Search contacts<input id="ncContactSearch" placeholder="Search by name or NetChat ID"></label><div id="ncContactList" class="nc-contact-list">${contacts.length?contacts.map(c=>`<label class="nc-contact"><input type="checkbox" name="member" value="${safe(c.uid)}"><img src="${safe(c.profileImage||"default-avatar.png")}" alt=""><span><b>${safe(c.userFullname||c.name||"NetChat User")}</b><small>${safe(c.netChatID||c.uid)}</small></span></label>`).join(""):empty("No contacts found","Add/accept contacts first, then come back to create a group.")}</div><button class="nc-btn" type="submit">${icon("group_add")} Create group chat</button></form>`;
    featureBody.querySelector("#ncContactSearch")?.addEventListener("input",e=>{const term=e.target.value.toLowerCase();featureBody.querySelectorAll(".nc-contact").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(term));});
    let selectedGroupPhoto = null;
    const photoInput = featureBody.querySelector("#ncGroupPhotoFile");
    photoInput?.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
        photoInput.value = "";
        featureToast("Choose JPG, PNG or WebP under 5 MB");
        return;
      }
      selectedGroupPhoto = file;
      const preview = featureBody.querySelector("#ncGroupPhotoPreview");
      if (preview) preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Group photo preview">`;
    });
    featureBody.querySelector("#ncGroupForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('button[type="submit"]');
      if (submit.disabled) return;
      const formData = new FormData(form);
      const name = String(formData.get("name") || "").trim();
      const description = String(formData.get("description") || "").trim();
      const selected = [...featureBody.querySelectorAll('input[name="member"]:checked')].map((input) => input.value);
      if (!name || !selected.length) { featureToast("Choose at least one contact"); return; }
      const participants = [...new Set([user.uid, ...selected])];
      const unreadCount = Object.fromEntries(participants.map((uid) => [uid, 0]));
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      const original = submit.innerHTML;
      submit.innerHTML = `<span class="material-symbols-outlined spin">progress_activity</span> Creating group…`;
      try {
        const groupRef = doc(collection(db, "chats"));
        let groupImage = "";
        if (selectedGroupPhoto) {
          submit.innerHTML = `<span class="material-symbols-outlined spin">progress_activity</span> Uploading photo…`;
          groupImage = (await uploadChatMediaToCloudinary(selectedGroupPhoto)).url;
        }
        await setDoc(groupRef, {
          isGroup: true, type: "group", groupName: name, groupDescription: description,
          groupImage, createdBy: user.uid, ownerId: user.uid, admins: [user.uid],
          createdAt: serverTimestamp(), participants, unreadCount, lastMessage: "Group created",
          lastMessageSenderId: user.uid, lastMessageAt: serverTimestamp(), lastMessageStatus: "sent",
          memberCanEditInfo: false, memberCanAddOthers: false, onlyAdminsCanMessage: false
        });
        await window.netChatTrackAchievementEvent?.("group");
        featureToast("Group created");
        closeFeature();
        document.getElementById("chatsNavBtn")?.click();
      } catch (error) {
        console.error("Group create/photo upload failed:", error);
        featureToast(error.message?.includes("Cloudinary") ? error.message : "Could not create group. Check connection and Firestore rules.");
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
        submit.innerHTML = original;
      }
    });
  }
  async function renderBroadcast() {
    const {user,db}=await userAndDb(); let contacts=[];
    try {const snap=await getDocs(collection(db,"user",user.uid,"contacts"));contacts=await Promise.all(snap.docs.map(async d=>{const uid=d.data().uid||d.data().contactUid||d.id;const p=await getDoc(doc(db,"user",uid));return p.exists()?{uid,...p.data()}:null;}));contacts=contacts.filter(Boolean);}catch(e){}
    featureBody.innerHTML=`<div class="nc-hero"><div class="nc-hero-icon">${icon("campaign")}</div><div><h3>Broadcast message</h3><p>Send the same message individually to selected contacts.</p></div></div><form id="ncBroadcastForm" class="nc-form"><label>Message<textarea name="message" required maxlength="2000" placeholder="Write your broadcast message…"></textarea></label><div class="nc-contact-list">${contacts.length?contacts.map(c=>`<label class="nc-contact"><input type="checkbox" name="member" value="${safe(c.uid)}"><img src="${safe(c.profileImage||"default-avatar.png")}" alt=""><span><b>${safe(c.userFullname||"NetChat User")}</b><small>${safe(c.netChatID||c.uid)}</small></span></label>`).join(""):empty("No contacts available","Add contacts before sending a broadcast.")}</div><button class="nc-btn" type="submit">${icon("send")} Send broadcast</button></form>`;
    featureBody.querySelector("#ncBroadcastForm").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const message=String(new FormData(form).get("message")||"").trim();const selected=[...form.querySelectorAll('input[name="member"]:checked')].map(x=>x.value);if(!message||!selected.length)return featureToast("Choose contacts and enter a message");let sent=0;for(const uid of selected){try{const chatId=[user.uid,uid].sort().join("_");const chatRef=doc(db,"chats",chatId);await addDoc(collection(chatRef,"messages"),{senderId:user.uid,text:message,media:[],timestamp:serverTimestamp(),status:"sent",broadcast:true});await setDoc(chatRef,{participants:[user.uid,uid],lastMessage:message,lastMessageSenderId:user.uid,lastMessageAt:serverTimestamp(),lastMessageStatus:"sent",unreadCount:{[uid]:increment(1),[user.uid]:0}},{merge:true});sent++;}catch(err){console.error("Broadcast delivery failed",uid,err);}}featureToast(`Sent to ${sent} of ${selected.length} contacts`);if(sent)await window.netChatTrackAchievementEvent?.("message");});
  }
  async function renderStarred() {
    const {user,db}=await userAndDb(); let chats=[]; try{const snap=await getDocs(query(collection(db,"chats"),where("participants","array-contains",user.uid)));chats=snap.docs.map(d=>({id:d.id,...d.data()})).filter(c=>c.groupDeleted!==true);}catch(e){}
    let messages=[]; for(const chat of chats){try{const snap=await getDocs(collection(db,"chats",chat.id,"messages"));snap.docs.forEach(d=>{const m=d.data();if(m.starred===true||m.starredBy?.includes?.(user.uid)||(m.stars?.[user.uid]===true))messages.push({id:d.id,chatId:chat.id,...m});});}catch(e){}}
    featureBody.innerHTML=`<div class="nc-hero"><div class="nc-hero-icon">${icon("star")}</div><div><h3>Saved messages</h3><p>Messages you have starred for quick access.</p></div></div><div class="nc-list">${messages.length?messages.map(m=>`<article class="nc-list-card"><div class="nc-avatar">${icon("star")}</div><div class="nc-list-copy"><b>${safe(m.senderId===user.uid?"You":"Message")}</b><p>${safe(m.text||"Media message")}</p><small>${safe(m.timestamp?.toDate?m.timestamp.toDate().toLocaleString():"Saved message")}</small></div></article>`).join(""):empty("No starred messages found","Starred-message support depends on your current message schema and rules.")}</div>`;
  }
  function renderLinkedDevices(){featureBody.innerHTML=`<div class="nc-hero"><div class="nc-hero-icon">${icon("devices")}</div><div><h3>Linked devices</h3><p>Review the devices you have connected to NetChat.</p></div></div>${empty("No linked devices recorded","Device pairing is not configured yet. This screen is ready, but secure QR pairing requires a backend/session design.")}<div class="nc-note">For your security, this page does not invent or display fake sessions.</div>`;}
  async function renderBlocked() {
    const { user, db } = await userAndDb();
    const snap = await getDocs(collection(db, "user", user.uid, "blockedUsers"));
    const items = await Promise.all(snap.docs.map(async (item) => {
      const stored = item.data();
      const profile = await getSenderProfile(item.id).catch(() => null);
      return { id: item.id, ...stored, ...(profile || {}) };
    }));
    featureBody.innerHTML = `<div class="nc-hero"><div class="nc-hero-icon">${icon("block")}</div><div><h3>Blocked users</h3><p>Manage the accounts in your blocked list. Unblocking takes effect immediately.</p></div></div><div class="nc-list">${items.length ? items.map((item) => `<article class="nc-list-card"><img class="nc-member-avatar" src="${safe(item.profileImage || "default-avatar.png")}" alt=""><div class="nc-list-copy"><b>${safe(item.userFullname || "NetChat User")}</b><small>${safe(item.netChatID || item.id)}</small></div><button class="nc-btn secondary" data-unblock-user="${safe(item.id)}">Unblock</button></article>`).join("") : empty("No blocked users", "Accounts you block from a private chat will appear here.")}</div>`;
    featureBody.querySelectorAll("[data-unblock-user]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try { await deleteDoc(doc(db, "user", user.uid, "blockedUsers", button.dataset.unblockUser)); featureToast("Contact unblocked"); await renderBlocked(); }
      catch (error) { console.error("Unblock failed", error); featureToast("Could not unblock this contact"); button.disabled = false; }
    }));
  }
  async function renderArchived() {
    const { user, db } = await userAndDb();
    featureBody.innerHTML = `<div class="status-empty">Loading archived chats…</div>`;
    let items = [];
    try {
      const snap = await getDocs(collection(db, "user", user.uid, "archivedChats"));
      items = snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => !item.deletedAt);
    } catch (error) { featureBody.innerHTML = empty("Archive unavailable", "Could not load your archived chats. Check your connection."); return; }
    featureBody.innerHTML = `<div class="nc-hero"><div class="nc-hero-icon">${icon("archive")}</div><div><h3>Archived chats</h3><p>Archived only for your account. Restore a chat to return it to your inbox.</p></div></div>${items.length ? `<div class="nc-list">${items.map((item) => `<article class="nc-list-card"><div class="nc-avatar">${icon("chat")}</div><div class="nc-list-copy"><b>${safe(item.title || "Archived chat")}</b><p>${safe(item.lastMessage || "No preview")}</p></div><button class="nc-btn secondary" data-restore-chat="${safe(item.id)}">Restore</button></article>`).join("")}</div>` : empty("Nothing archived", "Swipe a chat left or long-press it, then choose Archive.")}`;
    featureBody.querySelectorAll("[data-restore-chat]").forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await deleteDoc(doc(db, "user", user.uid, "archivedChats", button.dataset.restoreChat));
        const chatSnap = await getDoc(doc(db, "chats", button.dataset.restoreChat));
        if (chatSnap.exists()) await updateDoc(chatSnap.ref, { [`unreadCount.${user.uid}`]: Number(chatSnap.data().unreadCount?.[user.uid] || 0) });
        featureToast("Chat restored"); await renderArchived();
      } catch (error) { console.error(error); featureToast("Could not restore chat"); button.disabled = false; }
    }));
  }
})();


/* ---------- runtime resilience ---------- */
window.addEventListener("error", (event) => {
  console.error("NetChat runtime error:", event.error || event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const name = reason?.name || "";
  const message = String(reason?.message || reason || "");

  // Firebase can reject an internal request with AbortError when a listener is
  // unsubscribed/replaced while its request is still in flight. That is a normal
  // cancellation, not a broken chat/community operation.
  if (name === "AbortError" || /signal is aborted/i.test(message)) {
    event.preventDefault();
    console.debug("NetChat: Firestore request cancelled normally.");
    return;
  }

  console.error("NetChat unhandled promise rejection:", reason);
});

/*
 * Keep a recoverable copy of the last successfully rendered chat-list data.
 * This is deliberately data-only; Firestore remains the source of truth.
 */
window.netChatCacheChatList = (items) => {
  try {
    const uid = window.netChatAuthUser?.uid;
    if (!uid || !Array.isArray(items)) return;
    localStorage.setItem(`netchat:${uid}:chat-list-cache`, JSON.stringify(items));
  } catch {}
};
