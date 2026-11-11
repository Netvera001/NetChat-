/* NetChat dropdown controller — one click handler, no duplicate legacy wiring */
(() => {
  "use strict";
  const dd = document.querySelector("#chatDropdown");
  const btn = document.querySelector("#chatMenuBtn");
  if (!dd || !btn) return;
  const show = (view) => {
    document.querySelector("#mainMenuView")?.classList.toggle("hidden", view !== "main");
    document.querySelector("#moreMenuView")?.classList.toggle("hidden", view !== "more");
  };
  const close = () => {
    dd.classList.remove("active", "open", "show");
    btn.setAttribute("aria-expanded", "false");
    show("main");
  };
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (dd.classList.contains("active")) close();
    else {
      dd.classList.add("active");
      btn.setAttribute("aria-expanded", "true");
      show("main");
    }
  });
  document.querySelector("#openMoreBtn")?.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation(); show("more");
  });
  document.querySelector("#backToMainMenuBtn")?.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation(); show("main");
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target?.closest(".menu-container")) close();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  window.NXCloseChatDropdown = close;
})();
/* NetChat chat-management hardening layer */
(() => {
  "use strict";
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let fbPromise;
  const fb = async () => {
    if (window.NX?.fns) return window.NX.fns;
    if (!fbPromise) fbPromise = import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js");
    return fbPromise;
  };
  // The app's main Firebase module exposes these exact globals. Prefer them over
  // optional legacy NX aliases so a restored Firebase session is recognized.
  const authUser = () => window.netChatAuthUser || window.netChatAuth?.currentUser || window.NX?.getUser?.() || window.auth?.currentUser || null;
  const db = () => window.netChatDB || window.NX?.db || null;
  const activeId = () => window.netChatGetActiveConversation?.()?.conversationId ||
    document.querySelector("#chatScreen")?.getAttribute("data-conversation-id") ||
    window.NX?.activeChatId || window.netChatActiveConversationId || window.currentChatId || null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Timed out while checking block status.")), ms))]);
  // Firebase restores the saved session asynchronously; wait for it instead of failing instantly.
  async function waitForAuth() {
    if (authUser()?.uid) return authUser();
    try { await Promise.race([window.netChatAuth?.authStateReady?.(), sleep(5000)]); } catch {}
    for (let i = 0; i < 20 && !authUser()?.uid; i++) await sleep(250);
    return authUser();
  }
  async function ctx() {
    const id = activeId();
    // Startup refreshes can happen before a chat is selected. That is not a failure.
    if (!id) return null;
    const u = await waitForAuth();
    if (!u?.uid) throw new Error("Please sign in before managing this chat.");
    const d = db();
    if (!d) throw new Error("Chat database is not ready.");
    const f = await fb();
    const active = window.netChatGetActiveConversation?.() || {};
    const target = active.target || {};
    let data = null;
    try {
      const snap = await f.getDoc(f.doc(d, "chats", id));
      if (snap.exists()) data = snap.data();
    } catch (err) { console.warn("Chat document could not be read; using the open conversation instead:", err); }
    // A brand-new conversation has no chat document until the first message is sent.
    // That is normal, so build the context from the conversation that is open.
    const group = data ? (data.isGroup === true || data.type === "group") : (target.isGroup === true || target.type === "group");
    if (!data) {
      let peerUid = target.theNewCreatedUser || target.uid || null;
      if (!group && (!peerUid || peerUid === u.uid)) peerUid = id.split("_").find(x => x && x !== u.uid) || null;
      data = group ? { ...(active.chatData || {}), isGroup: true } : { participants: [u.uid, peerUid].filter(Boolean), isGroup: false, virtual: true };
    }
    const peer = (data.participants || []).find(x => x && x !== u.uid);
    if (!group && !peer) throw new Error("This conversation has no valid other participant.");
    return { f, u, d, id, data, peer, group };
  }
  function toast2(msg) {
    if (window.NX?.toast) return window.NX.toast(msg);
    const el=$("#nxToast"); if(el){el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600);}
    else alert(msg);
  }
  function modal2(title, html) {
    document.querySelector(".nxm2-backdrop")?.remove();
    const w=document.createElement("div"); w.className="nxm2-backdrop";
    w.innerHTML=`<section class="nxm2"><header><b>${esc(title)}</b><button type="button" data-x aria-label="Close">×</button></header><div class="nxm2-body">${html}</div></section>`;
    document.body.append(w);
    const close=()=>w.remove();
    w.addEventListener("click",e=>{if(e.target===w||e.target.closest("[data-x]"))close();});
    return {root:w,close};
  }
  function addStyle() {
    if($("#nxm2-css")) return;
    const s=document.createElement("style");s.id="nxm2-css";s.textContent=`
      .nxm2-backdrop{position:fixed;inset:0;z-index:100020;background:#000a;display:flex;align-items:center;justify-content:center;padding:16px}
      .nxm2{width:min(560px,100%);max-height:86dvh;overflow:auto;background:#101a2b;color:#eaf3ff;border:1px solid #23425a;border-radius:20px;box-shadow:0 24px 80px #0009}
      .nxm2 header{display:flex;align-items:center;justify-content:space-between;padding:17px 19px;border-bottom:1px solid #26394f;font-size:18px}
      .nxm2 header button{background:none;border:0;color:inherit;font-size:28px}.nxm2-body{padding:18px}
      .nxm2 input,.nxm2 textarea,.nxm2 select{box-sizing:border-box;width:100%;background:#0b1423;color:#f2f7ff;border:1px solid #35506b;border-radius:12px;padding:12px;font:inherit;margin:6px 0 12px}
      .nxm2 button.primary,.nxm2 button.secondary,.nxm2 button.danger{border:0;border-radius:12px;padding:12px 16px;font-weight:700;margin:5px 5px 5px 0}
      .nxm2 .primary{background:#08cfe3;color:#05202b}.nxm2 .secondary{background:#263a52;color:#eaf3ff}.nxm2 .danger{background:#9f3446;color:white}
      .nxm2 .nxm2-results{display:grid;gap:8px;max-height:55dvh;overflow:auto}.nxm2 .nxm2-result{text-align:left;background:#17263b;border:1px solid #2c4660;border-radius:12px;padding:12px;color:#edf5ff}
      .nxm2-result small{display:block;color:#9eb4cc;margin-top:5px}.nxm2-result mark{background:#ffe28a;color:#1c2430}
      .nxm2-themes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.nxm2-theme{height:92px;border:2px solid #50627a;border-radius:14px;color:white;text-shadow:0 1px 3px #000;display:flex;align-items:end;padding:10px;font-weight:700;background-size:cover;background-position:center}
      .nx-blocked-panel{margin:auto;max-width:520px;padding:28px;text-align:center;color:#dbeafe}.nx-blocked-panel h3{font-size:22px}.nx-blocked-panel p{color:#a8bbd1}
      .nx-blocked-panel button{padding:12px 18px;border:0;border-radius:12px;margin:7px;font-weight:700}.nx-blocked-panel .unblock{background:#04cfe3;color:#03232b}.nx-blocked-panel .delete{background:#9f3446;color:white}
      .nx-privacy-notice{margin:8px 12px;padding:10px 14px;border-radius:12px;background:#17263b;border:1px solid #2c4660;color:#dbeafe;font-size:14px;text-align:center}.nx-privacy-notice button{margin-left:8px;padding:6px 12px;border:0;border-radius:10px;background:#04cfe3;color:#03232b;font-weight:700}
      .nx-search-hit{outline:3px solid #04d9ee!important;box-shadow:0 0 0 7px #04d9ee44!important;border-radius:14px!important;transition:box-shadow .2s}
    `;document.head.append(s);
  }
  addStyle();
  async function peerProfile(c) {
    if(c.group)return {userFullname:c.data.groupName||"Group"};
    try{const s=await c.f.getDoc(c.f.doc(c.d,"user",c.peer));return s.exists()?s.data():{userFullname:"NetChat user"};}
    catch{return {userFullname:"NetChat user"};}
  }
  function blockPanel(name, blockedByMe) {
    const body=$("#chatMessagesBody"), footer=$(".chat-input-bar"), calls=$$(".chat-header-actions button:not(#groupMembersBtn)");
    if(!body)return;
    if(blockedByMe || blockedByMe === false){
      const title=blockedByMe ? `You blocked ${esc(name)}` : `You have been blocked by ${esc(name)}`;
      const detail=blockedByMe ? "You won't receive messages or calls from this person while they remain blocked." : "You cannot send messages or call this person.";
      body.innerHTML=`<div class="nx-blocked-panel"><div style="font-size:42px">🚫</div><h3>${title}</h3><p>${detail}</p>${blockedByMe?`<button class="unblock" id="nxUnblockNow">Unblock</button><button class="delete" id="nxDeleteBlockedChat">Delete this chat</button>`:""}</div>`;
      if(footer)footer.hidden=true;
      calls.forEach(b=>{b.hidden=true;});
      if(blockedByMe){$("#nxUnblockNow").onclick=()=>unblockCurrent();$("#nxDeleteBlockedChat").onclick=()=>deleteCurrentChat();}
      const avatar=$("#chatUserAvatar");if(!blockedByMe && avatar)avatar.src="default-avatar.png";
    } else {
      if(footer)footer.hidden=false;
      calls.forEach(b=>b.hidden=false);
      syncMembersButton();
    }
  }
  function showPrivacyNotice() {
    const body=$("#chatMessagesBody"); if(!body||!body.parentElement) return;
    let n=$("#nxPrivacyNotice");
    if(!n){n=document.createElement("div");n.id="nxPrivacyNotice";n.className="nx-privacy-notice";body.parentElement.insertBefore(n,body);}
    n.innerHTML='🔒 Could not verify block status. Blocks are still enforced by the server. <button type="button" id="nxPrivacyRetry">Retry</button>';
    $("#nxPrivacyRetry").onclick=()=>refreshBlockState();
  }
  async function checkBlockState() {
    const c=await ctx();if(!c)return "no-chat";if(c.group)return "group";
    const ref=c.f.doc(c.d,"user",c.u.uid,"blockedUsers",c.peer);
    const reverseRef=c.f.doc(c.d,"user",c.peer,"blockedUsers",c.u.uid);
    const [snap,reverse]=await Promise.all([c.f.getDoc(ref),c.f.getDoc(reverseRef).catch(()=>null)]);
    const p=await peerProfile(c);
    if(snap.exists()){$("#nxPrivacyNotice")?.remove();blockPanel(p.userFullname||"this user",true);return "blocked-by-me";}
    if(reverse?.exists()){$("#nxPrivacyNotice")?.remove();blockPanel(p.userFullname||"this user",false);return "blocked-by-peer";}
    const b=$("#chatMessagesBody");if(b?.querySelector(".nx-blocked-panel"))b.innerHTML="";
    $("#nxPrivacyNotice")?.remove();
    blockPanel("",null); // make sure composer and call buttons are visible again
    return "clear";
  }
  async function refreshBlockState() {
    let lastError;
    for(let attempt=0;attempt<3;attempt++){
      try{return await withTimeout(checkBlockState(),8000);}
      catch(e){lastError=e;console.warn("Block state check failed (attempt "+(attempt+1)+"):",e);if(!activeId())return "no-chat";await sleep(800*(attempt+1));}
    }
    console.warn("Block state could not be verified:",lastError);
    // Never wipe the conversation. Firestore rules still reject messages when a block exists,
    // so show a small retry notice and leave the chat usable.
    showPrivacyNotice();
    return "unknown";
  }
  let blockUnsubscribers=[];
  function watchBlockState(){
    blockUnsubscribers.forEach(unsub=>{try{unsub();}catch{}});blockUnsubscribers=[];
    (async()=>{
      try{
        const c=await ctx();if(!c||c.group||!c.f.onSnapshot)return;
        for(const ref of [
          c.f.doc(c.d,"user",c.u.uid,"blockedUsers",c.peer),
          c.f.doc(c.d,"user",c.peer,"blockedUsers",c.u.uid)
        ]){
          blockUnsubscribers.push(c.f.onSnapshot(ref,()=>{refreshBlockState();},err=>console.warn("Block-state listener failed:",err)));
        }
      }catch(err){console.warn("Could not subscribe to block state:",err);}
    })();
  }
  async function unblockCurrent(){
    try{const c=await ctx();await c.f.deleteDoc(c.f.doc(c.d,"user",c.u.uid,"blockedUsers",c.peer));toast2("User unblocked");location.reload();}
    catch(e){console.error(e);toast2(e.message||"Could not unblock user. Check Firestore rules.");}
  }
  async function deleteCurrentChat(){
    try{const c=await ctx();await c.f.setDoc(c.f.doc(c.d,"user",c.u.uid,"archivedChats",c.id),{chatId:c.id,deletedForMe:true,deletedAt:c.f.serverTimestamp()},{merge:true});toast2("Chat deleted from your account");( $("#backToChatsBtn")||$(".chat-back-btn")||$(".back-btn"))?.click();}
    catch(e){console.error(e);toast2(e.message||"Could not delete this chat. Check Firestore rules.");}
  }
  async function blockFlow(mode="block"){
    const c=await ctx();if(!c)throw new Error("Open a chat first.");if(c.group)throw new Error("Blocking is available for individual chats only.");
    const p=await peerProfile(c), name=p.userFullname||"this user";
    const m=modal2(mode==="report"?"Report this user":"Block "+name,`
      ${mode==="report"?`<p>Tell us what happened. Reports are private.</p>`:`<p>Blocking prevents this person from messaging or calling you.</p>`}
      <label>Reason${mode==="report"?"":" (optional)"}<select id="nxReasonType">
        ${mode==="report"?'<option value="">Choose a reason</option><option>Spam</option><option>Harassment</option><option>Impersonation</option><option>Inappropriate content</option><option>Fraud or scam</option><option>Other</option>':'<option value="">No reason</option><option>Spam</option><option>Harassment</option><option>Safety concern</option><option>Other</option>'}
      </select></label>
      <label>Additional details (optional)<textarea id="nxReason" rows="3" maxlength="1000" placeholder="Add context if you wish"></textarea></label>
      ${mode==="report"?`<button class="primary" id="nxReportOnly">Report only</button><button class="danger" id="nxReportBlock">Report and block</button><button class="danger" id="nxReportBlockDelete">Report, block and delete chat</button>`:`<button class="danger" id="nxDoBlock">Block user</button><button class="danger" id="nxDoBlockDelete">Block and delete chat</button>`}
      <button class="secondary" data-x>Cancel</button>`);
    const submitReport=async alsoBlock=>{
      const reasonType=$("#nxReasonType",m.root).value;
      if(!reasonType){toast2("Choose a report reason");return;}
      const description=$("#nxReason",m.root).value.trim();
      const report=await c.f.addDoc(c.f.collection(c.d,"reports"),{reporterUid:c.u.uid,targetUid:c.peer,targetType:"user",chatId:c.id,reason:reasonType,description:description.slice(0,1000),status:"submitted",createdAt:c.f.serverTimestamp()});
      await c.f.setDoc(c.f.doc(c.d,"user",c.u.uid,"reports",report.id),{reportId:report.id,targetUid:c.peer,reason:reasonType,createdAt:c.f.serverTimestamp()});
      if(alsoBlock)await c.f.setDoc(c.f.doc(c.d,"user",c.u.uid,"blockedUsers",c.peer),{uid:c.peer,reason:reasonType,description:description.slice(0,1000),blockedAt:c.f.serverTimestamp()});
      m.close();toast2(alsoBlock?"Report submitted and user blocked":"Report submitted");
      if(alsoBlock)blockPanel(name,true);
    };
    $("#nxReportOnly",m.root)?.addEventListener("click",async()=>{try{await submitReport(false);}catch(e){console.error(e);toast2(e.message||"Report failed. Check Firestore rules.");}});
    $("#nxReportBlock",m.root)?.addEventListener("click",async()=>{try{await submitReport(true);}catch(e){console.error(e);toast2(e.message||"Report failed. Check Firestore rules.");}});
    $("#nxReportBlockDelete",m.root)?.addEventListener("click",async()=>{try{await submitReport(true);await deleteCurrentChat();}catch(e){console.error(e);toast2(e.message||"Report/block/delete failed. Check Firestore rules.");}});
    const doBlock=async del=>{
      const reason=$("#nxReasonType",m.root).value;
      const description=$("#nxReason",m.root).value.trim();
      try{await c.f.setDoc(c.f.doc(c.d,"user",c.u.uid,"blockedUsers",c.peer),{uid:c.peer,reason:reason||"",description:description.slice(0,1000),blockedAt:c.f.serverTimestamp()});
        m.close();blockPanel(name,true);toast2(name+" blocked");
        if(del)await deleteCurrentChat();
      }catch(e){console.error(e);toast2(e.message||"Could not block user. Check Firestore rules.");}
    };
    $("#nxDoBlock",m.root)?.addEventListener("click",()=>doBlock(false));
    $("#nxDoBlockDelete",m.root)?.addEventListener("click",()=>doBlock(true));
  }
  /* ================= live chat state, shared helpers ================= */
  const ms=v=>v?.toMillis?v.toMillis():(v?(new Date(v).getTime()||0):0);
  const liveDoc=()=>window.netChatActiveChatDocId===activeId()?(window.netChatActiveChatDoc||null):null;
  const activeConv=()=>window.netChatGetActiveConversation?.()||{};
  const isGroupNow=()=>{const t=activeConv().target||{};return t.isGroup===true||t.type==="group";};
  const myName=()=>window.netChatUserData?.userFullname||authUser()?.displayName||"Someone";
  const headerName=()=>($("#chatUserName")?.textContent||"").trim()||"this contact";
  const durLabel=s=>s===86400?"24 hours":s===604800?"7 days":s===7776000?"90 days":(s?Math.round(s/3600)+" hours":"Off");
  const shortDur=s=>s===86400?"24h":s===604800?"7d":s===7776000?"90d":(s?Math.round(s/3600)+"h":"");
  const closeMenu=()=>{try{window.NXCloseChatDropdown?.();}catch{}};
  async function need(){const c=await ctx();if(!c)throw new Error("Open a chat first.");return c;}
  const chatRef=c=>c.f.doc(c.d,"chats",c.id);
  // A brand-new private chat has no chats/<id> document until its first message. Settings need one.
  async function ensureChat(c){
    if(!c.data.virtual)return c;
    const snap=await c.f.getDoc(chatRef(c));
    if(!snap.exists()){
      await c.f.setDoc(chatRef(c),{unreadCount:{[c.u.uid]:0,[c.peer]:0},participants:[c.u.uid,c.peer],lastMessage:"",lastMessageSenderId:c.u.uid,lastMessageAt:c.f.serverTimestamp(),lastMessageStatus:"sent",createdAt:c.f.serverTimestamp()});
    }
    c.data.virtual=false;return c;
  }
  async function postSystem(c,text){
    try{await c.f.addDoc(c.f.collection(c.d,"chats",c.id,"messages"),{senderId:c.u.uid,text,type:"system",timestamp:c.f.serverTimestamp(),status:"sent"});return true;}
    catch(err){console.warn("System notice could not be posted:",err);return false;}
  }
  function confirmDialog({title,text,confirmLabel="Confirm",danger=false}){
    return new Promise(resolve=>{
      const m=modal2(title,`<p>${esc(text)}</p><div class="nxm3-actions"><button type="button" class="secondary" data-x>Cancel</button><button type="button" class="${danger?"danger":"primary"}" id="nxConfirmOk">${esc(confirmLabel)}</button></div>`);
      let done=false;const fin=v=>{if(done)return;done=true;resolve(v);};
      $("#nxConfirmOk",m.root).onclick=()=>{fin(true);m.close();};
      const mo=new MutationObserver(()=>{if(!document.body.contains(m.root)){fin(false);mo.disconnect();}});mo.observe(document.body,{childList:true});
      m.root.addEventListener("click",e=>{if(e.target===m.root||e.target.closest("[data-x]"))fin(false);});
    });
  }
  function addStyle3(){
    if($("#nxm3-css"))return;
    const s=document.createElement("style");s.id="nxm3-css";s.textContent=`
      .members-btn[hidden]{display:none!important}
      .nxm3-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px}
      .nxm2 .nxm3-actions button{margin:0}
      .nxm2 .nxm3-note{color:#9eb4cc;font-size:13px;line-height:1.45;margin:10px 0}
      .nxm2 .nxm3-error{color:#ffb4bf;background:#3a1620;border:1px solid #7a2b3c;border-radius:12px;padding:10px 12px;margin:10px 0;font-size:14px}
      .nxm3-choice{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#17263b;border:1.5px solid #2c4660;color:#edf5ff;border-radius:14px;padding:13px 14px;margin:7px 0;font:inherit;transition:border-color .2s,background .2s,transform .15s}
      .nxm3-choice:active{transform:scale(.99)}
      .nxm3-choice small{display:block;color:#9eb4cc;font-size:12.5px;margin-top:2px}
      .nxm3-choice.on{border-color:#04d9ee;background:#12324a}
      .nxm3-choice .dot{margin-left:auto;width:20px;height:20px;border-radius:50%;border:2px solid #4b6580;flex:none;display:grid;place-items:center;font-size:13px;color:#03232b}
      .nxm3-choice.on .dot{background:#04d9ee;border-color:#04d9ee}.nxm3-choice.on .dot::after{content:"✓";font-weight:900}
      #nxDisBanner{margin:8px 12px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#12324a,#1a2850);border:1px solid #2f7fa0;color:#e8f5ff;font-size:14px;animation:nxFadeIn .3s ease}
      #nxDisBanner b{display:block;margin-bottom:4px}
      #nxDisBanner .row{display:flex;gap:8px;margin-top:10px}
      #nxDisBanner button{flex:1;border:0;border-radius:11px;padding:10px 12px;font-weight:800;font:inherit;font-weight:800}
      #nxDisBanner .ok{background:#04d9ee;color:#03232b}#nxDisBanner .no{background:#2a3d55;color:#eaf3ff}
      #nxDisChip{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:2px 9px;border-radius:99px;background:#12324a;border:1px solid #2f7fa0;color:#bfefff;font-size:11.5px;font-weight:700;vertical-align:middle}
      .nx-menu-state{display:block;font-size:11.5px;opacity:.65;margin-top:1px}
      @keyframes nxFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      @keyframes nxThemeIn{from{filter:brightness(.55) saturate(.7)}to{filter:none}}
      #chatMessagesBody.nx-theme-swap{animation:nxThemeIn .5s ease}
      #chatMessagesBody.nx-clearing [data-message-id],#chatMessagesBody.nx-clearing .nx-message-day{opacity:0!important;transform:translateY(-10px) scale(.97)!important;transition:opacity .28s ease,transform .28s ease!important}
      #chatMessagesBody .chat-empty-state{animation:nxFadeIn .4s ease}
      .nxt-tabs{display:flex;gap:8px;overflow-x:auto;padding:2px 0 12px;position:sticky;top:-18px;background:#101a2b;z-index:2;scrollbar-width:none}
      .nxt-tabs::-webkit-scrollbar{display:none}
      .nxt-tab{flex:none;border:1px solid #2f4a64;background:#17263b;color:#cfe3f7;border-radius:99px;padding:7px 14px;font:inherit;font-size:13px;font-weight:700;transition:all .2s}
      .nxt-tab.on{background:#04d9ee;color:#03232b;border-color:#04d9ee}
      .nxt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
      @media(min-width:640px){.nxt-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
      .nxt-card{position:relative;height:104px;border-radius:16px;border:2px solid #34506b;color:#fff;overflow:hidden;padding:0;background-size:cover;background-position:center;transition:transform .18s,border-color .2s,box-shadow .2s;text-align:left}
      .nxt-card:active{transform:scale(.97)}
      .nxt-card span.n{position:absolute;left:0;right:0;bottom:0;padding:22px 10px 8px;background:linear-gradient(transparent,rgba(0,0,0,.78));font-weight:800;font-size:13.5px;text-shadow:0 1px 3px #000}
      .nxt-card span.n small{display:block;font-weight:600;font-size:11px;opacity:.75}
      .nxt-card.on{border-color:#04d9ee;box-shadow:0 0 0 3px #04d9ee55}
      .nxt-card .chk{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:50%;background:#04d9ee;color:#03232b;font-weight:900;display:none;place-items:center}
      .nxt-card.on .chk{display:grid}
      .nxt-none{background:repeating-linear-gradient(45deg,#16202e,#16202e 10px,#1b2838 10px,#1b2838 20px)}
    `;document.head.append(s);
  }
  addStyle3();
  /* ================= members button, view contact ================= */
  function syncMembersButton(){const b=$("#groupMembersBtn");if(b)b.hidden=!isGroupNow();}
  async function viewContact(){
    const c=await need();
    if(c.group){const b=$("#groupMembersBtn");if(b&&!b.hidden)b.click();else toast2("Group info is not available for this chat.");return;}
    let profile=null;
    try{const s=await c.f.getDoc(c.f.doc(c.d,"user",c.peer));if(s.exists())profile=s.data();}catch(err){console.warn("Contact profile could not be loaded:",err);}
    if(!profile)profile=(await window.netChatGetSenderProfile?.(c.peer))||activeConv().target||{};
    // Same profile card (and fields) that opens when you tap a member inside a group.
    $("#modalUserAvatar").src=profile.profileImage||"default-avatar.png";
    $("#modalNetchatId").textContent=profile.netChatID||"";
    $("#modalUserName").textContent=profile.userFullname||"NetChat User";
    $("#modalUserBio").textContent=profile.about||"No bio available yet.";
    $("#userProfileModal")?.classList.add("active");$("#profileBackdrop")?.classList.add("active");
  }

  /* ================= mute notifications ================= */
  const isMuted=(d,uid)=>window.netChatIsChatMuted?window.netChatIsChatMuted(d||{},uid):(d?.mutedBy||[]).includes(uid);
  async function muteFlow(){
    const c=await need(),uid=c.u.uid,d=liveDoc()||c.data;
    if(isMuted(d,uid)){
      await ensureChat(c);
      await c.f.updateDoc(chatRef(c),{mutedBy:c.f.arrayRemove(uid),[`muteUntil.${uid}`]:c.f.deleteField()});
      toast2("Notifications unmuted for this chat");return;
    }
    const opts=[["1 hour",3600000],["8 hours",8*3600000],["1 week",7*86400000],["Always",null]];
    const m=modal2("Mute notifications",`<p class="nxm3-note">Only you stop receiving sounds and alerts for this chat. ${c.group?"Other members are not affected.":esc(headerName())+" is not told and is not affected."}</p>${opts.map((o,i)=>`<button type="button" class="nxm3-choice ${i===1?"on":""}" data-i="${i}"><span>${o[0]}</span><span class="dot"></span></button>`).join("")}<div class="nxm3-actions"><button class="secondary" data-x>Cancel</button><button class="primary" id="nxMuteGo">Mute</button></div>`);
    let pick=1;
    m.root.addEventListener("click",e=>{const b=e.target.closest("[data-i]");if(!b)return;pick=+b.dataset.i;$$("[data-i]",m.root).forEach(x=>x.classList.toggle("on",x===b));});
    $("#nxMuteGo",m.root).onclick=async()=>{
      const btn=$("#nxMuteGo",m.root);btn.disabled=true;btn.textContent="Saving…";
      try{
        await ensureChat(c);
        const until=opts[pick][1]===null?null:new Date(Date.now()+opts[pick][1]);
        await c.f.updateDoc(chatRef(c),{mutedBy:c.f.arrayUnion(uid),[`muteUntil.${uid}`]:until});
        m.close();toast2(pick===3?"Chat muted until you unmute it":"Chat muted for "+opts[pick][0]);
      }catch(err){console.error(err);btn.disabled=false;btn.textContent="Mute";
        let e=$(".nxm3-error",m.root);if(!e){e=document.createElement("div");e.className="nxm3-error";$(".nxm2-body",m.root).prepend(e);}e.textContent="Could not save. "+(err.code==="permission-denied"?"Deploy the updated firestore.rules and try again.":(err.message||""));}
    };
  }

  /* ================= disappearing messages ================= */
  async function respondDis(accept){
    const c=await need(),d=liveDoc()||c.data,req=d.disappearingRequest;
    if(!req||req.status!=="pending"||req.from===c.u.uid){toast2("This request is no longer active.");return;}
    if(accept){
      await c.f.updateDoc(chatRef(c),{disappearingSeconds:req.seconds,disappearingRequest:{...req,status:"accepted",respondedBy:c.u.uid,respondedAt:Date.now()}});
      await postSystem(c,`${myName()} accepted. Disappearing messages are now on for both of you (${durLabel(req.seconds)}).`);
      toast2("Disappearing messages are on for both of you");
    }else{
      await c.f.updateDoc(chatRef(c),{disappearingRequest:{...req,status:"rejected",respondedBy:c.u.uid,respondedAt:Date.now()}});
      await postSystem(c,`${myName()} declined. Disappearing messages stay on only for ${req.fromName||"the person who asked"}; the conversation continues as normal.`);
      toast2("Request declined. Your chat history is unchanged.");
    }
  }
  function renderDisState(d){
    addStyle3();
    const uid=authUser()?.uid,id=activeId();d=d||{};
    const mutual=Number(d.disappearingSeconds||0),mine=Number(d.disappearingBy?.[uid]?.seconds||0),req=d.disappearingRequest;
    // header chip
    const status=$("#chatUserStatus");let chip=$("#nxDisChip");
    const label=mutual?`⏱ ${shortDur(mutual)} · both`:(mine?`⏱ ${shortDur(mine)} · only you${req&&req.status==="pending"&&req.from===uid?" · waiting":""}`:"");
    if(label&&status){if(!chip){chip=document.createElement("span");chip.id="nxDisChip";status.parentElement.append(chip);}chip.textContent=label;chip.title=mutual?"Disappearing messages are on for both of you":"Disappearing messages are on only for you";}
    else chip?.remove();
    // request banner for the other person
    let banner=$("#nxDisBanner");
    const pending=req&&req.status==="pending"&&req.from!==uid&&!isGroupNow()&&Number(req.seconds)>0;
    if(!pending){banner?.remove();}
    else{
      const body=$("#chatMessagesBody");
      if(body?.parentElement){
        if(!banner){banner=document.createElement("div");banner.id="nxDisBanner";body.parentElement.insertBefore(banner,body);}
        const sig=req.createdAt+"|"+req.seconds;
        if(banner.dataset.sig!==sig){
          banner.dataset.sig=sig;
          banner.innerHTML=`<b>⏱ ${esc(req.fromName||headerName())} wants to enable disappearing messages for this conversation</b>Messages will disappear after <b style="display:inline">${durLabel(req.seconds)}</b> for both of you. You can keep chatting either way.<div class="row"><button type="button" class="ok" id="nxDisAccept">✓ Accept</button><button type="button" class="no" id="nxDisReject">Reject</button></div>`;
          const go=async(a,btn)=>{banner.querySelectorAll("button").forEach(b=>b.disabled=true);try{await respondDis(a);}catch(err){console.error(err);toast2(err.code==="permission-denied"?"Could not respond. Deploy the updated firestore.rules.":(err.message||"Could not respond"));banner.querySelectorAll("button").forEach(b=>b.disabled=false);}};
          $("#nxDisAccept",banner).onclick=()=>go(true);$("#nxDisReject",banner).onclick=()=>go(false);
        }
      }
    }
    // tell the requester what the other person decided (once)
    if(req&&req.from===uid&&(req.status==="rejected"||req.status==="accepted")&&id){
      const key=`nx:disack:${id}:${req.createdAt}:${req.status}`;
      try{if(!localStorage.getItem(key)){localStorage.setItem(key,"1");
        toast2(req.status==="accepted"?`${headerName()} accepted. Disappearing messages are on for both of you (${durLabel(req.seconds)}).`:`${headerName()} declined. Disappearing messages stay on only for you.`);}}catch{}
    }
  }
  function syncMenuLabels(){
    const d=liveDoc()||{},uid=authUser()?.uid;
    const items=$$("#mainMenuView .menu-item");
    const set=(li,icon,text,state)=>{const html=`<span class="material-symbols-outlined">${icon}</span> ${text}${state?`<span class="nx-menu-state">${state}</span>`:""}`;if(li.dataset.nxSig!==html){li.dataset.nxSig=html;li.innerHTML=html;}};
    const mute=items.find(li=>/^notifications/.test(li.querySelector(".material-symbols-outlined")?.textContent.trim()||""));
    if(mute){const m=isMuted(d,uid);const until=d.muteUntil?.[uid];const u=ms(until);set(mute,m?"notifications_active":"notifications_off",m?"Unmute notifications":"Mute notifications",m?(u?"Muted until "+new Date(u).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"Muted"):"");}
    const dis=items.find(li=>li.querySelector(".material-symbols-outlined")?.textContent.trim()==="timer");
    if(dis){const mu=Number(d.disappearingSeconds||0),mi=Number(d.disappearingBy?.[uid]?.seconds||0);set(dis,"timer","Disappearing messages",mu?durLabel(mu)+" · both of you":(mi?durLabel(mi)+" · only you":"Off"));}
  }
  async function disappearingFlow(){
    const c=await need(),uid=c.u.uid,d=liveDoc()||c.data;
    const group=c.group,admin=group&&((d.admins||[]).includes(uid)||d.createdBy===uid);
    const mutual=Number(d.disappearingSeconds||0),mine=Number(d.disappearingBy?.[uid]?.seconds||0),req=d.disappearingRequest;
    const opts=[[0,"Off","Messages stay in the chat"],[86400,"24 hours","New messages disappear after 24 hours"],[604800,"7 days","New messages disappear after 7 days"],[7776000,"90 days","New messages disappear after 90 days"]];
    let seconds=mutual||mine,scope="me";
    const statusLine=mutual?`On for <b>both</b> of you: ${durLabel(mutual)}.`:(mine?`On <b>only for you</b>: ${durLabel(mine)}.`:"Currently off.")+(req&&req.status==="pending"&&req.from===uid?` Waiting for ${esc(headerName())} to accept.`:"");
    const m=modal2("Disappearing messages",`<p class="nxm3-note" style="margin-top:0">${statusLine}</p>
      ${opts.map(o=>`<button type="button" class="nxm3-choice ${o[0]===seconds?"on":""}" data-s="${o[0]}"><span>${o[1]}<small>${o[2]}</small></span><span class="dot"></span></button>`).join("")}
      ${group?`<p class="nxm3-note">Who should this apply to?</p>
        <button type="button" class="nxm3-choice on" data-scope="me"><span>Only me<small>Messages disappear from your view only. Everyone is told you turned it on.</small></span><span class="dot"></span></button>
        ${admin?`<button type="button" class="nxm3-choice" data-scope="all"><span>Everyone in this group (admin)<small>New messages expire for all members. Members are notified.</small></span><span class="dot"></span></button>`:`<p class="nxm3-note">Only group admins can set a timer for the whole group.</p>`}`
      :`<p class="nxm3-note">It starts for you right away. ${esc(headerName())} gets a request to turn it on for both of you. If they decline, it stays on only for you and nothing about their chat changes. You can keep chatting either way.</p>`}
      <div class="nxm3-actions"><button class="secondary" data-x>Cancel</button><button class="primary" id="nxDisGo">Apply</button></div>`);
    m.root.addEventListener("click",e=>{
      const s=e.target.closest("[data-s]");if(s){seconds=+s.dataset.s;$$("[data-s]",m.root).forEach(x=>x.classList.toggle("on",x===s));}
      const sc=e.target.closest("[data-scope]");if(sc){scope=sc.dataset.scope;$$("[data-scope]",m.root).forEach(x=>x.classList.toggle("on",x===sc));}
    });
    $("#nxDisGo",m.root).onclick=async()=>{
      const btn=$("#nxDisGo",m.root);btn.disabled=true;btn.textContent="Saving…";
      try{
        await ensureChat(c);
        const name=myName(),label=durLabel(seconds);
        if(group&&scope==="all"){
          if(!admin)throw new Error("Only admins can change the group timer.");
          await c.f.updateDoc(chatRef(c),{disappearingSeconds:seconds});
          await postSystem(c,seconds?`${name} turned on disappearing messages for everyone. New messages will disappear after ${label}.`:`${name} turned off disappearing messages for everyone.`);
        }else if(!seconds){
          if(!mine&&!mutual){m.close();toast2("Disappearing messages are already off");return;}
          const patch={[`disappearingBy.${uid}`]:{seconds:0,since:Date.now()}};
          if(!group&&mutual>0)patch.disappearingSeconds=0;
          if(!group&&req&&req.status==="pending"&&req.from===uid)patch.disappearingRequest={...req,status:"cancelled"};
          await c.f.updateDoc(chatRef(c),patch);
          await postSystem(c,`${name} turned off disappearing messages.`);
        }else if(group){
          await c.f.updateDoc(chatRef(c),{[`disappearingBy.${uid}`]:{seconds,since:Date.now()}});
          await postSystem(c,`${name} turned on disappearing messages for their own view (${label}).`);
        }else{
          if(mutual===seconds&&mine===seconds){m.close();toast2("Already on for both of you");return;}
          const patch={[`disappearingBy.${uid}`]:{seconds,since:Date.now()}};
          if(mutual!==seconds)patch.disappearingRequest={from:uid,fromName:name,seconds,status:"pending",createdAt:Date.now()};
          await c.f.updateDoc(chatRef(c),patch);
          await postSystem(c,mutual&&mutual!==seconds?`${name} wants to change disappearing messages to ${label}. Waiting for ${headerName()} to accept.`:`${name} has turned on disappearing messages (${label}). ${headerName()} can accept to turn it on for both of you.`);
        }
        m.close();toast2(seconds?(scope==="all"?"Disappearing messages set for the group":"Disappearing messages on: "+label):"Disappearing messages turned off");
      }catch(err){
        console.error(err);btn.disabled=false;btn.textContent="Apply";
        let e=$(".nxm3-error",m.root);if(!e){e=document.createElement("div");e.className="nxm3-error";$(".nxm2-body",m.root).prepend(e);}
        e.textContent="Could not save. "+(err.code==="permission-denied"?"Deploy the updated firestore.rules (included in the zip) and try again.":(err.message||""));
      }
    };
  }

  /* ================= clear chat (only for me) ================= */
  async function clearChatFlow(){
    const c=await need();
    const ok=await confirmDialog({title:"Clear chat?",text:"Are you sure you want to clear this chat? This action cannot be undone.",confirmLabel:"Clear Chat",danger:true});
    if(!ok)return;
    const body=$("#chatMessagesBody");body?.classList.add("nx-clearing");
    try{
      await ensureChat(c);
      const lastId=(liveDoc()||{}).lastMessageId||"";
      await Promise.all([c.f.updateDoc(chatRef(c),{[`clearedFor.${c.u.uid}`]:c.f.serverTimestamp(),[`hiddenLastMessageFor.${c.u.uid}`]:lastId,[`unreadCount.${c.u.uid}`]:0}),sleep(300)]);
      toast2(c.group?"Chat cleared for you. Other members still have their history.":"Chat cleared for you. "+headerName()+" still has their history.");
    }catch(err){body?.classList.remove("nx-clearing");throw err;}
    finally{setTimeout(()=>body?.classList.remove("nx-clearing"),450);}
  }

  /* ================= report ================= */
  const reporting=new Set();
  async function reportFlow(){
    const c=await need(),group=c.group,name=group?(c.data.groupName||headerName()):headerName();
    const m=modal2(group?"Report this group":"Report "+name,`<p class="nxm3-note" style="margin-top:0">Reports are private and reviewed by the NetChat team. ${group?"":"The other person is not told."}</p>
      <label>Reason<select id="nxRepReason"><option value="">Choose a reason</option><option>Spam</option><option>Harassment or bullying</option><option>Impersonation</option><option>Inappropriate content</option><option>Hate or violence</option><option>Fraud or scam</option><option>Other</option></select></label>
      <label>Additional details<textarea id="nxRepDetails" rows="3" maxlength="900" placeholder="What happened? (required for Other)"></textarea></label>
      ${group?"":`<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="nxRepBlock" style="width:auto;margin:0"> Also block ${esc(name)}</label>`}
      <div class="nxm3-actions"><button class="secondary" data-x>Cancel</button><button class="danger" id="nxRepGo">Submit report</button></div>`);
    $("#nxRepGo",m.root).onclick=async()=>{
      const btn=$("#nxRepGo",m.root),reason=$("#nxRepReason",m.root).value,details=$("#nxRepDetails",m.root).value.trim();
      const err=t=>{let e=$(".nxm3-error",m.root);if(!e){e=document.createElement("div");e.className="nxm3-error";$(".nxm2-body",m.root).prepend(e);}e.textContent=t;};
      if(!reason)return err("Choose a reason for the report.");
      if(reason==="Other"&&!details)return err("Please describe what happened.");
      const key=`nx:reported:${c.u.uid}:${c.id}`;
      if(reporting.has(key))return;
      try{const last=+localStorage.getItem(key)||0;if(Date.now()-last<10*60*1000)return err("You already reported this conversation a moment ago. Our team has it.");}catch{}
      reporting.add(key);btn.disabled=true;btn.textContent="Submitting…";
      try{
        const targetUid=group?c.id:c.peer;
        const ref=await c.f.addDoc(c.f.collection(c.d,"reports"),{reporterUid:c.u.uid,targetUid,targetType:group?"group":"user",targetName:name,chatId:c.id,conversationId:c.id,reason,description:details.slice(0,900),status:"submitted",createdAt:c.f.serverTimestamp()});
        await c.f.setDoc(c.f.doc(c.d,"user",c.u.uid,"reports",ref.id),{reportId:ref.id,targetUid,targetType:group?"group":"user",reason,createdAt:c.f.serverTimestamp()}).catch(e=>console.warn("Report receipt not saved:",e));
        try{localStorage.setItem(key,String(Date.now()));}catch{}
        let blocked=false;
        if(!group&&$("#nxRepBlock",m.root)?.checked){await c.f.setDoc(c.f.doc(c.d,"user",c.u.uid,"blockedUsers",c.peer),{uid:c.peer,reason,blockedAt:c.f.serverTimestamp()});blocked=true;}
        m.close();toast2(blocked?"Report submitted and user blocked":"Report submitted. Thank you.");
        if(blocked)refreshBlockState();
      }catch(e){console.error(e);err("Your report was NOT submitted. "+(e.code==="permission-denied"?"Permission denied: deploy the updated firestore.rules.":(e.message||"Please try again.")));btn.disabled=false;btn.textContent="Submit report";}
      finally{reporting.delete(key);}
    };
  }
  async function searchMessages(){
    const c=await ctx();
    const m=modal2("Search messages",`<input id="nxMsgQuery" type="search" placeholder="Search in this conversation…" autocomplete="off"><div id="nxMsgResults" class="nxm2-results"><p>Enter a word or phrase to search this conversation.</p></div>`);
    const input=$("#nxMsgQuery",m.root), results=$("#nxMsgResults",m.root);let timer;
    input.focus();
    input.addEventListener("input",()=>{
      clearTimeout(timer);timer=setTimeout(async()=>{
        const q=input.value.trim().toLowerCase();if(q.length<2){results.innerHTML="<p>Type at least 2 characters.</p>";return;}
        results.innerHTML="<p>Searching…</p>";
        try{
          const snap=await c.f.getDocs(c.f.collection(c.d,"chats",c.id,"messages"));
          const found=snap.docs.map(doc=>({id:doc.id,...doc.data()})).filter(x=>String(x.text||x.caption||"").toLowerCase().includes(q)).sort((a,b)=>(b.timestamp?.toMillis?.()||0)-(a.timestamp?.toMillis?.()||0)).slice(0,80);
          if(!found.length){results.innerHTML="<p>No matching messages found.</p>";return;}
          const peer=await peerProfile(c);
          results.innerHTML=found.map(x=>{const sender=x.senderId===c.u.uid?"You":(peer.userFullname||"Other participant");return `<button class="nxm2-result" data-mid="${esc(x.id)}"><span>${esc(String(x.text||x.caption||"Message").slice(0,240))}</span><small>${esc(sender)} · ${esc(x.timestamp?.toDate?.().toLocaleString?.()||x.createdAt?.toDate?.().toLocaleString?.()||"Time unavailable")}</small></button>`;}).join("");
        }catch(e){console.error(e);results.innerHTML="<p>Search failed. Check your connection and Firestore message-read permissions.</p>";}
      },250);
    });
    results.addEventListener("click",e=>{
      const b=e.target.closest("[data-mid]");if(!b)return;
      const node=document.querySelector(`[data-message-id="${CSS.escape(b.dataset.mid)}"]`)||document.getElementById("message-"+b.dataset.mid);
      if(!node){toast2("Message found, but it is not currently loaded in the conversation. Scroll/load older messages first.");return;}
      m.close();node.scrollIntoView({behavior:"smooth",block:"center"});node.classList.add("nx-search-hit");setTimeout(()=>node.classList.remove("nx-search-hit"),2600);
    });
  }
  const themeData=[
    ["None",""],
    ["AMOLED Black","linear-gradient(145deg,#000000,#090909,#000000)"],
    ["Midnight Blue","linear-gradient(145deg,#06152b,#102b50,#07101f)"],
    ["Purple Galaxy","radial-gradient(circle at 20% 15%,#6b35a8 0,transparent 38%),radial-gradient(circle at 85% 80%,#173b79 0,transparent 42%),#090817"],
    ["Deep Space","linear-gradient(145deg,#07111f,#182b50,#080d1a)"],["Northern Lights","linear-gradient(145deg,#071d2b,#174f55,#30234f)"],
    ["Obsidian Glass","linear-gradient(145deg,#050608,#242a36,#0b0d12)"],["Sakura Night","linear-gradient(145deg,#25101e,#63334f,#171323)"],
    ["Royal Amethyst","linear-gradient(145deg,#140d2d,#49317b,#11152d)"],["Emerald Forest","linear-gradient(145deg,#071b17,#174b3c,#0b1518)"],
    ["Ocean Depths","linear-gradient(145deg,#061b2a,#07506a,#101d3b)"],["Desert Dusk","linear-gradient(145deg,#281b18,#78513c,#211626)"],
    ["Neon City","linear-gradient(145deg,#10102b,#263c70,#451c55)"],["Rose Gold","linear-gradient(145deg,#281a20,#744b52,#201723)"],
    ["Arctic Aurora","linear-gradient(145deg,#10232b,#4c7180,#17263a)"],["Crimson Velvet","linear-gradient(145deg,#240b13,#681f36,#1c111b)"]
  ];
  /* Photo themes: a photo (Unsplash, sized for phones) sits under a dark overlay for readable text,
     and a pure-CSS scene sits underneath as the fallback if the photo cannot load. */
  const PHOTO=id=>`https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=60`;
  const DARK="rgba(3,10,22,.50),rgba(3,10,22,.50)";
  const T=(name,cat,scene,photo,tint)=>({name,cat,photo:photo||"",bg:photo?`linear-gradient(${tint||DARK}),url("${PHOTO(photo)}"),${scene}`:scene});
  const ALL_THEMES=[
    ...themeData.map(([name,bg])=>({name,bg,cat:"Classic",photo:""})),
    /* Nature */
    T("Tropical Paradise","Nature","linear-gradient(180deg,#0b6e8f 0%,#12a3a8 40%,#2c8c7e 70%,#c9a35f 100%)","photo-1507525428034-b723cf961d3e"),
    T("Mountain Serenity","Nature","linear-gradient(180deg,#26405e 0%,#4d6f8f 45%,#8fa6b4 70%,#2a3a45 100%)","photo-1464822759023-fed622ff2c3b"),
    T("Enchanted Forest","Nature","radial-gradient(circle at 30% 20%,rgba(120,255,170,.25),transparent 40%),radial-gradient(circle at 75% 70%,rgba(80,200,255,.18),transparent 45%),linear-gradient(160deg,#04140f,#0d3b2a,#06100c)","photo-1448375240586-882707db888b"),
    T("Waterfall Dreams","Nature","linear-gradient(180deg,#0d3a35,#2b7d73 45%,#a6d8d0 55%,#144a45)","photo-1433086966358-54859d0ed716"),
    T("Sunset Paradise","Nature","linear-gradient(180deg,#2b1445 0%,#c2456a 38%,#ff9a52 62%,#3a2036 100%)","photo-1495616811223-4d98c6e9c869","rgba(15,5,25,.38),rgba(15,5,25,.38)"),
    T("Cherry Blossom Garden","Nature","radial-gradient(circle at 20% 20%,rgba(255,183,210,.45),transparent 40%),radial-gradient(circle at 80% 60%,rgba(255,140,185,.30),transparent 45%),linear-gradient(160deg,#3a1b30,#6e3a58,#2a1626)","photo-1522383225653-ed111181a951","rgba(30,8,22,.48),rgba(30,8,22,.48)"),
    T("Rainforest","Nature","radial-gradient(circle at 70% 20%,rgba(120,255,120,.2),transparent 40%),linear-gradient(160deg,#021a0b,#0a4a21 50%,#0b2e17)","photo-1536431311719-398b6704d4cc"),
    T("Blue Lagoon","Nature","linear-gradient(180deg,#0aa9c9,#0b6fb0 50%,#08305f)","photo-1505228395891-9a51e7e86bf6"),
    T("Golden Autumn","Nature","linear-gradient(160deg,#3b1d08,#a85a14 45%,#5b2a0b)","photo-1477414348463-c0eb7f1359b6","rgba(25,10,2,.45),rgba(25,10,2,.45)"),
    T("Moonlit Lake","Nature","radial-gradient(circle at 75% 15%,rgba(235,240,255,.55) 0,rgba(235,240,255,.1) 9%,transparent 22%),linear-gradient(180deg,#050b1f,#122a52 55%,#0a1a33)","photo-1501785888041-af3ef285b470","rgba(3,8,30,.62),rgba(3,8,30,.62)"),
    T("Flower Garden","Nature","radial-gradient(circle at 25% 30%,#ff6fa5aa,transparent 30%),radial-gradient(circle at 70% 25%,#ffc14faa,transparent 28%),radial-gradient(circle at 55% 75%,#b06cffaa,transparent 32%),linear-gradient(160deg,#10301b,#1b5a2d)","photo-1490750967868-88aa4486c946"),
    T("Wildflower Meadow","Nature","radial-gradient(circle at 20% 80%,#ffd54a99,transparent 30%),radial-gradient(circle at 80% 70%,#ff7ab899,transparent 30%),linear-gradient(180deg,#3d6fa5,#7fb0a0 45%,#2e5a2c)","photo-1490806843957-31f4c9a91c65"),
    T("Snowy Mountains","Nature","linear-gradient(180deg,#27425f,#8fb2cf 50%,#e8f1f8 62%,#5d7b94)","photo-1483728642387-6c3bdd6c93e5","rgba(5,15,30,.55),rgba(5,15,30,.55)"),
    T("Ocean Sunset","Nature","linear-gradient(180deg,#27135a,#d2476f 35%,#ff9a4d 50%,#0e4b78 52%,#08284a)","photo-1473116763249-2faaef81ccda","rgba(12,6,30,.42),rgba(12,6,30,.42)"),
    T("Cloud Heaven","Nature","radial-gradient(ellipse at 30% 25%,rgba(255,255,255,.55),transparent 45%),radial-gradient(ellipse at 75% 60%,rgba(255,255,255,.35),transparent 50%),linear-gradient(180deg,#4b8fd6,#86b8ee 55%,#3b6fb0)","photo-1534088568595-a066f410bcda","rgba(8,24,52,.50),rgba(8,24,52,.50)"),
    T("Misty Morning","Nature","linear-gradient(180deg,#1d3a3a,#4f7a73 50%,#9bb5ad)","photo-1470071459604-3b5ec3a7fe05"),
    T("Lavender Fields","Nature","linear-gradient(180deg,#3b2a63,#7a5ab5 55%,#2c1f4d)","photo-1499002238440-d264edd596ec","rgba(18,8,38,.45),rgba(18,8,38,.45)"),
    T("Desert Dunes","Nature","linear-gradient(180deg,#3a1f12,#c07a3c 50%,#6a3b1c)","","") ,
    /* Sky */
    T("Golden Sunrise","Sky","radial-gradient(circle at 50% 85%,#ffd27a 0,#ff9a4d 22%,transparent 55%),linear-gradient(180deg,#1b2a5c,#7a4a7d 55%,#e58a4f)"),
    T("Twilight Sky","Sky","radial-gradient(circle at 20% 10%,rgba(255,255,255,.18) 0 2px,transparent 3px),linear-gradient(180deg,#0e1240,#3a2a7a 50%,#d4607e)"),
    T("Stormy Dusk","Sky","radial-gradient(ellipse at 30% 30%,rgba(255,255,255,.12),transparent 45%),linear-gradient(180deg,#1a2230,#3c4a5e 55%,#6b5a63)"),
    /* Space */
    T("Nebula Dream","Space","radial-gradient(circle at 25% 25%,rgba(255,80,200,.45),transparent 40%),radial-gradient(circle at 75% 65%,rgba(70,120,255,.45),transparent 45%),radial-gradient(circle at 50% 100%,rgba(140,60,255,.35),transparent 50%),#060616","photo-1462331940025-496dfbfc7564","rgba(3,3,20,.45),rgba(3,3,20,.45)"),
    T("Milky Way","Space","radial-gradient(ellipse at 50% 45%,rgba(180,170,255,.35),transparent 55%),linear-gradient(180deg,#02030c,#0a1030 60%,#04060f)","photo-1419242902214-272b3f66ee7a","rgba(2,4,15,.40),rgba(2,4,15,.40)"),
    T("Cosmic Dust","Space","radial-gradient(circle at 80% 20%,rgba(255,170,90,.35),transparent 40%),radial-gradient(circle at 15% 80%,rgba(120,90,255,.35),transparent 45%),#0a0814"),
    T("Supernova","Space","radial-gradient(circle at 50% 40%,rgba(255,240,200,.55) 0,rgba(255,120,60,.35) 14%,rgba(160,40,120,.25) 35%,transparent 60%),#07040d"),
    /* Luxury */
    T("Black & Gold","Luxury","linear-gradient(135deg,#070707 0%,#2a2110 45%,#070707 60%,#3a2c12 100%)"),
    T("Champagne Silk","Luxury","linear-gradient(135deg,#2a241c,#6e5c3f 45%,#2a2319 70%,#8a7550)"),
    T("Emerald Royale","Luxury","radial-gradient(circle at 20% 20%,rgba(212,175,55,.25),transparent 35%),linear-gradient(145deg,#04231b,#0c5a43 50%,#04170f)"),
    T("Platinum Noir","Luxury","linear-gradient(145deg,#0d0e12,#3a3d47 45%,#15161b 70%,#4a4e5a)"),
    /* Romantic */
    T("Rose Petals","Romantic","radial-gradient(circle at 15% 25%,rgba(255,120,160,.40),transparent 38%),radial-gradient(circle at 85% 75%,rgba(220,60,110,.35),transparent 42%),linear-gradient(160deg,#2a0d1a,#5e1f3a)"),
    T("Love Letter","Romantic","linear-gradient(160deg,#3a1d26,#8a4a58 55%,#4a2230)"),
    T("Twilight Romance","Romantic","radial-gradient(circle at 80% 15%,rgba(255,200,220,.35),transparent 30%),linear-gradient(180deg,#1b1240,#6a2f72 55%,#d46a8a)"),
    T("Peach Blush","Romantic","linear-gradient(160deg,#3a2020,#b0605a 55%,#5a2f35)"),
    /* Futuristic */
    T("Cyber Grid","Futuristic","repeating-linear-gradient(0deg,rgba(0,240,255,.10) 0 1px,transparent 1px 38px),repeating-linear-gradient(90deg,rgba(0,240,255,.10) 0 1px,transparent 1px 38px),linear-gradient(180deg,#050816,#0b1030)"),
    T("Neon Horizon","Futuristic","radial-gradient(ellipse at 50% 100%,rgba(255,60,200,.55),transparent 55%),radial-gradient(ellipse at 50% 80%,rgba(60,200,255,.30),transparent 60%),linear-gradient(180deg,#070516,#1a0b3a)"),
    T("Hologram","Futuristic","linear-gradient(125deg,rgba(0,255,220,.20),rgba(120,80,255,.25) 40%,rgba(255,80,200,.20) 70%,rgba(0,200,255,.20)),#06101f"),
    T("Frosted Glass","Futuristic","radial-gradient(circle at 20% 20%,rgba(120,200,255,.30),transparent 40%),radial-gradient(circle at 80% 80%,rgba(180,140,255,.28),transparent 45%),linear-gradient(145deg,#0f1a2c,#1d2c47)"),
    /* Minimal */
    T("Slate","Minimal","linear-gradient(180deg,#1b2129,#232b36)"),
    T("Graphite","Minimal","linear-gradient(180deg,#16181b,#202327)"),
    T("Mocha","Minimal","linear-gradient(180deg,#221b17,#2f251f)"),
    T("Pine Fog","Minimal","linear-gradient(180deg,#14201d,#1e2f2a)"),
    /* Artistic */
    T("Abstract Waves","Artistic","radial-gradient(ellipse at 0% 50%,rgba(0,200,255,.35),transparent 55%),radial-gradient(ellipse at 100% 30%,rgba(255,80,160,.35),transparent 55%),radial-gradient(ellipse at 50% 110%,rgba(120,80,255,.35),transparent 60%),#0a0d1c"),
    T("Watercolor Bloom","Artistic","radial-gradient(circle at 25% 30%,rgba(255,150,120,.38),transparent 38%),radial-gradient(circle at 70% 25%,rgba(120,180,255,.34),transparent 40%),radial-gradient(circle at 55% 80%,rgba(160,255,190,.28),transparent 42%),#141622"),
    T("Pop Geometry","Artistic","repeating-linear-gradient(45deg,rgba(255,200,0,.10) 0 18px,transparent 18px 36px),repeating-linear-gradient(-45deg,rgba(255,60,120,.10) 0 18px,transparent 18px 36px),#101428"),
    T("Stained Glass","Artistic","conic-gradient(from 30deg at 50% 50%,#3b1d6e,#0b5f8a,#0a7a5a,#8a6a0b,#8a2a3a,#3b1d6e)")
  ];
  const THEME_CATS=["All","Nature","Sky","Space","Luxury","Romantic","Futuristic","Minimal","Artistic","Classic"];
  const themeByName=n=>ALL_THEMES.find(t=>t.name===n);
  const thumbBg=t=>t.bg.replace("w=900&q=60","w=260&q=45");
  // Newest choice wins: the cloud copy follows you across devices, the local copy is instant on this one.
  const savedTheme=()=>{
    const id=activeId();if(!id)return null;
    const cloud=(liveDoc()?.chatThemeBy||{})[authUser()?.uid]||null;
    let local=null;try{local=JSON.parse(localStorage.getItem("nx:chatTheme:"+id)||"null");}catch{}
    if(cloud&&local)return String(local.updatedAt||"")>String(cloud.updatedAt||"")?local:cloud;
    return cloud||local;
  };
  function paintTheme(saved){
    const b=$("#chatMessagesBody"),id=activeId();if(!b||!id)return;
    const named=saved&&themeByName(saved.name);
    const bg=saved?(saved.image?`url("${saved.image}")`:(named?named.bg:(saved.bg||""))):"";
    const key=id+"|"+(saved?.name||"None")+"|"+(saved?.image||"");
    if(b.dataset.nxThemeKey===key)return;
    b.dataset.nxThemeKey=key;
    if(!bg||saved?.name==="None"){["backgroundImage","backgroundRepeat","backgroundPosition","backgroundSize","backgroundColor"].forEach(k=>b.style[k]="");b.classList.remove("nx-themed");return;}
    b.classList.add("nx-themed");
    b.style.backgroundImage=bg;b.style.backgroundRepeat="no-repeat";b.style.backgroundPosition="center center";b.style.backgroundSize="cover";b.style.backgroundColor="#08101c";
    b.classList.remove("nx-theme-swap");void b.offsetWidth;b.classList.add("nx-theme-swap");setTimeout(()=>b.classList.remove("nx-theme-swap"),600);
  }
  function applySavedTheme(){paintTheme(savedTheme());}
  async function chooseTheme(){
    const c=await need();
    const cur=()=>savedTheme()?.name||"None";let cat="All";
    const m=modal2("Chat theme",`<p class="nxm3-note" style="margin-top:0">These themes apply only to this conversation. Global themes belong in Settings.</p><div class="nxt-tabs" id="nxTabs">${THEME_CATS.map(k=>`<button type="button" class="nxt-tab ${k===cat?"on":""}" data-cat="${k}">${k}</button>`).join("")}</div><div class="nxt-grid" id="nxGrid"></div>
      <p style="margin:18px 0 4px"><b>Or use your own wallpaper</b></p><input type="file" id="nxWall" accept="image/jpeg,image/png,image/webp"><img id="nxWallPreview" hidden alt="Wallpaper preview" style="max-width:100%;border-radius:12px;margin-bottom:10px"><button class="primary" id="nxUseWall" type="button">Use this wallpaper</button>`);
    const grid=$("#nxGrid",m.root);
    const draw=()=>{
      const list=ALL_THEMES.filter(t=>cat==="All"||t.cat===cat),sel=cur();
      grid.innerHTML=list.map(t=>`<button type="button" class="nxt-card ${t.name==="None"?"nxt-none":""} ${t.name===sel?"on":""}" data-theme="${esc(t.name)}" style="${t.bg?`background-image:${esc(thumbBg(t)).replace(/&quot;/g,"'")};background-size:cover;background-position:center`:""}" aria-pressed="${t.name===sel}"><span class="chk">✓</span><span class="n">${esc(t.name)}<small>${esc(t.name==="None"?"Default look":t.cat)}</small></span></button>`).join("");
    };
    draw();
    $("#nxTabs",m.root).addEventListener("click",e=>{const b=e.target.closest("[data-cat]");if(!b)return;cat=b.dataset.cat;$$(".nxt-tab",m.root).forEach(x=>x.classList.toggle("on",x===b));draw();});
    let busy=false;
    grid.addEventListener("click",async e=>{
      const b=e.target.closest("[data-theme]");if(!b||busy)return;
      const t=themeByName(b.dataset.theme);if(!t)return;
      const entry={name:t.name,bg:t.bg,updatedAt:new Date().toISOString()};
      try{localStorage.setItem("nx:chatTheme:"+c.id,JSON.stringify(entry));}catch{}
      const prev=window.netChatActiveChatDoc;paintTheme(entry);draw();   // instant, then sync
      busy=true;
      try{await ensureChat(c);await c.f.updateDoc(chatRef(c),{[`chatThemeBy.${c.u.uid}`]:entry});toast2(t.name==="None"?"Theme reset to the default look":t.name+" theme applied to this chat");}
      catch(err){console.error(err);toast2(err.code==="permission-denied"?"Theme applied on this device only. Deploy the updated firestore.rules to sync it.":"Theme applied on this device only");}
      finally{busy=false;}
    });
    $("#nxWall",m.root).addEventListener("change",()=>{
      const file=$("#nxWall",m.root).files?.[0],preview=$("#nxWallPreview",m.root);if(!file||!preview)return;
      if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>5*1024*1024){preview.hidden=true;return toast2("Choose a JPG, PNG or WebP image under 5 MB");}
      if(preview.dataset.previewUrl)URL.revokeObjectURL(preview.dataset.previewUrl);
      preview.dataset.previewUrl=URL.createObjectURL(file);preview.src=preview.dataset.previewUrl;preview.hidden=false;
    });
    $("#nxUseWall",m.root).onclick=async()=>{
      const file=$("#nxWall",m.root).files?.[0];if(!file)return toast2("Choose an image first");
      if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>5*1024*1024)return toast2("Choose a JPG, PNG or WebP image under 5 MB");
      const btn=$("#nxUseWall",m.root);btn.disabled=true;btn.textContent="Uploading…";
      try{
        const form=new FormData();form.append("file",file);form.append("upload_preset","My_NetChat_profile");
        const response=await fetch("https://api.cloudinary.com/v1_1/haludoui/image/upload",{method:"POST",body:form});
        if(!response.ok)throw new Error("Wallpaper upload failed ("+response.status+")");
        const result=await response.json();if(!result.secure_url)throw new Error("Upload service did not return an image URL");
        const entry={name:"My wallpaper",image:result.secure_url,updatedAt:new Date().toISOString()};
        localStorage.setItem("nx:chatTheme:"+c.id,JSON.stringify(entry));paintTheme(entry);
        await ensureChat(c);await c.f.updateDoc(chatRef(c),{[`chatThemeBy.${c.u.uid}`]:entry});
        m.close();toast2("Your wallpaper is applied to this chat");
      }catch(err){console.error(err);toast2(err.message||"Could not apply wallpaper");btn.disabled=false;btn.textContent="Use this wallpaper";}
    };
  }
  function makeZip(files){
    const enc=new TextEncoder(),parts=[],central=[];let offset=0;
    const u16=n=>[n&255,(n>>>8)&255],u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
    const crcTable=makeZip.crc||(makeZip.crc=(()=>{let t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})());
    const crc=b=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
    for(const [name,content] of files){
      const n=enc.encode(name),d=(content instanceof Uint8Array?content:enc.encode(content)),sum=crc(d),head=new Uint8Array([0x50,0x4b,0x03,0x04,...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(sum),...u32(d.length),...u32(d.length),...u16(n.length),...u16(0),...n]);
      parts.push(head,d);
      const ch=new Uint8Array([0x50,0x4b,0x01,0x02,...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(sum),...u32(d.length),...u32(d.length),...u16(n.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...n]);central.push(ch);offset+=head.length+d.length;
    }
    const csize=central.reduce((s,x)=>s+x.length,0),end=new Uint8Array([0x50,0x4b,0x05,0x06,...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(csize),...u32(offset),...u16(0)]);
    const total=parts.reduce((n,x)=>n+x.length,0)+csize+end.length;
    const output=new Uint8Array(total);let cursor=0;
    for(const part of parts){output.set(part,cursor);cursor+=part.length;}
    for(const part of central){output.set(part,cursor);cursor+=part.length;}
    output.set(end,cursor);
    return output;
  }
  let nxInstallPrompt=null;
  window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();nxInstallPrompt=event;});
  /* ================= export ================= */
  const safeUrl=u=>/^https?:\/\//i.test(String(u||""))?String(u):"";
  function visibleDocs(c,docs){
    const d=liveDoc()||c.data||{},uid=c.u.uid,cleared=ms(d.clearedFor?.[uid]);
    const pers=d.disappearingBy?.[uid]||{},pMs=Number(pers.seconds||0)*1000,pSince=Number(pers.since||0);
    return docs.filter(x=>{const m=x.data(),t=ms(m.timestamp),e=ms(m.expiresAt);
      return !(Array.isArray(m.hiddenFor)&&m.hiddenFor.includes(uid))&&!(e&&e<=Date.now())&&!(cleared&&t&&t<=cleared)&&!(pMs&&t&&t>=pSince&&t+pMs<=Date.now());
    }).sort((a,b)=>ms(a.data().timestamp)-ms(b.data().timestamp));
  }
  async function collectExport(c){
    const snap=await c.f.getDocs(c.f.collection(c.d,"chats",c.id,"messages"));
    const docs=visibleDocs(c,snap.docs),names=new Map([[c.u.uid,"You"]]);
    if(!c.group){const p=await peerProfile(c);names.set(c.peer,p.userFullname||"Contact");}
    for(const x of docs){const sid=x.data().senderId;if(sid&&!names.has(sid)){try{names.set(sid,(await window.netChatGetSenderProfile?.(sid))?.userFullname||"NetChat user");}catch{names.set(sid,"NetChat user");}}}
    const rows=docs.map(x=>{const m=x.data();return {id:x.id,senderId:m.senderId||"",sender:names.get(m.senderId)||"NetChat user",mine:m.senderId===c.u.uid,time:ms(m.timestamp),system:m.type==="system",deleted:!!m.deleted,text:m.deleted?"":String(m.text||""),
      media:(Array.isArray(m.media)?m.media:[]).map(a=>({url:safeUrl(a.url||a.secure_url),type:a.resourceType||"file",name:a.fileName||a.name||""})).filter(a=>a.url),
      poll:m.poll?{question:String(m.poll.question||""),options:(m.poll.options||[]).map(o=>typeof o==="string"?o:(o?.text||o?.label||""))}:null};});
    const title=c.group?(c.data.groupName||headerName()):(names.get(c.peer)||headerName());
    return {title,rows};
  }
  function buildHTML({title,rows,me}){
    const fmtDay=t=>t?new Date(t).toLocaleDateString([],{weekday:"long",year:"numeric",month:"long",day:"numeric"}):"Unknown date";
    const fmtT=t=>t?new Date(t).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"";
    let body="",day="";
    for(const r of rows){
      const dd=fmtDay(r.time);if(dd!==day){day=dd;body+=`<div class="day"><span>${esc(dd)}</span></div>`;}
      if(r.system){body+=`<div class="sys">${esc(r.text)}</div>`;continue;}
      const media=r.media.map(a=>a.type==="image"?`<a href="${esc(a.url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(a.url)}" alt="${esc(a.name||"Photo")}"></a>`:a.type==="video"?`<video controls preload="none" src="${esc(a.url)}"></video>`:a.type==="audio"?`<audio controls preload="none" src="${esc(a.url)}"></audio>`:`<a class="file" href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.name||"Attachment")}</a>`).join("");
      const poll=r.poll?`<div class="poll"><b>📊 ${esc(r.poll.question)}</b>${r.poll.options.map(o=>`<div>• ${esc(o)}</div>`).join("")}</div>`:"";
      body+=`<div class="msg ${r.mine?"me":"them"}"><div class="bub">${r.mine?"":`<div class="who">${esc(r.sender)}</div>`}${r.deleted?`<i>This message was deleted</i>`:esc(r.text).replace(/\n/g,"<br>")}${poll}${media}<div class="t">${esc(fmtT(r.time))}</div></div></div>`;
    }
    const css=`:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0a1220;color:#e9f2ff;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}header{position:sticky;top:0;background:#0e1a2e;border-bottom:1px solid #223b55;padding:16px 18px;z-index:2}header h1{margin:0;font-size:19px}header p{margin:3px 0 0;color:#8fa9c4;font-size:13px}main{max-width:820px;margin:0 auto;padding:18px 12px 60px}.day{text-align:center;margin:22px 0 12px}.day span{background:#16263c;color:#9fb8d3;border-radius:99px;padding:5px 14px;font-size:12px}.sys{text-align:center;color:#8fa9c4;font-size:12.5px;margin:10px 20px}.msg{display:flex;margin:5px 0}.msg.me{justify-content:flex-end}.bub{max-width:min(78%,560px);padding:9px 12px 6px;border-radius:16px;word-wrap:break-word;overflow-wrap:anywhere}.me .bub{background:linear-gradient(135deg,#0b6f86,#0a4d8f);border-bottom-right-radius:5px}.them .bub{background:#16263c;border:1px solid #243c57;border-bottom-left-radius:5px}.who{font-size:12px;font-weight:700;color:#62d8ed;margin-bottom:2px}.t{font-size:11px;color:#a8c0d8;text-align:right;margin-top:3px;opacity:.8}img,video{max-width:100%;border-radius:10px;margin-top:6px;display:block}audio{width:100%;margin-top:6px}a{color:#7be3f5}.file{display:inline-block;margin-top:6px}.poll{margin-top:6px;background:#0003;border-radius:10px;padding:8px 10px}footer{text-align:center;color:#6f89a4;font-size:12px;padding:24px}@media print{body{background:#fff;color:#000}.bub{border:1px solid #bbb;background:#fff!important}header{position:static}}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · NetChat export</title><style>${css}</style></head><body><header><h1>${esc(title)}</h1><p>NetChat conversation export for ${esc(me)} · ${rows.length} item${rows.length===1?"":"s"} · exported ${esc(new Date().toLocaleString())}</p></header><main>${body||'<p style="text-align:center;color:#8fa9c4">No messages to export.</p>'}</main><footer>Contains only messages visible to ${esc(me)} at the time of export.</footer></body></html>`;
  }
  const slug=s=>String(s||"chat").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40)||"chat";
  function offerDownload(m,blob,filename,openable){
    const url=URL.createObjectURL(blob);
    m.root.querySelector(".nxm2-body").innerHTML=`<p>✅ Your export is ready (${(blob.size/1024).toFixed(blob.size>1048576?0:1)} KB).</p><p class="nxm3-note">If the download did not start automatically, tap the button below.</p><div class="nxm3-actions"><a class="primary" id="nxDl" href="${url}" download="${esc(filename)}" style="text-decoration:none;border-radius:12px;padding:12px 16px;font-weight:700;background:#08cfe3;color:#05202b">Download ${esc(filename.split(".").pop().toUpperCase())}</a>${openable?`<a class="secondary" href="${url}" target="_blank" rel="noopener" style="text-decoration:none;border-radius:12px;padding:12px 16px;font-weight:700;background:#263a52;color:#eaf3ff">Open in browser</a>`:""}<button class="secondary" data-x>Close</button></div>`;
    const a=document.createElement("a");a.href=url;a.download=filename;a.style.display="none";document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10*60*1000);
  }
  async function exportFlow(){
    const c=await need();
    const m=modal2("Export chat",`<p class="nxm3-note" style="margin-top:0">Exports only the messages you can see in this chat (cleared or disappeared messages are not included).</p>
      <button type="button" class="nxm3-choice" data-fmt="html"><span>Readable web page (.html)<small>One file that opens in any browser. Photos and videos load from their links.</small></span></button>
      <button type="button" class="nxm3-choice" data-fmt="zip"><span>ZIP package<small>HTML page + JSON data + downloaded attachments (up to 20 MB).</small></span></button>
      <div class="nxm3-actions"><button class="secondary" data-x>Cancel</button></div>`);
    m.root.addEventListener("click",async e=>{
      const b=e.target.closest("[data-fmt]");if(!b)return;
      const fmt=b.dataset.fmt;$$("[data-fmt]",m.root).forEach(x=>x.disabled=true);
      const note=document.createElement("p");note.className="nxm3-note";note.textContent="Preparing your export…";$(".nxm2-body",m.root).prepend(note);
      try{
        const data=await collectExport(c),html=buildHTML({title:data.title,rows:data.rows,me:myName()});
        if(fmt==="html"){offerDownload(m,new Blob([html],{type:"text/html;charset=utf-8"}),`netchat-${slug(data.title)}.html`,true);return;}
        const files=[["conversation.html",html],["messages.json",JSON.stringify({app:"NetChat",chatId:c.id,exportedAt:new Date().toISOString(),title:data.title,messages:data.rows},null,2)]];
        const media=data.rows.flatMap(r=>r.media.map(a=>({messageId:r.id,...a})));let bytes=0,count=0;const index=[];
        for(let i=0;i<media.length;i++){
          const it=media[i];note.textContent=`Preparing your export… attachment ${i+1} of ${media.length}`;
          let path=null;
          try{const resp=await fetch(it.url,{mode:"cors"});if(resp.ok){const buf=new Uint8Array(await resp.arrayBuffer());if(bytes+buf.length<=20*1024*1024){const nm=String(it.name||`attachment-${i+1}`).replace(/[^a-z0-9._-]/gi,"_").slice(0,80);path=`media/${String(i+1).padStart(3,"0")}-${nm}`;files.push([path,buf]);bytes+=buf.length;count++;}}}catch{}
          index.push({...it,archivePath:path});
        }
        files.push(["media-index.json",JSON.stringify(index,null,2)]);
        offerDownload(m,new Blob([makeZip(files)],{type:"application/zip"}),`netchat-${slug(data.title)}.zip`,false);
        if(media.length&&count<media.length)toast2(`${count} of ${media.length} attachments were included; the rest are linked in media-index.json (the host blocked direct download).`);
      }catch(err){console.error(err);note.remove();$$("[data-fmt]",m.root).forEach(x=>x.disabled=false);let er=document.createElement("div");er.className="nxm3-error";er.textContent="Export failed: "+(err.code==="permission-denied"?"permission denied reading messages.":(err.message||"unknown error"));$(".nxm2-body",m.root).prepend(er);}
    });
  }

  /* ================= add shortcut ================= */
  const chatLink=id=>`${location.origin}${location.pathname}?chat=${encodeURIComponent(id)}`;
  async function shortcutFlow(){
    const c=await need();
    const link=chatLink(c.id),canInstall=!!(nxInstallPrompt||window.netChatDeferredInstallPrompt);
    // Make the address bar point at this chat so the browser's own "Add to Home screen" saves a shortcut to it.
    try{history.replaceState(null,"",`${location.pathname}?chat=${encodeURIComponent(c.id)}`);}catch{}
    let known=[];try{known=JSON.parse(localStorage.getItem("nx:shortcuts")||"[]");}catch{}
    const already=known.includes(c.id);
    const ua=navigator.userAgent,ios=/iPad|iPhone|iPod/.test(ua),android=/Android/.test(ua);
    const how=ios?"In Safari tap <b>Share</b> → <b>Add to Home Screen</b>.":android?"In your browser tap the <b>⋮ menu</b> → <b>Add to Home screen</b> (or <b>Install app</b>).":"In your browser's menu choose <b>Install NetChat</b> / <b>Add to Home screen</b> (Chrome: address-bar install icon).";
    const m=modal2("Add shortcut",`<p class="nxm3-note" style="margin-top:0">Browsers do not let a website add an icon to your home screen by itself, so there are two real options:</p>
      ${already?`<p class="nxm3-note">You already created a shortcut for this chat on this device.</p>`:""}
      ${canInstall?`<button class="primary" id="nxInstall" style="width:100%;margin:6px 0">Install NetChat app</button>`:""}
      <p style="margin:12px 0 4px"><b>Home-screen shortcut to this chat</b></p><p class="nxm3-note" style="margin-top:0">${how} This page's address now points straight to this conversation, so the shortcut opens it.</p>
      <p style="margin:12px 0 4px"><b>Chat link</b></p><input id="nxLink" readonly value="${esc(link)}">
      <div class="nxm3-actions"><button class="secondary" data-x>Close</button><button class="primary" id="nxCopy">Copy link</button></div>`);
    const remember=()=>{if(!known.includes(c.id)){known.push(c.id);try{localStorage.setItem("nx:shortcuts",JSON.stringify(known));}catch{}}};
    $("#nxCopy",m.root).onclick=async()=>{try{await navigator.clipboard.writeText(link);}catch{const i=$("#nxLink",m.root);i.select();document.execCommand?.("copy");}remember();toast2("Chat link copied");};
    $("#nxInstall",m.root)?.addEventListener("click",async()=>{const ev=nxInstallPrompt||window.netChatDeferredInstallPrompt;try{await ev.prompt();const r=await ev.userChoice;nxInstallPrompt=null;window.netChatDeferredInstallPrompt=null;if(r?.outcome==="accepted"){remember();toast2("NetChat installation started");m.close();}}catch(err){toast2("Use your browser menu → Install app / Add to Home screen.");}});
  }
  // Open the chat named in ?chat=<id> (used by shortcuts and copied chat links).
  function openChatFromLink(){
    const id=new URLSearchParams(location.search).get("chat");if(!id)return;
    let tries=0;const timer=setInterval(async()=>{
      if(++tries>80){clearInterval(timer);return;}
      const u=authUser(),open=window.netChatOpenConversation,d=db();if(!u?.uid||!open||!d)return;
      clearInterval(timer);
      try{
        const f=await fb(),snap=await f.getDoc(f.doc(d,"chats",id)),data=snap.exists()?snap.data():null;
        if(data&&!(data.participants||[]).includes(u.uid)){toast2("That chat link is not for your account.");return;}
        const group=!!data&&(data.isGroup===true||data.type==="group");
        if(group){await open({...data,uid:id,isGroup:true,userFullname:data.groupName||data.name||"Group chat",profileImage:data.groupImage||"",groupName:data.groupName||data.name||"Group chat"},id,{});return;}
        const peer=(data?.participants||id.split("_")).find(x=>x&&x!==u.uid);if(!peer||!id.includes(u.uid))return;
        const ps=await f.getDoc(f.doc(d,"user",peer));if(!ps.exists())return;
        await open({...ps.data(),uid:peer,isGroup:false},id,{});
      }catch(err){console.warn("Could not open the linked chat:",err);}
    },500);
  }

  /* ================= add to list ================= */
  async function addToList(){
    const c=await need(),listsCol=c.f.collection(c.d,"user",c.u.uid,"chatLists");
    let lists=(await c.f.getDocs(listsCol)).docs.map(x=>({id:x.id,...x.data()})).filter(x=>typeof x.name==="string");
    const inList=x=>[...(x.conversationIds||[]),...(x.chats||[])].includes(c.id);
    const m=modal2("Add chat to a list","");let busy=false;
    const draw=()=>{$(".nxm2-body",m.root).innerHTML=`${lists.length?lists.map(x=>`<button type="button" class="nxm3-choice ${inList(x)?"on":""}" data-list="${esc(x.id)}"><span>${esc(x.name)}<small>${(new Set([...(x.conversationIds||[]),...(x.chats||[])])).size} chat${(new Set([...(x.conversationIds||[]),...(x.chats||[])])).size===1?"":"s"}${inList(x)?" · this chat is in the list (tap to remove)":""}</small></span><span class="dot"></span></button>`).join(""):`<p class="nxm3-note" style="margin-top:0">You have no lists yet. Create one below.</p>`}
      <label>Create a new list<input id="nxNewList" maxlength="60" placeholder="e.g. Work, Family, Friends"></label><div class="nxm3-actions"><button class="secondary" data-x>Done</button><button class="primary" id="nxMakeList">Create and add</button></div>`;};
    draw();
    m.root.addEventListener("click",async e=>{
      if(busy)return;
      const b=e.target.closest("[data-list]"),mk=e.target.closest("#nxMakeList");
      try{
        if(b){busy=true;const x=lists.find(l=>l.id===b.dataset.list);
          if(inList(x)){await c.f.updateDoc(c.f.doc(c.d,"user",c.u.uid,"chatLists",x.id),{conversationIds:c.f.arrayRemove(c.id),chats:c.f.arrayRemove(c.id),updatedAt:c.f.serverTimestamp()});x.conversationIds=(x.conversationIds||[]).filter(i=>i!==c.id);x.chats=(x.chats||[]).filter(i=>i!==c.id);toast2(`Removed from “${x.name}”`);}
          else{await c.f.updateDoc(c.f.doc(c.d,"user",c.u.uid,"chatLists",x.id),{conversationIds:c.f.arrayUnion(c.id),updatedAt:c.f.serverTimestamp()});x.conversationIds=[...(x.conversationIds||[]),c.id];toast2(`Added to “${x.name}”`);}
          draw();
        }else if(mk){
          const name=$("#nxNewList",m.root).value.trim();if(!name)return toast2("Enter a name for the new list");
          busy=true;const dupe=lists.find(l=>l.name.trim().toLowerCase()===name.toLowerCase());
          if(dupe){if(!inList(dupe)){await c.f.updateDoc(c.f.doc(c.d,"user",c.u.uid,"chatLists",dupe.id),{conversationIds:c.f.arrayUnion(c.id),updatedAt:c.f.serverTimestamp()});dupe.conversationIds=[...(dupe.conversationIds||[]),c.id];}toast2(`Added to “${dupe.name}”`);}
          else{const ref=await c.f.addDoc(listsCol,{name,conversationIds:[c.id],createdAt:c.f.serverTimestamp(),updatedAt:c.f.serverTimestamp()});lists.push({id:ref.id,name,conversationIds:[c.id]});toast2(`List “${name}” created and chat added`);}
          draw();
        }
      }catch(err){console.error(err);toast2(err.code==="permission-denied"?"Could not save the list: deploy the updated firestore.rules.":(err.message||"Could not update the list"));}
      finally{busy=false;}
    });
  }
  async function mediaHub(){
    const c=await ctx(),snap=await c.f.getDocs(c.f.collection(c.d,"chats",c.id,"messages"));
    const all=snap.docs.map(d=>({id:d.id,...d.data()}));
    const items=all.flatMap(m=>(Array.isArray(m.media)?m.media:[]).map(a=>({...a,messageId:m.id,senderId:m.senderId})));
    const linkPattern=/https?:\/\/[^\s<>"']+/g;
    all.forEach(m=>String(m.text||"").match(linkPattern)?.forEach((url,i)=>items.push({type:"link",url,name:url,messageId:m.id,senderId:m.senderId,linkIndex:i})));
    const m=modal2("Media, links and documents",`<div style="display:flex;gap:7px;flex-wrap:wrap"><button class="secondary" data-filter="all">All</button><button class="secondary" data-filter="image">Photos</button><button class="secondary" data-filter="video">Videos</button><button class="secondary" data-filter="audio">Audio</button><button class="secondary" data-filter="file">Documents</button><button class="secondary" data-filter="link">Links</button></div><label style="display:flex;align-items:center;gap:8px;margin:12px 0"><input id="nxMediaSelectAll" type="checkbox" style="width:auto"> Select all</label><div id="nxMediaItems" class="nxm2-results"></div><p><span id="nxMediaCount">0 selected</span></p><button class="primary" id="nxMediaDownload">Download selected</button>`);
    let filter="all";
    const draw=()=>{
      const arr=items.filter(x=>{const type=String(x.resourceType||x.type||x.mime||"").toLowerCase();return filter==="all"||(filter==="image"&&type.includes("image"))||(filter==="video"&&type.includes("video"))||(filter==="audio"&&type.includes("audio"))||(filter==="file"&&!/image|video|audio/.test(type))||(filter==="link"&&/^https?:/.test(x.url||""));});
      $("#nxMediaItems",m.root).innerHTML=arr.length?arr.map((x,i)=>`<label class="nxm2-result" style="display:flex;gap:9px;align-items:center"><input type="checkbox" data-media-index="${items.indexOf(x)}" style="width:auto"><span>${esc(x.fileName||x.name||x.filename||x.resourceType||x.type||"Attachment")}<small>${esc(x.url||x.secure_url||"")}</small></span></label>`).join(""):"<p>No matching media in this conversation.</p>";
      $("#nxMediaCount",m.root).textContent="0 selected";
    };
    m.root.addEventListener("click",e=>{const b=e.target.closest("[data-filter]");if(b){filter=b.dataset.filter;draw();}});
    m.root.addEventListener("change",e=>{if(e.target.matches("[data-media-index],#nxMediaSelectAll")){const checks=$$("[data-media-index]",m.root);if(e.target.id==="nxMediaSelectAll")checks.forEach(x=>x.checked=e.target.checked);$("#nxMediaCount",m.root).textContent=checks.filter(x=>x.checked).length+" selected";}});
    $("#nxMediaDownload",m.root).onclick=()=>{const selected=$$("[data-media-index]:checked",m.root).map(x=>items[+x.dataset.mediaIndex]);if(!selected.length)return toast2("Select at least one item");selected.forEach((x,i)=>{const u=x.url||x.secure_url;if(!u)return;const a=document.createElement("a");a.href=u;a.download=x.name||`netchat-media-${i+1}`;a.target="_blank";a.click();});};
    draw();
  }
  const MAIN_ACTIONS={person:viewContact,groups:viewContact,notifications_off:muteFlow,notifications_active:muteFlow,timer:disappearingFlow,search:searchMessages,perm_media:mediaHub,palette:chooseTheme};
  const MORE_ACTIONS={report:reportFlow,block:()=>blockFlow("block"),delete_sweep:clearChatFlow,output:exportFlow,shortcut:shortcutFlow,playlist_add:addToList};
  // One capture-phase dispatcher per submenu: it replaces the older prompt()-based handlers in script.js,
  // so each action runs exactly once.
  const dispatch=(map,root)=>document.addEventListener("click",async e=>{
    const li=e.target.closest(root+" .menu-item");if(!li)return;
    const icon=li.querySelector(".material-symbols-outlined")?.textContent.trim(),fn=map[icon];if(!fn)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();closeMenu();
    try{await fn();}catch(err){console.error("NetChat chat action failed:",err);toast2(err.message||"Action failed. Check your connection and Firestore permissions.");}
  },true);
  dispatch(MAIN_ACTIONS,"#mainMenuView");dispatch(MORE_ACTIONS,"#moreMenuView");
  // Remove accidental interception of the submenu's back navigation and main-menu actions.
  const observer=new MutationObserver(()=>{applySavedTheme();});
  const chatBody=$("#chatMessagesBody");if(chatBody)observer.observe(chatBody,{childList:true});
  window.addEventListener("netchat:conversation-opened",()=>{$("#nxDisBanner")?.remove();$("#nxDisChip")?.remove();syncMembersButton();applySavedTheme();syncMenuLabels();refreshBlockState();watchBlockState();});
  window.addEventListener("netchat:chatdoc",()=>{syncMembersButton();applySavedTheme();syncMenuLabels();renderDisState(liveDoc()||{});});
  window.addEventListener("netchat:group-open",syncMembersButton);window.addEventListener("netchat:private-open",syncMembersButton);
  openChatFromLink();
  setTimeout(()=>{applySavedTheme();if(activeId())refreshBlockState();},900);
  window.NXChatManagement={refreshBlockState,unblockCurrent,deleteCurrentChat,exportChat:exportFlow,searchMessages,muteFlow,disappearingFlow,clearChatFlow};
})();

