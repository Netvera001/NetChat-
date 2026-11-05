/* Clippardy keyboard-style media picker bridge.
   Reuses the existing composer and message media pipeline. */
(() => {
  if (window.__clippardyEmojiBridgeInstalled) return;
  window.__clippardyEmojiBridgeInstalled = true;
  let panel = null, composer = null, originalStyle = null, input = null;
  let caretStart = 0, caretEnd = 0, pickerPromise = null, outsideHandler = null;
  let activeTab = 'emoji', gifFiles = [];
  const $ = (s, root = document) => root.querySelector(s);
  const STORAGE_KEY = 'clippardy.personalStickers.v1';
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function rememberCaret() {
    if (!input || document.activeElement !== input) return;
    caretStart = input.selectionStart ?? input.value.length;
    caretEnd = input.selectionEnd ?? caretStart;
  }
  function layout() {
    if (!panel || !composer) return;
    const vv = window.visualViewport;
    const vh = vv?.height || window.innerHeight;
    const bottomGap = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
    const panelHeight = Math.max(270, Math.min(vh * .56, 480));
    panel.style.height = `${panelHeight}px`;
    panel.style.bottom = `${bottomGap}px`;
    composer.style.setProperty('position','fixed','important');
    composer.style.setProperty('left','10px','important');
    composer.style.setProperty('right','10px','important');
    composer.style.setProperty('width','auto','important');
    composer.style.setProperty('bottom',`${panelHeight + bottomGap + 8}px`,'important');
    composer.style.setProperty('z-index','15021','important');
    composer.style.setProperty('margin','0','important');
    composer.style.setProperty('box-sizing','border-box','important');
  }
  function close() {
    if (!panel) return;
    document.removeEventListener('pointerdown', outsideHandler, true);
    panel.remove(); panel = null; outsideHandler = null;
    if (composer) {
      if (originalStyle === null) composer.removeAttribute('style');
      else composer.setAttribute('style', originalStyle);
      composer.classList.remove('clippardy-picker-composer');
    }
    composer = null; originalStyle = null;
    $('#emojiBtn')?.setAttribute('aria-expanded','false');
  }
  function insertEmoji(emoji) {
    if (!input?.isConnected) return;
    const value = input.value, a = Math.max(0,Math.min(caretStart,value.length)), b = Math.max(a,Math.min(caretEnd,value.length));
    input.value = value.slice(0,a) + emoji + value.slice(b);
    caretStart = caretEnd = a + emoji.length;
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function composerAdd(files) {
    const accepted = window.netChatSetComposerMedia?.(files, {append:true});
    if (!accepted) {
      const fileInput = $('#chatMediaInput') || $('input[type="file"][multiple]');
      if (fileInput && files[0]) {
        try { const dt = new DataTransfer(); [...(fileInput.files||[])].forEach(f=>dt.items.add(f)); files.forEach(f=>dt.items.add(f)); fileInput.files=dt.files; fileInput.dispatchEvent(new Event('change',{bubbles:true})); }
        catch(e) { console.error('Could not add media to composer',e); }
      } else { alert('The existing chat media composer is unavailable.'); return false; }
    }
    return !!accepted;
  }
  function readStickers(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]').filter(x=>x&&x.data&&x.name); } catch { return []; } }
  function saveStickerFile(file){
    if (!file || !file.type.startsWith('image/')) { alert('Choose an image file for a sticker.'); return; }
    if (file.size > 8*1024*1024) { alert('Please choose an image smaller than 8 MB.'); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas=document.createElement('canvas'), scale=Math.min(1,512/Math.max(img.width,img.height));
      canvas.width=Math.max(1,Math.round(img.width*scale)); canvas.height=Math.max(1,Math.round(img.height*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height); URL.revokeObjectURL(url);
      const data=canvas.toDataURL('image/webp',.86), stickers=readStickers();
      stickers.unshift({id:`s_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,name:file.name.replace(/\.[^.]+$/,'').slice(0,40)||'My sticker',data,createdAt:Date.now()});
      try { localStorage.setItem(STORAGE_KEY,JSON.stringify(stickers.slice(0,60))); renderStickers(); }
      catch(e){ alert('Device storage is full. Remove some saved stickers and try again.'); }
    };
    img.onerror=()=>{URL.revokeObjectURL(url);alert('This image could not be opened.');}; img.src=url;
  }
  function renderStickers(){
    const host=$('.clippardy-media-view',panel); if(!host)return;
    const items=readStickers();
    host.innerHTML=`<div class="clippardy-media-actions"><label class="clippardy-media-action">＋ Add sticker<input class="clippardy-file-input" type="file" accept="image/*"></label><small>Saved on this device</small></div><div class="clippardy-sticker-grid">${items.map(x=>`<div class="clippardy-sticker-item"><button type="button" class="clippardy-sticker-send" data-sticker="${escapeHtml(x.id)}" aria-label="Send ${escapeHtml(x.name)}"><img src="${x.data}" alt="${escapeHtml(x.name)}"></button><button type="button" class="clippardy-sticker-delete" data-delete-sticker="${escapeHtml(x.id)}" aria-label="Delete sticker">×</button></div>`).join('')||'<p class="clippardy-empty">No personal stickers yet. Add an image to start your collection.</p>'}</div>`;
    $('.clippardy-file-input',host)?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)saveStickerFile(f);});
    host.querySelectorAll('[data-sticker]').forEach(b=>b.addEventListener('click',()=>{const item=readStickers().find(x=>x.id===b.dataset.sticker);if(!item)return;fetch(item.data).then(r=>r.blob()).then(blob=>{const f=new File([blob],`${item.name}.webp`,{type:'image/webp'});composerAdd([f]);}).catch(()=>alert('Could not prepare this sticker.'));}));
    host.querySelectorAll('[data-delete-sticker]').forEach(b=>b.addEventListener('click',()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(readStickers().filter(x=>x.id!==b.dataset.deleteSticker)));renderStickers();}));
  }
  function renderGifs(){
    const host=$('.clippardy-media-view',panel); if(!host)return;
    host.innerHTML=`<div class="clippardy-gif-intro"><div class="clippardy-gif-icon">GIF</div><b>Send a GIF from your phone</b><p>Choose an animated GIF file from your gallery. Online GIF search needs a configured provider API key.</p><label class="clippardy-media-action">＋ Choose GIF<input class="clippardy-file-input" type="file" accept="image/gif,.gif"></label></div><div class="clippardy-gif-list">${gifFiles.map((f,i)=>`<button type="button" class="clippardy-gif-file" data-gif-index="${i}">${escapeHtml(f.name)}</button>`).join('')}</div>`;
    $('.clippardy-file-input',host)?.addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>15*1024*1024){alert('Please choose a GIF smaller than 15 MB.');return;}gifFiles.unshift(f);renderGifs();});
    host.querySelectorAll('[data-gif-index]').forEach(b=>b.addEventListener('click',()=>{const f=gifFiles[Number(b.dataset.gifIndex)];if(f)composerAdd([f]);}));
  }
  async function loadEmoji(wrap){
    wrap.innerHTML='<div class="clippardy-emoji-status"><span class="clippardy-emoji-spinner"></span><b>Loading emoji library</b><small>Loading searchable Unicode emoji catalogue…</small></div>';
    try{
      if(!pickerPromise) pickerPromise=import('https://cdn.jsdelivr.net/npm/emoji-picker-element@1/index.js').catch(err=>{pickerPromise=null;throw err;});
      await pickerPromise; if(!panel?.isConnected)return;
      const picker=document.createElement('emoji-picker'); picker.className='clippardy-native-emoji-picker'; picker.setAttribute('locale','en');
      picker.addEventListener('emoji-click',e=>{if(e.detail?.unicode)insertEmoji(e.detail.unicode);});
      wrap.replaceChildren(picker);
    }catch(err){console.error('Clippardy emoji library load failed',err);if(!panel?.isConnected)return;wrap.innerHTML='<div class="clippardy-emoji-status"><b>Could not load emojis</b><small>Check your internet connection and retry.</small><button type="button" class="clippardy-emoji-retry">Retry</button></div>';$('.clippardy-emoji-retry',wrap)?.addEventListener('click',()=>{pickerPromise=null;loadEmoji(wrap);});}
  }
  function switchTab(tab){
    activeTab=tab; panel.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
    const host=$('.clippardy-picker-mount',panel); host.innerHTML='';
    if(tab==='emoji'){host.innerHTML='<div class="clippardy-emoji-mount"></div>';loadEmoji($('.clippardy-emoji-mount',host));}
    else {host.innerHTML='<div class="clippardy-media-view"></div>';if(tab==='gif')renderGifs();else renderStickers();}
  }
  function open(){
    input=$('#messageInput'); if(!input)return;
    if(panel){close();return;}
    composer=input.closest('.chat-input-bar'); if(!composer)return;
    originalStyle=composer.getAttribute('style'); caretStart=input.selectionStart??input.value.length;caretEnd=input.selectionEnd??caretStart;input.blur();
    panel=document.createElement('section');panel.className='clippardy-keyboard-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Emoji GIF and sticker picker');
    panel.innerHTML=`<div class="clippardy-keyboard-grabber"><span></span></div><div class="clippardy-keyboard-toolbar"><button type="button" class="clippardy-picker-search-icon" aria-label="Search emojis">⌕</button><div class="clippardy-picker-tabs" role="tablist"><button type="button" data-tab="emoji" role="tab" aria-selected="true" class="active">☺ <span>Emoji</span></button><button type="button" data-tab="gif" role="tab" aria-selected="false">GIF</button><button type="button" data-tab="stickers" role="tab" aria-selected="false">▢ <span>Stickers</span></button></div><button type="button" class="clippardy-picker-close" aria-label="Close picker">×</button></div><div class="clippardy-picker-content"><div class="clippardy-picker-mount"></div></div>`;
    document.body.appendChild(panel);composer.classList.add('clippardy-picker-composer');$('#emojiBtn')?.setAttribute('aria-expanded','true');layout();
    $('.clippardy-picker-close',panel).addEventListener('click',close);
    panel.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
    $('.clippardy-picker-search-icon',panel).addEventListener('click',()=>{const search=panel.querySelector('emoji-picker')?.shadowRoot?.querySelector('input[type="search"],input');search?.focus();});
    outsideHandler=e=>{if(panel&&!panel.contains(e.target)&&!composer?.contains(e.target))close();};document.addEventListener('pointerdown',outsideHandler,true);
    switchTab('emoji');
  }
  document.addEventListener('click',e=>{if(!e.target.closest?.('#emojiBtn'))return;e.preventDefault();e.stopImmediatePropagation();open();},true);
  document.addEventListener('pointerdown',e=>{if(panel&&e.target.closest?.('#messageInput'))close();},true);
  document.addEventListener('selectionchange',rememberCaret);
  window.addEventListener('resize',layout);window.addEventListener('orientationchange',()=>requestAnimationFrame(layout));window.visualViewport?.addEventListener('resize',layout);
})();
