/* NetChat group suite: sounds, polls, attachments, voice notes and member actions. */
import {
  doc, getDoc, addDoc, setDoc, updateDoc, collection, onSnapshot,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const uid = () => window.netChatAuthUser?.uid || "";
const directId = (a, b) => [a, b].sort().join("_");

const suite = {
  chatId: null,
  target: null,
  group: null,
  groupUnsubscribe: null,
  presenceUnsubscribe: null,
  online: 0,
  recording: null,
  recordChunks: [],
  recordStarted: 0,
  recordTimer: null,
  discardRecording: false,
  knownMessages: new Map(),
  playedMessages: new Set(),
  typingPlayed: new Map(),
  audioContext: null,
  sheet: null,
  previousFocus: null
};

function toast(message, duration = 2800) {
  let el = $("#ncsToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ncsToast";
    el.className = "ncs-toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), duration);
}

function isGroupAdmin(data = suite.group) {
  return !!data && (data.createdBy === uid() || (data.admins || []).includes(uid()));
}

function canPost() {
  if (!suite.chatId || !uid()) return false;
  if (!suite.target?.isGroup) return true;
  if (!suite.group) return true;
  if (!(suite.group.participants || []).includes(uid())) return false;
  return suite.group.onlyAdminsCanMessage !== true || isGroupAdmin();
}

function updateGroupStatus() {
  if (!suite.target?.isGroup || !suite.group) return;
  const status = $("#chatUserStatus");
  const typing = $("#groupTypingIndicator");
  if (!status || (typing && !typing.hidden)) return;
  const count = (suite.group.participants || []).length;
  const text = `${count} member${count === 1 ? "" : "s"}${suite.online ? ` · ${suite.online} online` : ""}`;
  if (status.textContent !== text) status.textContent = text;
}

function applyPermissions() {
  const allowed = canPost();
  const input = $("#messageInput");
  const composer = $(".input-glass-pill");
  if (!input) return;
  input.disabled = !allowed;
  input.placeholder = allowed ? "Message..." : "Only admins can send messages";
  composer?.classList.toggle("composer-locked", !allowed);
  ["#emojiBtn", "#attachFileBtn", "#chatImageBtn", "#chatGalleryBtn", "#sendMsgBtn"].forEach(selector => {
    const control = $(selector);
    if (control) control.disabled = !allowed && !suite.recording;
  });
  updateComposerButton();
}

function setContext(conversationId, target) {
  if (suite.chatId === conversationId && suite.target === target) return;
  suite.groupUnsubscribe?.();
  suite.presenceUnsubscribe?.();
  suite.groupUnsubscribe = null;
  suite.presenceUnsubscribe = null;
  suite.chatId = conversationId;
  suite.target = target;
  suite.group = null;
  suite.online = 0;
  $("#groupSettingsBtn")?.toggleAttribute("hidden", !target?.isGroup);
  if (conversationId && target?.isGroup && window.netChatDB) {
    suite.groupUnsubscribe = onSnapshot(doc(window.netChatDB, "chats", conversationId), snapshot => {
      suite.group = snapshot.exists() ? snapshot.data() : null;
      if (suite.target && suite.group) {
        suite.target.participants = suite.group.participants || [];
        suite.target.createdBy = suite.group.createdBy;
        suite.target.admins = suite.group.admins || [];
      }
      updateGroupStatus();
      applyPermissions();
    }, error => {
      console.warn("Group settings sync failed:", error);
      toast("Could not sync group settings. Check your Firebase rules.");
    });
    if (window.netChatRealtimeDB) {
      suite.presenceUnsubscribe = onValue(ref(window.netChatRealtimeDB, "presence"), snapshot => {
        const presence = snapshot.val() || {};
        const members = suite.group?.participants || suite.target?.participants || [];
        suite.online = members.filter(member => member !== uid() && presence[member]?.online === true).length;
        updateGroupStatus();
      }, () => {});
    }
  } else {
    applyPermissions();
  }
}

/* Short synthesized cues need no audio files and work offline after the first tap. */
function playSound(kind, conversationId = suite.chatId) {
  try {
    if (localStorage.getItem("nc:sounds") === "off") return;
    if (conversationId && localStorage.getItem(`nc:muted:${conversationId}`) === "1") return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    suite.audioContext ||= new AudioContext();
    const context = suite.audioContext;
    if (context.state === "suspended") context.resume();
    const now = context.currentTime;
    const notes = kind === "send" ? [[520, 0], [760, .075]]
      : kind === "typing" ? [[880, 0], [880, .09]]
      : [[740, 0], [520, .105]];
    notes.forEach(([frequency, delay], index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "receive" ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, now + delay);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(kind === "typing" ? .025 : .065, now + delay + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + delay + (index ? .12 : .085));
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + .14);
    });
  } catch (_) { /* Audio is optional when a browser blocks it. */ }
}

function notifyMessages(snapshot, conversationId) {
  if (!conversationId) return;
  if (!suite.knownMessages.has(conversationId)) {
    suite.knownMessages.set(conversationId, new Set(snapshot.docs.map(document => document.id)));
    return;
  }
  const known = suite.knownMessages.get(conversationId);
  snapshot.docChanges().forEach(change => {
    const id = change.doc.id;
    if (change.type === "added" && !known.has(id)) {
      const data = change.doc.data();
      if (data.senderId !== uid() && !suite.playedMessages.has(id)) {
        suite.playedMessages.add(id);
        playSound("receive", conversationId);
      }
    }
    known.add(id);
  });
}

function notifyTyping(conversationId) {
  const last = suite.typingPlayed.get(conversationId) || 0;
  if (Date.now() - last < 2600) return;
  suite.typingPlayed.set(conversationId, Date.now());
  playSound("typing", conversationId);
}

function renderMessage(data, messageId) {
  if (data.type === "poll" && data.poll) return renderPoll(data, messageId);
  if (data.type === "voice" && data.audio?.url) {
    return `<div class="ncs-voice-message"><span class="material-symbols-outlined">mic</span><audio controls preload="metadata" src="${esc(data.audio.url)}"></audio><small>${formatDuration(data.audio.duration)}</small></div>`;
  }
  if (data.type === "file" && data.attachment?.url) {
    const file = data.attachment;
    return `<a class="ncs-file-message" href="${esc(file.url)}" target="_blank" rel="noopener" download="${esc(file.fileName || "attachment")}"><span class="material-symbols-outlined">description</span><span><b>${esc(file.fileName || "Document")}</b><small>${esc(file.mimeType || "File")} · ${formatBytes(file.bytes)}</small></span><span class="material-symbols-outlined">download</span></a>`;
  }
  return "";
}

function renderPoll(data, messageId) {
  const poll = data.poll;
  const votes = data.pollVotes || {};
  const totalVoters = Object.keys(votes).filter(Boolean).length;
  const options = (poll.options || []).map(option => {
    const count = Object.values(votes).filter(vote => Array.isArray(vote) ? vote.includes(option.id) : vote === option.id).length;
    const percentage = totalVoters ? Math.round(count / totalVoters * 100) : 0;
    const myVote = votes[uid()];
    const selected = Array.isArray(myVote) ? myVote.includes(option.id) : myVote === option.id;
    return `<button type="button" class="ncs-poll-option ${selected ? "selected" : ""}" data-poll-vote="${esc(messageId)}" data-option-id="${esc(option.id)}" ${poll.closed ? "disabled" : ""} style="--poll-fill:${percentage}%"><span class="ncs-poll-check material-symbols-outlined">${selected ? "check_circle" : "radio_button_unchecked"}</span><span class="ncs-poll-option-copy"><b>${esc(option.text)}</b><small>${count} vote${count === 1 ? "" : "s"}</small></span><strong>${percentage}%</strong></button>`;
  }).join("");
  return `<div class="ncs-poll" data-poll-id="${esc(messageId)}"><div class="ncs-poll-heading"><span class="material-symbols-outlined">poll</span><b>${esc(poll.question || "Group poll")}</b></div><p>${poll.multiple ? "Choose one or more answers" : "Choose one answer"} · ${totalVoters} voter${totalVoters === 1 ? "" : "s"}</p><div class="ncs-poll-options">${options}</div>${poll.closed ? `<small class="ncs-poll-closed">Poll closed</small>` : ""}</div>`;
}

async function votePoll(button) {
  if (!suite.chatId || !uid()) return;
  const messageId = button.dataset.pollVote;
  const optionId = button.dataset.optionId;
  const row = button.closest(".msg-row");
  const documentSnapshot = window.currentChatSnapshotDocs?.find(item => item.id === messageId);
  const data = documentSnapshot?.data();
  if (!data?.poll || data.poll.closed) return;
  const current = data.pollVotes?.[uid()];
  let next;
  if (data.poll.multiple) {
    const values = Array.isArray(current) ? [...current] : current ? [current] : [];
    next = values.includes(optionId) ? values.filter(value => value !== optionId) : [...values, optionId];
  } else next = current === optionId ? null : optionId;
  button.disabled = true;
  try {
    await updateDoc(doc(window.netChatDB, "chats", suite.chatId, "messages", messageId), {
      [`pollVotes.${uid()}`]: next
    });
    playSound("send", suite.chatId);
  } catch (error) {
    console.error("Poll vote failed:", error);
    button.disabled = false;
    toast("Your vote could not be saved. Publish the updated Firebase rules.");
  }
  row?.removeAttribute("data-voting");
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return "attachment";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function ensureSheet() {
  if (suite.sheet) return suite.sheet;
  const backdrop = document.createElement("div");
  backdrop.className = "ncs-backdrop";
  backdrop.innerHTML = `<section class="ncs-sheet" role="dialog" aria-modal="true" aria-labelledby="ncsSheetTitle"><div class="ncs-grab"></div><header><div><small id="ncsSheetKicker">NETCHAT</small><h2 id="ncsSheetTitle">Options</h2></div><button type="button" class="ncs-close" aria-label="Close"><span class="material-symbols-outlined">close</span></button></header><div class="ncs-sheet-body"></div></section>`;
  document.body.appendChild(backdrop);
  suite.sheet = backdrop;
  $(".ncs-close", backdrop).addEventListener("click", closeSheet);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) closeSheet(); });
  return backdrop;
}
function openSheet(title, kicker, html) {
  const backdrop = ensureSheet();
  suite.previousFocus = document.activeElement;
  $("#ncsSheetTitle", backdrop).textContent = title;
  $("#ncsSheetKicker", backdrop).textContent = kicker;
  $(".ncs-sheet-body", backdrop).innerHTML = html;
  backdrop.classList.add("open");
  document.body.classList.add("ncs-modal-open");
  setTimeout(() => $("button, input, textarea", $(".ncs-sheet-body", backdrop))?.focus(), 50);
  return $(".ncs-sheet-body", backdrop);
}
function closeSheet() {
  suite.sheet?.classList.remove("open");
  document.body.classList.remove("ncs-modal-open");
  suite.previousFocus?.focus?.();
}

function openAttachments() {
  if (!canPost()) return toast("Only admins can send messages in this group");
  const body = openSheet("Share with this chat", "ATTACHMENT", `<div class="ncs-attachment-grid">
    <button type="button" data-attach="gallery"><span class="material-symbols-outlined">photo_library</span><b>Gallery</b><small>Photos & video</small></button>
    <button type="button" data-attach="camera"><span class="material-symbols-outlined">photo_camera</span><b>Camera</b><small>Take a photo</small></button>
    <button type="button" data-attach="document"><span class="material-symbols-outlined">description</span><b>Document</b><small>PDF, ZIP & more</small></button>
    <button type="button" data-attach="audio"><span class="material-symbols-outlined">audio_file</span><b>Audio</b><small>Music & recordings</small></button>
    <button type="button" data-attach="poll" class="ncs-poll-create"><span class="material-symbols-outlined">poll</span><b>Create poll</b><small>Vote together live</small></button>
    <button type="button" data-attach="voice"><span class="material-symbols-outlined">mic</span><b>Voice note</b><small>Record a message</small></button>
  </div><input id="ncsDocumentInput" type="file" hidden><input id="ncsAudioInput" type="file" accept="audio/*" hidden>`);
  $$("[data-attach]", body).forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.attach;
    closeSheet();
    if (action === "gallery") $("#chatGalleryBtn")?.click();
    if (action === "camera") $("#chatImageBtn")?.click();
    if (action === "poll") setTimeout(openPollComposer, 160);
    if (action === "voice") setTimeout(startRecording, 160);
    if (action === "document") $("#ncsDocumentInput")?.click();
    if (action === "audio") $("#ncsAudioInput")?.click();
  }));
  $("#ncsDocumentInput", body)?.addEventListener("change", event => sendFile(event.target.files[0], false));
  $("#ncsAudioInput", body)?.addEventListener("change", event => sendFile(event.target.files[0], true));
}

function openPollComposer() {
  if (!canPost()) return toast("Only admins can create a poll here");
  const body = openSheet("Create a poll", "LIVE GROUP POLL", `<form id="ncsPollForm" class="ncs-poll-form"><label>Question<input id="ncsPollQuestion" maxlength="180" required placeholder="What should we decide?"></label><div class="ncs-poll-fields"><label>Option 1<input name="pollOption" maxlength="90" required placeholder="First answer"></label><label>Option 2<input name="pollOption" maxlength="90" required placeholder="Second answer"></label></div><button type="button" class="ncs-text-button" id="ncsAddPollOption"><span class="material-symbols-outlined">add</span>Add another option</button><label class="ncs-check-row"><input id="ncsPollMultiple" type="checkbox"><span><b>Allow multiple answers</b><small>Members can select more than one option</small></span></label><p class="ncs-form-error" id="ncsPollError" role="alert"></p><button class="ncs-primary-button" type="submit"><span class="material-symbols-outlined">poll</span>Send live poll</button></form>`);
  $("#ncsAddPollOption", body).addEventListener("click", () => {
    const fields = $(".ncs-poll-fields", body);
    if (fields.children.length >= 6) return toast("A poll can have up to 6 options");
    const label = document.createElement("label");
    label.textContent = `Option ${fields.children.length + 1}`;
    const input = document.createElement("input");
    input.name = "pollOption";
    input.maxLength = 90;
    input.required = true;
    input.placeholder = "Another answer";
    label.appendChild(input);
    fields.appendChild(label);
    input.focus();
  });
  $("#ncsPollForm", body).addEventListener("submit", async event => {
    event.preventDefault();
    const question = $("#ncsPollQuestion", body).value.trim();
    const options = $$("input[name=pollOption]", body).map(input => input.value.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      $("#ncsPollError", body).textContent = "Add a question and at least two different answers.";
      return;
    }
    if (new Set(options.map(value => value.toLowerCase())).size !== options.length) {
      $("#ncsPollError", body).textContent = "Each poll option must be different.";
      return;
    }
    const submit = $("button[type=submit]", body);
    submit.disabled = true;
    try {
      await sendSpecialMessage({
        type: "poll",
        poll: {
          question,
          options: options.map((text, index) => ({ id: `option_${index + 1}`, text })),
          multiple: $("#ncsPollMultiple", body).checked,
          closed: false,
          createdBy: uid()
        },
        pollVotes: {}
      }, `Poll: ${question}`);
      closeSheet();
    } catch (error) {
      console.error("Poll creation failed:", error);
      submit.disabled = false;
      $("#ncsPollError", body).textContent = "The poll could not be sent. Check your connection and Firebase rules.";
    }
  });
}

async function sendSpecialMessage(fields, preview) {
  if (!suite.chatId || !suite.target || !uid()) throw new Error("Open a chat first");
  if (!canPost()) throw new Error("Only admins can send messages in this group");
  const conversationId = suite.target.isGroup ? suite.chatId : directId(uid(), suite.target.theNewCreatedUser || suite.target.uid);
  const conversationRef = doc(window.netChatDB, "chats", conversationId);
  const snapshot = await getDoc(conversationRef);
  const messageRef = await addDoc(collection(conversationRef, "messages"), {
    senderId: uid(), text: "", media: [], timestamp: serverTimestamp(), status: "sent", replyTo: null, ...fields
  });
  const participants = suite.target.isGroup ? (suite.group?.participants || suite.target.participants || []) : [uid(), suite.target.theNewCreatedUser || suite.target.uid];
  const values = {
    lastMessage: preview,
    lastMessageSenderId: uid(),
    lastMessageAt: serverTimestamp(),
    lastMessageStatus: "sent",
    lastMessageId: messageRef.id
  };
  if (!snapshot.exists()) {
    await setDoc(conversationRef, {
      participants,
      lastMessage: preview,
      lastMessageSenderId: uid(),
      lastMessageAt: serverTimestamp(),
      lastMessageStatus: "sent",
      lastMessageId: messageRef.id,
      unreadCount: Object.fromEntries(participants.map(member => [member, member === uid() ? 0 : 1])),
      createdAt: serverTimestamp()
    });
  } else {
    participants.filter(member => member !== uid()).forEach(member => { values[`unreadCount.${member}`] = increment(1); });
    await updateDoc(conversationRef, values);
  }
  playSound("send", conversationId);
  return messageRef;
}

async function uploadFile(file, resource = "auto") {
  const data = new FormData();
  data.append("file", file);
  data.append("upload_preset", "My_NetChat_chat");
  const response = await fetch(`https://api.cloudinary.com/v1_1/haludoui/${resource}/upload`, { method: "POST", body: data });
  const result = await response.json();
  if (!response.ok || !result.secure_url) throw new Error(result.error?.message || "Upload failed");
  return result;
}

async function sendFile(file, isAudio) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) return toast("Please choose a file smaller than 25 MB");
  toast(`Uploading ${file.name}…`, 6000);
  try {
    const uploaded = await uploadFile(file, isAudio ? "video" : "auto");
    if (isAudio) {
      await sendSpecialMessage({ type: "voice", audio: { url: uploaded.secure_url, duration: uploaded.duration || 0, mimeType: file.type, bytes: file.size } }, "Voice note");
    } else {
      await sendSpecialMessage({ type: "file", attachment: { url: uploaded.secure_url, fileName: file.name, mimeType: file.type || "application/octet-stream", bytes: file.size } }, `Document: ${file.name}`);
    }
    toast("Attachment sent");
  } catch (error) {
    console.error("Attachment failed:", error);
    toast(error.message || "Attachment could not be sent", 4500);
  }
}

function updateComposerButton() {
  const button = $("#sendMsgBtn");
  const input = $("#messageInput");
  if (!button || !input) return;
  const hasMedia = $("#chatMediaPreview") && !$("#chatMediaPreview").hidden;
  const recording = !!suite.recording;
  const icon = $("span", button);
  if (recording) {
    if (icon) icon.textContent = "stop";
    button.setAttribute("aria-label", "Stop and send voice note");
    button.classList.add("recording");
  } else {
    const empty = !input.value.trim() && !hasMedia;
    if (icon) icon.textContent = empty ? "mic" : "send";
    button.setAttribute("aria-label", empty ? "Record voice note" : "Send Message");
    button.classList.remove("recording");
  }
}

async function startRecording() {
  if (suite.recording || !canPost()) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("Voice recording is not supported in this browser");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
    suite.recording = recorder;
    suite.recordChunks = [];
    suite.recordStarted = Date.now();
    suite.discardRecording = false;
    recorder.addEventListener("dataavailable", event => { if (event.data.size) suite.recordChunks.push(event.data); });
    recorder.addEventListener("stop", finishRecording, { once: true });
    recorder.start(250);
    showRecordingUI();
    suite.recordTimer = setInterval(() => {
      const elapsed = (Date.now() - suite.recordStarted) / 1000;
      const timer = $("#ncsRecordTime");
      if (timer) timer.textContent = formatDuration(elapsed);
      if (elapsed >= 120 && suite.recording?.state !== "inactive") suite.recording.stop();
    }, 250);
    updateComposerButton();
  } catch (error) {
    console.warn("Microphone unavailable:", error);
    suite.recording = null;
    toast("Microphone permission is needed to record a voice note");
  }
}

function showRecordingUI() {
  $(".ncs-recording-bar")?.remove();
  const bar = document.createElement("div");
  bar.className = "ncs-recording-bar";
  bar.innerHTML = `<span class="ncs-record-dot"></span><b id="ncsRecordTime">0:00</b><span>Recording voice note</span><button type="button" id="ncsCancelRecording">Cancel</button>`;
  $(".input-glass-pill")?.prepend(bar);
  $("#ncsCancelRecording").addEventListener("click", () => {
    suite.discardRecording = true;
    suite.recording?.stop();
  });
}

async function finishRecording() {
  const recorder = suite.recording;
  if (!recorder) return;
  clearInterval(suite.recordTimer);
  const duration = (Date.now() - suite.recordStarted) / 1000;
  recorder.stream.getTracks().forEach(track => track.stop());
  const blob = new Blob(suite.recordChunks, { type: recorder.mimeType || "audio/webm" });
  const discarded = suite.discardRecording || duration < .45;
  suite.recording = null;
  suite.recordChunks = [];
  $(".ncs-recording-bar")?.remove();
  updateComposerButton();
  applyPermissions();
  if (discarded) return toast("Voice note cancelled");
  toast("Uploading voice note…", 6000);
  try {
    const extension = blob.type.includes("mp4") ? "m4a" : "webm";
    const file = new File([blob], `voice-note.${extension}`, { type: blob.type });
    const uploaded = await uploadFile(file, "video");
    await sendSpecialMessage({ type: "voice", audio: { url: uploaded.secure_url, duration, mimeType: blob.type, bytes: blob.size } }, "Voice note");
    toast("Voice note sent");
  } catch (error) {
    console.error("Voice note failed:", error);
    toast(error.message || "Voice note could not be sent", 4500);
  }
}

async function openPrivateFromUid(memberUid, callMode) {
  if (!memberUid || memberUid === uid()) return toast("This is your own profile");
  try {
    const snapshot = await getDoc(doc(window.netChatDB, "user", memberUid));
    if (!snapshot.exists()) return toast("This member profile is unavailable");
    const profile = { ...snapshot.data(), uid: memberUid, theNewCreatedUser: memberUid, isGroup: false };
    closeGroupMembers();
    closeSheet();
    if (typeof window.netChatMessageProfile === "function") {
      window.netChatMessageProfile(profile);
      if (callMode) setTimeout(() => $(callMode === "voice" ? "#startVoiceCallBtn" : "#startCallBtn")?.click(), 650);
    } else toast("Private chat could not be opened");
  } catch (error) {
    console.error("Private chat failed:", error);
    toast("Could not open this member");
  }
}

async function openCallPicker() {
  const members = suite.group?.participants || suite.target?.participants || [];
  const body = openSheet("Call a group member", "VOICE & VIDEO", `<p class="ncs-sheet-intro">Choose a member to start a secure one-to-one WebRTC call.</p><div class="ncs-call-members"><div class="ncs-loading">Loading member profiles…</div></div>`);
  const profiles = await Promise.all(members.filter(member => member !== uid()).map(async member => {
    try {
      const snapshot = await getDoc(doc(window.netChatDB, "user", member));
      return { uid: member, ...(snapshot.exists() ? snapshot.data() : {}) };
    } catch (_) { return { uid: member }; }
  }));
  const list = $(".ncs-call-members", body);
  if (!list) return;
  list.innerHTML = profiles.length ? profiles.map(profile => `<div class="ncs-call-member"><img src="${esc(profile.profileImage || "default-avatar.png")}" alt=""><span><b>${esc(profile.userFullname || "NetChat User")}</b><small>${esc(profile.about || "Group member")}</small></span><button type="button" data-call-uid="${esc(profile.uid)}" data-call-mode="voice" aria-label="Voice call ${esc(profile.userFullname || "member")}"><span class="material-symbols-outlined">call</span></button><button type="button" data-call-uid="${esc(profile.uid)}" data-call-mode="video" aria-label="Video call ${esc(profile.userFullname || "member")}"><span class="material-symbols-outlined">videocam</span></button></div>`).join("") : `<p class="ncs-empty">No other members are available to call.</p>`;
  $$("[data-call-uid]", list).forEach(button => button.addEventListener("click", () => openPrivateFromUid(button.dataset.callUid, button.dataset.callMode)));
}

function closeGroupMembers() {
  $("#groupMembersSheet")?.classList.remove("open");
  $("#groupMembersSheet")?.setAttribute("aria-hidden", "true");
  const backdrop = $("#groupMembersBackdrop");
  if (backdrop) backdrop.hidden = true;
}

function openEmojiPicker() {
  $("#ncsEmojiPicker")?.remove();
  const picker = document.createElement("div");
  picker.id = "ncsEmojiPicker";
  picker.className = "ncs-emoji-picker";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", "Choose an emoji");
  const emojis = ["😀","😂","🥹","😍","🤝","👍","👏","🙏","🎉","🔥","💡","✅","❤️","💙","🤔","😮","😢","🙌","👀","🚀","✨","💯","🙂","😎"];
  picker.innerHTML = emojis.map(emoji => `<button type="button" data-emoji="${emoji}" aria-label="Insert ${emoji}">${emoji}</button>`).join("");
  $(".chat-input-bar")?.appendChild(picker);
  $$("button", picker).forEach(button => button.addEventListener("click", () => {
    const input = $("#messageInput");
    const start = input.selectionStart || input.value.length;
    input.value = input.value.slice(0, start) + button.dataset.emoji + input.value.slice(input.selectionEnd || start);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    picker.remove();
  }));
}

function toggleMute(menuItem) {
  if (!suite.chatId) return;
  const key = `nc:muted:${suite.chatId}`;
  const muted = localStorage.getItem(key) !== "1";
  localStorage.setItem(key, muted ? "1" : "0");
  menuItem.lastChild.textContent = muted ? " Unmute notifications" : " Mute notifications";
  $("#chatDropdown")?.classList.remove("active");
  toast(muted ? "Chat sounds muted" : "Chat sounds enabled");
}

/* DOM events use capture where the original send/call handlers must be bypassed. */
document.addEventListener("click", event => {
  const pollVote = event.target.closest("[data-poll-vote]");
  if (pollVote) { event.preventDefault(); event.stopPropagation(); votePoll(pollVote); return; }
  const send = event.target.closest("#sendMsgBtn");
  if (send) {
    if (suite.recording) {
      event.preventDefault(); event.stopPropagation();
      suite.recording.stop();
      return;
    }
    const empty = !$("#messageInput")?.value.trim() && ($("#chatMediaPreview")?.hidden !== false);
    if (empty) {
      event.preventDefault(); event.stopPropagation();
      startRecording();
      return;
    }
    setTimeout(updateComposerButton, 50);
  }
  const call = event.target.closest("#startCallBtn, #startVoiceCallBtn");
  if (call && suite.target?.isGroup) {
    event.preventDefault(); event.stopPropagation();
    openCallPicker();
  }
}, true);

$("#attachFileBtn")?.addEventListener("click", openAttachments);
$("#emojiBtn")?.addEventListener("click", event => {
  event.stopPropagation();
  if ($("#ncsEmojiPicker")) $("#ncsEmojiPicker").remove(); else openEmojiPicker();
});
$("#messageInput")?.addEventListener("input", updateComposerButton);
$("#chatMediaPreview") && new MutationObserver(updateComposerButton).observe($("#chatMediaPreview"), { attributes: true, childList: true, subtree: true });
document.addEventListener("click", event => {
  if (!event.target.closest("#ncsEmojiPicker, #emojiBtn")) $("#ncsEmojiPicker")?.remove();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeSheet();
    $("#ncsEmojiPicker")?.remove();
    closeGroupMembers();
  }
});
$("#groupSettingsBtn")?.addEventListener("click", () => {
  $("#chatDropdown")?.classList.remove("active");
  $("#chatHeaderUser")?.click();
});
const muteItem = $$("#mainMenuView .menu-item").find(item => item.textContent.includes("Mute notifications"));
if (muteItem) muteItem.addEventListener("click", () => toggleMute(muteItem));

/* Small public bridge used by the group-info and member drawers. */
window.netChatGroupSuite = {
  setContext, updateGroupStatus, playSound, notifyMessages, notifyTyping,
  renderMessage, openPrivateFromUid, openAttachments, openPollComposer,
  getState: () => ({ chatId: suite.chatId, target: suite.target, group: suite.group, canPost: canPost() })
};
updateComposerButton();
console.log("NetChat group suite ready");
