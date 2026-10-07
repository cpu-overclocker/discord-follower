(async () => {
  // 🔪 Kill toutes les instances précédentes
  if (window.__dcfInstances) {
    for (const inst of window.__dcfInstances) {
      try {
        if (inst.pollTimer) clearInterval(inst.pollTimer);
        if (inst.guildCheckTimer) clearInterval(inst.guildCheckTimer);
        if (inst.ui?.remove) inst.ui.remove();
        if (inst.style?.remove) inst.style.remove();
      } catch {}
    }
  }
  window.__dcfInstances = [];

  if (document.getElementById('dc-follow-ui')) {
    document.getElementById('dc-follow-ui').remove();
    document.getElementById('dc-follow-style')?.remove();
  }

  let CACHE = null, CACHE_SIZE = 0;
  for (let i = 0; i < 5; i++) {
    try {
      webpackChunkdiscord_app.push([[Symbol('p'+i)], {}, (r) => {
        if (r?.c) {
          const s = Object.keys(r.c).length;
          if (s > CACHE_SIZE) { CACHE = r.c; CACHE_SIZE = s; }
        }
      }]);
    } catch {}
  }
  if (!CACHE || CACHE_SIZE < 1000) { alert('[Follow] Cache insuffisant'); return; }
  console.log('[Follow] Cache:', CACHE_SIZE, 'modules');

  let MY_ID = null;
  for (const id in CACHE) {
    try {
      const e = CACHE[id]?.exports;
      const obj = e?.default ?? e;
      if (obj && typeof obj.getCurrentUser === 'function') {
        const me = obj.getCurrentUser();
        if (me?.id && /^\d{17,20}$/.test(me.id)) { MY_ID = me.id; break; }
      }
    } catch {}
  }
  const TEST_ID = MY_ID || '0';
  console.log('[Follow] Mon ID:', TEST_ID);

  function findStore(methodName, validator) {
    const candidates = [];
    for (const id in CACHE) {
      try {
        const e = CACHE[id]?.exports;
        if (!e) continue;
        const test = (obj, path) => {
          if (!obj || typeof obj !== 'object') return;
          if ('locale' in obj && 'ast' in obj) return;
          let hasFn = false;
          try { hasFn = typeof obj[methodName] === 'function'; } catch {}
          if (!hasFn) return;
          if (validator) { try { if (!validator(obj)) return; } catch { return; } }
          const methods = new Set();
          let cur = obj, depth = 0;
          while (cur && cur !== Object.prototype && depth < 3) {
            for (const k of Object.getOwnPropertyNames(cur)) {
              try { if (typeof obj[k] === 'function') methods.add(k); } catch {}
            }
            cur = Object.getPrototypeOf(cur);
            depth++;
          }
          candidates.push({ id, path, obj, methods: methods.size });
        };
        test(e, 'exports');
        if (e.default) test(e.default, 'exports.default');
        for (const k of Object.keys(e)) {
          if (k === 'default') continue;
          try { test(e[k], 'exports.' + k); } catch {}
        }
      } catch {}
    }
    candidates.sort((a, b) => b.methods - a.methods);
    return candidates[0]?.obj ?? null;
  }

  const VoiceStore = findStore('getVoiceStateForUser', (obj) => {
    const bad = obj.getVoiceStateForUser('__nonexistent__');
    if (bad && (bad.locale || bad.ast)) return false;
    const vs = obj.getVoiceStateForUser(TEST_ID);
    if (vs === null || vs === undefined) return true;
    if (vs && typeof vs === 'object' && !vs.locale && !vs.ast) return true;
    return false;
  });
  console.log('[Follow] VoiceStore:', !!VoiceStore);

  const ChannelStore = findStore('getChannelIds', (obj) => {
    if (typeof obj.getChannel !== 'function') return false;
    if (typeof obj.getDMFromUserId !== 'function') return false;
    try {
      const ids = obj.getChannelIds('__invalid__');
      if (ids && (ids.locale || ids.ast)) return false;
    } catch {}
    return true;
  });
  console.log('[Follow] ChannelStore:', !!ChannelStore);

  const UserStore = findStore('getUser', (obj) => {
    if (typeof obj.getCurrentUser !== 'function') return false;
    const me = obj.getCurrentUser();
    return !!(me?.id && me?.username);
  });
  console.log('[Follow] UserStore:', !!UserStore);

  const GuildStore = findStore('getGuild', (obj) => {
    if (typeof obj.getGuilds !== 'function') return false;
    if (typeof obj.getGuild !== 'function') return false;
    try {
      const g = obj.getGuild('__invalid__');
      if (g && (g.locale || g.ast)) return false;
    } catch {}
    return true;
  });
  console.log('[Follow] GuildStore:', !!GuildStore);

  function findVoiceActions() {
    const candidates = [];
    for (const id in CACHE) {
      try {
        const e = CACHE[id]?.exports;
        if (!e) continue;
        const objs = [e, e?.default, ...(e ? Object.values(e).filter(v => v && typeof v === 'object') : [])];
        for (const obj of objs) {
          if (!obj || typeof obj !== 'object') continue;
          if ('locale' in obj && 'ast' in obj) continue;
          if (typeof obj.selectChannel !== 'function') continue;
          if (typeof obj.selectPrivateChannel !== 'function') continue;
          if (typeof obj.selectVoiceChannel !== 'function') continue;
          if (typeof obj.disconnect !== 'function') continue;
          let src = '';
          try { src = obj.selectVoiceChannel.toString(); } catch {}
          if (src.length < 200) continue;
          if (!src.includes('VOICE_CHANNEL_SELECT')) continue;
          let own = 0;
          try {
            for (const k of Object.getOwnPropertyNames(obj)) {
              if (typeof obj[k] === 'function') own++;
            }
          } catch {}
          candidates.push({ id, obj, own, srcLen: src.length });
        }
      } catch {}
    }
    candidates.sort((a, b) => {
      if (a.own !== b.own) return a.own - b.own;
      return b.srcLen - a.srcLen;
    });
    return candidates[0]?.obj ?? null;
  }
  const VoiceActions = findVoiceActions();
  console.log('[Follow] VoiceActions:', !!VoiceActions);

  if (!VoiceStore || !ChannelStore || !UserStore || !VoiceActions) {
    alert('[Follow] Un des stores est introuvable. Recharge Discord.');
    return;
  }

  function getVoiceStateForUser(userId) {
    try { return VoiceStore.getVoiceStateForUser(userId); } catch { return null; }
  }
  function getUserVoiceChannelId(userId) {
    const vs = getVoiceStateForUser(userId);
    return vs?.channelId ?? null;
  }
  function getMyCurrentVoiceChannelId() {
    if (!MY_ID) return null;
    try {
      const vs = VoiceStore.getVoiceStateForUser(MY_ID);
      return vs?.channelId ?? null;
    } catch { return null; }
  }
  function getChannel(channelId) {
    try { return ChannelStore.getChannel(channelId); } catch { return null; }
  }
  function getUser(userId) {
    try { return UserStore.getUser(userId); } catch { return null; }
  }
  function getGuildId() {
    const parts = window.location.pathname.split('/');
    if (parts[2] === '@me' || !parts[2] || !/^\d{17,20}$/.test(parts[2])) return null;
    return parts[2];
  }
  function getGuild(guildId) {
    if (!guildId || !GuildStore) return null;
    try { return GuildStore.getGuild(guildId); } catch { return null; }
  }
  function getGuildName(guildId) {
    const g = getGuild(guildId);
    return g?.name ?? null;
  }
  function getDefaultAvatarURL(userId, size = 128) {
    try {
      const id = BigInt(userId);
      const idx = Number((id >> 22n) % 6n);
      return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    } catch {
      return `https://cdn.discordapp.com/embed/avatars/0.png`;
    }
  }
  function getUserAvatarURL(userId, avatarHash, size = 128) {
    if (avatarHash) {
      const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
      return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
    }
    return getDefaultAvatarURL(userId, size);
  }
  function getGuildIconURL(guildId, size = 48) {
    const g = getGuild(guildId);
    if (!g?.icon) return null;
    const ext = g.icon.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/icons/${guildId}/${g.icon}.${ext}?size=${size}`;
  }

  function findFluxDispatcher() {
    let dispatcher = null;
    try {
      webpackChunkdiscord_app.push([[Symbol()], {}, ({ c }) => {
        for (const id in c) {
          const exp = c[id]?.exports;
          if (!exp) continue;
          const objs = [exp, exp?.default, ...(exp ? Object.values(exp) : [])];
          for (const val of objs) {
            try {
              if (
                val &&
                typeof val === 'object' &&
                !Array.isArray(val) &&
                typeof val.dispatch === 'function' &&
                '_actionHandlers' in val
              ) {
                dispatcher = val;
                return;
              }
            } catch {}
          }
        }
      }]);
      webpackChunkdiscord_app.pop();
    } catch {}
    return dispatcher;
  }

  let _fluxDispatcher = null;
  function getFluxDispatcher() {
    if (_fluxDispatcher) return _fluxDispatcher;
    _fluxDispatcher = findFluxDispatcher();
    return _fluxDispatcher;
  }

  function openDiscordProfile(userId) {
    if (!userId || !/^\d{17,20}$/.test(userId)) return;

    try {
      const avatarImg = document.querySelector(`img[src*="/users/${userId}/"]`);
      if (avatarImg) {
        const memberEl = avatarImg.closest('[role="listitem"]')
          || avatarImg.closest('[class*="member"]')
          || avatarImg.closest('a[href*="/users/"]');
        if (memberEl) {
          memberEl.click();
          return;
        }
      }
    } catch {}

    try {
      const flux = getFluxDispatcher();
      if (flux) {
        flux.dispatch({ type: 'USER_PROFILE_MODAL_OPEN', userId });
        return;
      }
    } catch {}

    try {
      window.open(`discord://-/users/${userId}`);
    } catch {}
  }

  const CHANNEL_CACHE = new Map();
  let VOICE_CHANNELS = [];

  function indexGuildChannels() {
    CHANNEL_CACHE.clear();
    VOICE_CHANNELS = [];
    const guildId = getGuildId();
    if (!guildId) return { total: 0, voice: 0 };
    try {
      const ids = ChannelStore.getChannelIds(guildId);
      const arr = ids?._array ?? (Array.isArray(ids) ? ids : (ids ? Object.values(ids) : []));
      for (const cid of arr) {
        try {
          const ch = ChannelStore.getChannel(cid);
          if (!ch || !ch.id) continue;
          CHANNEL_CACHE.set(ch.id, ch);
          if (ch.type === 2 || ch.type === 13) VOICE_CHANNELS.push(ch);
        } catch {}
      }
    } catch (e) {
      console.warn('[Follow] indexGuildChannels err:', e.message);
    }
    return { total: CHANNEL_CACHE.size, voice: VOICE_CHANNELS.length };
  }

  const idx = indexGuildChannels();
  console.log(`[Follow] Index: ${idx.total} channels, ${idx.voice} vocaux`);

  const style = document.createElement('style');
  style.id = 'dc-follow-style';
  style.textContent = `
    #dc-follow-ui * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'gg sans','Noto Sans',sans-serif; }
    #dc-follow-ui {
      position: fixed; top: 80px; right: 24px; z-index: 99999;
      width: 340px; background: #2b2d31; border-radius: 12px;
      border: 1px solid #1e1f22; box-shadow: 0 8px 32px rgba(0,0,0,.55);
      overflow: hidden; color: #dbdee1; font-size: 14px;
      transition: width .18s ease;
    }
    #dc-follow-ui.collapsed { width: 200px; }
    #dc-follow-ui.collapsed .body { display: none; }
    #dc-follow-ui .titlebar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 11px 14px; background: #1e1f22; border-bottom: 1px solid #111214;
      user-select: none; -webkit-user-select: none; cursor: grab;
    }
    #dc-follow-ui.collapsed .titlebar { border-bottom: none; }
    #dc-follow-ui .titlebar:active { cursor: grabbing; }
    #dc-follow-ui .titlebar-left { display: flex; align-items: center; gap: 8px; pointer-events: none; }
    #dc-follow-ui .titlebar-right { display: flex; align-items: center; gap: 0; }
    #dc-follow-ui .titlebar-icon {
      width: 22px; height: 22px; border-radius: 6px; background: #5865f2;
      display: flex; align-items: center; justify-content: center;
    }
    #dc-follow-ui .titlebar-icon svg { width: 13px; height: 13px; fill: #fff; }
    #dc-follow-ui .titlebar-title { font-size: 13px; font-weight: 600; color: #f2f3f5; }
    #dc-follow-ui .close-btn {
      width: 24px; height: 24px; border-radius: 50%; border: none;
      background: transparent; cursor: pointer; display: flex; align-items: center;
      justify-content: center; color: #80848e;
    }
    #dc-follow-ui .close-btn:hover { background: #ed4245; color: #fff; }
    #dc-follow-ui .close-btn svg { width: 14px; height: 14px; pointer-events: none; }
    #dc-follow-ui .collapse-btn {
      width: 24px; height: 24px; border-radius: 50%; border: none;
      background: transparent; cursor: pointer; display: flex; align-items: center;
      justify-content: center; color: #80848e;
      transition: background .15s, color .15s, transform .2s;
      margin-right: 4px;
    }
    #dc-follow-ui .collapse-btn:hover { background: #5865f2; color: #fff; }
    #dc-follow-ui .collapse-btn svg { width: 14px; height: 14px; pointer-events: none; transition: transform .2s; }
    #dc-follow-ui.collapsed .collapse-btn svg { transform: rotate(180deg); }
    #dc-follow-ui .body { padding: 14px; }
    #dc-follow-ui .input-row { display: flex; gap: 8px; }
    #dc-follow-ui #dcf-id-input {
      flex: 1; height: 34px; border-radius: 6px; border: 1px solid #111214;
      background: #1e1f22; color: #dbdee1; padding: 0 10px; font-size: 13px;
      font-family: 'Consolas', monospace; outline: none;
    }
    #dc-follow-ui .load-btn {
      height: 34px; padding: 0 12px; border-radius: 6px; border: none;
      background: #5865f2; color: #fff; font-size: 13px; font-weight: 500;
      cursor: pointer;
    }
    #dc-follow-ui .load-btn:hover { background: #4752c4; }
    #dc-follow-ui .load-btn:disabled { opacity: .45; }
    #dc-follow-ui .err-msg {
      margin-top: 8px; font-size: 12px; color: #f38ba8;
      background: #2c1a1d; border-radius: 6px; border: 1px solid #5c2530;
      padding: 6px 10px; display: none;
    }
    #dc-follow-ui .profile-card {
      margin-top: 12px; background: #232428; border-radius: 10px;
      border: 1px solid #1e1f22; padding: 12px; display: none;
    }
    #dc-follow-ui .profile-top { display: flex; align-items: center; gap: 12px; }
    #dc-follow-ui .avatar-wrap { position: relative; }
    #dc-follow-ui .avatar {
      width: 48px; height: 48px; border-radius: 50%; background: #5865f2;
      display: flex; align-items: center; justify-content: center;
      font-size: 17px; font-weight: 700; color: #fff; overflow: hidden;
    }
    #dc-follow-ui .avatar img { width: 100%; height: 100%; object-fit: cover; }
    #dc-follow-ui .avatar.clickable,
    #dc-follow-ui .profile-name.clickable,
    #dc-follow-ui .profile-user.clickable {
      cursor: pointer;
      transition: opacity .15s, filter .15s, color .15s;
    }
    #dc-follow-ui .avatar.clickable:hover {
      filter: brightness(1.15) drop-shadow(0 0 6px rgba(88,101,242,.6));
    }
    #dc-follow-ui .profile-name.clickable:hover,
    #dc-follow-ui .profile-user.clickable:hover {
      color: #5865f2;
      text-decoration: underline;
    }
    #dc-follow-ui .status-dot {
      position: absolute; bottom: 1px; right: 1px; width: 13px; height: 13px;
      border-radius: 50%; border: 2.5px solid #232428;
    }
    #dc-follow-ui .status-dot.online  { background: #23a559; }
    #dc-follow-ui .status-dot.offline { background: #80848e; }
    #dc-follow-ui .profile-info { flex: 1; min-width: 0; }
    #dc-follow-ui .profile-name {
      font-size: 14px; font-weight: 700; color: #f2f3f5;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #dc-follow-ui .profile-user {
      font-size: 11.5px; color: #80848e; font-family: 'Consolas',monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;
    }
    #dc-follow-ui .voice-badge {
      display: inline-flex; align-items: center; gap: 5px;
      margin-top: 7px; padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600;
      max-width: 100%;
    }
    #dc-follow-ui .voice-badge.in-voice  { background: #1a3a2a; color: #23a559; border: 1px solid #23a559; }
    #dc-follow-ui .voice-badge.out-voice { background: #1e1f22; color: #80848e; border: 1px solid #2e3035; }
    #dc-follow-ui .voice-badge.other-guild { background: #3a2a1a; color: #f0b132; border: 1px solid #f0b132; }
    #dc-follow-ui .voice-badge.clickable {
      cursor: pointer;
      transition: background .15s, border-color .15s, transform .1s;
    }
    #dc-follow-ui .voice-badge.clickable:hover {
      transform: scale(1.02);
    }
    #dc-follow-ui .voice-badge.in-voice.clickable:hover {
      background: #1f4a35;
      border-color: #2fbf6a;
    }
    #dc-follow-ui .voice-badge.other-guild.clickable:hover {
      background: #4a3520;
      border-color: #ffc75a;
    }
    #dc-follow-ui .voice-badge.clickable:active {
      transform: scale(0.98);
    }
    #dc-follow-ui .voice-badge svg {
      width: 11px; height: 11px;
      fill: none; stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round;
      flex-shrink: 0;
    }
    #dc-follow-ui .voice-badge span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #dc-follow-ui .action-area { margin-top: 12px; display: none; }
    #dc-follow-ui .action-btn {
      width: 100%; height: 36px; border-radius: 8px; border: none;
      font-size: 13px; font-weight: 600; cursor: pointer; display: flex;
      align-items: center; justify-content: center; gap: 7px;
    }
    #dc-follow-ui .action-btn.start { background: #23a559; color: #fff; }
    #dc-follow-ui .action-btn.start:hover { background: #1a8a47; }
    #dc-follow-ui .action-btn.stop  { background: #ed4245; color: #fff; }
    #dc-follow-ui .action-btn.stop:hover  { background: #c93b3e; }
    #dc-follow-ui .action-btn svg { width: 14px; height: 14px; fill: currentColor; }
    #dc-follow-ui .status-bar {
      margin-top: 10px; display: flex; align-items: center; gap: 8px;
      font-size: 11px; color: #80848e; padding: 6px 10px;
      background: #1e1f22; border-radius: 6px; border: 1px solid #111214;
    }
    #dc-follow-ui .status-bar .dot {
      width: 8px; height: 8px; border-radius: 50%; background: #80848e;
    }
    #dc-follow-ui .status-bar.active .dot { background: #23a559; box-shadow: 0 0 8px #23a559; }
    #dc-follow-ui .status-bar.voice .dot { background: #5865f2; }
    #dc-follow-ui .goto-bar {
      margin-top: 10px; display: none; align-items: center; gap: 8px;
      padding: 8px 10px; background: #2c1a1d; border-radius: 6px;
      border: 1px solid #5c2530; font-size: 11px; color: #f0b132;
    }
    #dc-follow-ui .goto-bar.visible { display: flex; }
    #dc-follow-ui .goto-icon {
      width: 26px; height: 26px; border-radius: 8px;
      background: #1e1f22; display: flex; align-items: center; justify-content: center;
      overflow: hidden; flex-shrink: 0;
      color: #f0b132; font-weight: 700; font-size: 12px;
    }
    #dc-follow-ui .goto-icon img { width: 100%; height: 100%; object-fit: cover; }
    #dc-follow-ui .goto-info { flex: 1; min-width: 0; }
    #dc-follow-ui .goto-guild {
      font-size: 11px; color: #f2f3f5; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #dc-follow-ui .goto-channel {
      font-size: 10px; color: #80848e;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      margin-top: 1px;
    }
    #dc-follow-ui .goto-btn {
      padding: 5px 10px; border-radius: 4px;
      border: 1px solid #f0b132; background: transparent;
      color: #f0b132; font-size: 11px; font-weight: 600;
      cursor: pointer; transition: background .15s, color .15s;
      flex-shrink: 0; white-space: nowrap;
    }
    #dc-follow-ui .goto-btn:hover { background: #f0b132; color: #2b2d31; }
    #dc-follow-ui .log-area {
      display: none; margin-top: 10px; background: #1e1f22; border-radius: 6px;
      border: 1px solid #111214; padding: 8px; max-height: 160px; overflow-y: auto;
      user-select: text; -webkit-user-select: text;
      scrollbar-width: thin;
      scrollbar-color: #5865f2 transparent;
    }
    #dc-follow-ui .log-area::-webkit-scrollbar { width: 6px; height: 6px; }
    #dc-follow-ui .log-area::-webkit-scrollbar-track { background: transparent; margin: 4px 0; }
    #dc-follow-ui .log-area::-webkit-scrollbar-thumb { background: #3a3d44; border-radius: 3px; transition: background .15s; }
    #dc-follow-ui .log-area:hover::-webkit-scrollbar-thumb { background: #5865f2; }
    #dc-follow-ui .log-area::-webkit-scrollbar-thumb:hover { background: #4752c4; }
    #dc-follow-ui .log-area::-webkit-scrollbar-thumb:active { background: #3c46a6; }
    #dc-follow-ui .log-area::-webkit-scrollbar-corner { background: transparent; }
    #dc-follow-ui .log-entry {
      font-size: 11px; font-family: 'Consolas',monospace; line-height: 1.7;
      white-space: pre-wrap; word-break: break-all;
      user-select: text; -webkit-user-select: text; cursor: text;
    }
    #dc-follow-ui .log-entry.info    { color: #80848e; }
    #dc-follow-ui .log-entry.success { color: #23a559; }
    #dc-follow-ui .log-entry.warn    { color: #f0b132; }
    #dc-follow-ui .log-entry.error   { color: #ed4245; }
  `;
  document.head.appendChild(style);

  const ui = document.createElement('div');
  ui.id = 'dc-follow-ui';
  ui.innerHTML = `
    <div class="titlebar" id="dcf-titlebar">
      <div class="titlebar-left">
        <div class="titlebar-icon">
          <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
        </div>
        <span class="titlebar-title">Discord Follow</span>
      </div>
      <div class="titlebar-right">
        <button class="collapse-btn" id="dcf-collapse" title="Réduire / Agrandir">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <button class="close-btn" id="dcf-close" title="Fermer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <div class="body">
      <div class="input-row">
        <input id="dcf-id-input" type="text" placeholder="ID utilisateur Discord…" autocomplete="off">
        <button class="load-btn" id="dcf-load-btn">Charger</button>
      </div>
      <div class="err-msg" id="dcf-err"></div>

      <div class="profile-card" id="dcf-profile">
        <div class="profile-top">
          <div class="avatar-wrap">
            <div class="avatar" id="dcf-avatar" title="Cliquer pour voir le profil Discord"><span id="dcf-initials"></span></div>
            <div class="status-dot offline" id="dcf-dot"></div>
          </div>
          <div class="profile-info">
            <div class="profile-name" id="dcf-name" title="Cliquer pour voir le profil Discord">—</div>
            <div class="profile-user" id="dcf-user" title="Cliquer pour voir le profil Discord">—</div>
            <div class="voice-badge out-voice" id="dcf-voice-badge">
              <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              <span id="dcf-voice-label">Hors vocal</span>
            </div>
          </div>
        </div>
      </div>

      <div class="action-area" id="dcf-action">
        <button class="action-btn start" id="dcf-action-btn">
          <svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z"/></svg> Start follow
        </button>
      </div>

      <div class="status-bar" id="dcf-status">
        <div class="dot"></div>
        <span id="dcf-status-text">Prêt</span>
      </div>

      <div class="status-bar voice" id="dcf-index-bar">
        <div class="dot"></div>
        <span id="dcf-index-text">Indexation…</span>
      </div>

      <div class="goto-bar" id="dcf-goto-bar">
        <div class="goto-icon" id="dcf-goto-icon">?</div>
        <div class="goto-info">
          <div class="goto-guild" id="dcf-goto-guild">—</div>
          <div class="goto-channel" id="dcf-goto-channel">—</div>
        </div>
        <button class="goto-btn" id="dcf-goto-btn">🚀 Aller</button>
      </div>

      <div class="log-area" id="dcf-log"></div>
    </div>
  `;
  document.body.appendChild(ui);

  const titlebar = document.getElementById('dcf-titlebar');
  let dragging = false, ox = 0, oy = 0;
  titlebar.addEventListener('mousedown', e => {
    if (e.target.closest('.close-btn')) return;
    if (e.target.closest('.collapse-btn')) return;
    dragging = true;
    const r = ui.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    ui.style.right = 'auto';
    ui.style.left = Math.max(0, e.clientX - ox) + 'px';
    ui.style.top  = Math.max(0, e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  const $el = id => document.getElementById(id);
  function setError(msg) {
    const e = $el('dcf-err');
    e.style.display = msg ? 'block' : 'none';
    e.textContent = msg || '';
  }
  function addLog(msg, type = 'info') {
    const la = $el('dcf-log');
    la.style.display = 'block';
    const d = document.createElement('div');
    d.className = 'log-entry ' + type;
    const t = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    d.textContent = `[${t}] ${msg}`;
    la.appendChild(d);
    la.scrollTop = la.scrollHeight;
    while (la.children.length > 80) la.removeChild(la.firstChild);
  }
  function getInitials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(w => (w[0] || '').toUpperCase()).join('') || '?';
  }
  function setVoiceState(inVoice, label, variant = 'in-voice') {
    const badge = $el('dcf-voice-badge');
    const lbl   = $el('dcf-voice-label');
    const dot   = $el('dcf-dot');
    if (inVoice) {
      badge.className = 'voice-badge ' + variant;
      lbl.textContent = label ? `En vocal — ${label}` : 'En vocal';
      dot.className = 'status-dot online';
      badge.classList.add('clickable');
      badge.title = 'Cliquer pour rejoindre ce vocal';
    } else {
      badge.className = 'voice-badge out-voice';
      lbl.textContent = label ? label : 'Hors vocal';
      dot.className = 'status-dot offline';
      badge.classList.remove('clickable');
      badge.removeAttribute('title');
    }
  }
  function setStatus(text, active) {
    $el('dcf-status-text').textContent = text;
    $el('dcf-status').classList.toggle('active', !!active);
  }
  function setIndexStatus(text) {
    $el('dcf-index-text').textContent = text;
  }

  let pendingGotoGuild = null;
  let pendingGotoChannel = null;

  function showGotoBar(guildId, channelId) {
    pendingGotoGuild = guildId;
    pendingGotoChannel = channelId;
    const bar = $el('dcf-goto-bar');
    const guildNm = getGuildName(guildId) ?? guildId;
    const chNm = getChannel(channelId)?.name ?? channelId;
    $el('dcf-goto-guild').textContent = guildNm;
    $el('dcf-goto-channel').textContent = '#' + chNm;
    const iconEl = $el('dcf-goto-icon');
    const iconURL = getGuildIconURL(guildId, 48);
    if (iconURL) {
      iconEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = iconURL;
      img.onerror = () => { iconEl.innerHTML = getInitials(guildNm); };
      iconEl.appendChild(img);
    } else {
      iconEl.innerHTML = getInitials(guildNm);
    }
    bar.classList.add('visible');
  }

  function hideGotoBar() {
    pendingGotoGuild = null;
    pendingGotoChannel = null;
    $el('dcf-goto-bar').classList.remove('visible');
  }

  function navigateToGuild(guildId) {
    const selectors = [
      `[data-list-item-id="guildsnav___${guildId}"]`,
      `[data-list-item-id*="${guildId}"]`,
      `a[href*="/channels/${guildId}"]`,
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) { el.click(); return true; }
      } catch {}
    }
    try {
      const ids = ChannelStore.getChannelIds(guildId);
      const arr = ids?._array ?? (Array.isArray(ids) ? ids : (ids ? Object.values(ids) : []));
      for (const cid of arr) {
        const ch = ChannelStore.getChannel(cid);
        if (ch && (ch.type === 0 || ch.type === 2)) {
          history.pushState({}, '', `/channels/${guildId}/${cid}`);
          window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
          return true;
        }
      }
    } catch {}
    return false;
  }

  function gotoPendingGuild() {
    if (!pendingGotoGuild) return;
    const gid = pendingGotoGuild;
    addLog(`🚀 Navigation vers "${getGuildName(gid) ?? gid}"…`, 'info');
    if (!navigateToGuild(gid)) {
      addLog('❌ Impossible de naviguer vers le serveur', 'error');
      return;
    }
    setTimeout(() => {
      const vs = getVoiceStateForUser(TARGET_USER_ID);
      const currentCh = vs?.channelId ?? null;
      const currentG = vs?.guildId ?? null;
      if (currentCh && currentG === gid) {
        hideGotoBar();
        currentChannelId = currentCh;
        currentGuildId = currentG;
        addLog(`Connexion à ${getChannel(currentCh)?.name ?? currentCh}…`, 'info');
        joinVoiceChannel(currentCh).catch(e => addLog('Join err: ' + e.message, 'error'));
      } else {
        addLog('Cible plus dans le même salon, annulé', 'warn');
        hideGotoBar();
      }
    }, 2500);
  }

  let TARGET_USER_ID = null;
  let currentChannelId = null;
  let currentGuildId = null;
  let following = false;
  let pollTimer = null;
  let guildCheckTimer = null;
  let lastKnownMyGuild = null;

  function updateIndexDisplay() {
    const guildId = getGuildId();
    if (!guildId) {
      setIndexStatus(`📍 MP · pas de serveur`);
      return;
    }
    const total = CHANNEL_CACHE.size;
    const voice = VOICE_CHANNELS.length;
    const gname = getGuildName(guildId);
    setIndexStatus(`📁 ${total} salons · 🔊 ${voice} vocaux${gname ? ' · ' + gname : ''}`);
  }
  updateIndexDisplay();

  function refreshVoiceUI() {
    if (!TARGET_USER_ID) return;
    const vs = getVoiceStateForUser(TARGET_USER_ID);
    if (vs?.channelId) {
      const ch = getChannel(vs.channelId);
      const nm = ch?.name ?? vs.channelId;
      const gname = vs.guildId ? (getGuildName(vs.guildId) ?? vs.guildId.slice(-4)) : null;
      const isOtherGuild = vs.guildId && vs.guildId !== getGuildId();
      const label = gname ? `${nm} · ${gname}` : nm;
      setVoiceState(true, label, isOtherGuild ? 'other-guild' : 'in-voice');
    } else {
      setVoiceState(false, 'Hors vocal');
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      // ✅ On continue si on a un TARGET (même hors follow)
      if (!TARGET_USER_ID) return;

      const vs = getVoiceStateForUser(TARGET_USER_ID);
      const ch = vs?.channelId ?? null;
      const guild = vs?.guildId ?? null;

      if (ch !== currentChannelId || guild !== currentGuildId) {
        if (ch) {
          const channel = getChannel(ch);
          const nm = channel?.name ?? ch;
          const myGuild = getGuildId();
          const gname = guild ? (getGuildName(guild) ?? guild.slice(-4)) : null;
          const label = gname ? `${nm} · ${gname}` : nm;

          tryUpdateUserProfile(TARGET_USER_ID);

          if (guild && guild !== myGuild) {
            currentChannelId = ch;
            currentGuildId = guild;
            if (following) addLog(`📍 Cible sur "${gname}" → #${nm}`, 'warn');
            setVoiceState(true, label, 'other-guild');
            setStatus(`Cible sur : ${gname}`, false);
            showGotoBar(guild, ch);
            return;
          }

          hideGotoBar();
          currentChannelId = ch;
          currentGuildId = guild;

          // 🔔 Logs + join uniquement si follow actif
          if (following) {
            addLog(`🔊 Cible rejoint : ${nm}`, 'success');
            setStatus(`Cible en vocal : ${nm}`, true);
            joinVoiceChannel(ch).catch(e => addLog('Join err: ' + e.message, 'error'));
          }

          // ✅ Toujours mettre à jour le badge
          setVoiceState(true, label);
        } else {
          currentChannelId = null;
          currentGuildId = null;
          if (following) addLog('🔇 Cible hors vocal.', 'warn');
          setVoiceState(false, 'Hors vocal');
          if (following) setStatus('En attente…', false);
          hideGotoBar();
        }
      }
    }, 1200);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function joinVoiceChannel(channelId) {
    const ch = getChannel(channelId);
    const nm = ch?.name ?? channelId;
    const myCurrent = getMyCurrentVoiceChannelId();
    if (myCurrent === channelId) {
      addLog('Déjà connecté à ' + nm, 'info');
      return true;
    }
    if (myCurrent && myCurrent !== channelId) {
      addLog(`Changement de vocal (${getChannel(myCurrent)?.name ?? myCurrent} → ${nm})`, 'info');
      try { if (VoiceActions?.disconnect) VoiceActions.disconnect(); } catch (e) { addLog('Disconnect err: ' + e.message, 'warn'); }
      await sleep(1500);
    }
    addLog('Connexion à ' + nm + ' (instantané)…', 'info');
    try {
      VoiceActions.selectVoiceChannel(channelId);
      addLog('✅ Action envoyée pour ' + nm, 'success');
      setTimeout(() => {
        const nowIn = getMyCurrentVoiceChannelId();
        if (nowIn === channelId) addLog('🎯 Confirmé dans ' + nm, 'success');
        else if (nowIn === null) addLog('⚠️ Pas de confirmation', 'warn');
        else addLog(`⚠️ Dans un autre vocal : ${getChannel(nowIn)?.name ?? nowIn}`, 'warn');
      }, 3000);
      return true;
    } catch (e) {
      addLog('VoiceActions err: ' + e.message, 'error');
      return false;
    }
  }

  function tryUpdateUserProfile(userId) {
    if (!userId || userId === 'unknown') return false;
    const u = getUser(userId);
    if (!u) return false;

    const currentName = $el('dcf-name').textContent;
    if (currentName && currentName !== 'Utilisateur inconnu') return false;

    const displayName = u.globalName || u.global_name || u.username;
    const handle = u.discriminator && u.discriminator !== '0'
      ? `${u.username}#${u.discriminator}` : `@${u.username}`;

    $el('dcf-initials').textContent = '';
    $el('dcf-name').textContent = displayName;
    $el('dcf-user').textContent = handle;

    const avatarEl = $el('dcf-avatar');
    avatarEl.querySelector('img')?.remove();
    const img = document.createElement('img');
    img.src = getUserAvatarURL(userId, u.avatar, 128);
    img.onerror = () => {
      img.src = getDefaultAvatarURL(userId, 128);
    };
    avatarEl.appendChild(img);

    $el('dcf-avatar').classList.add('clickable');
    $el('dcf-name').classList.add('clickable');
    $el('dcf-user').classList.add('clickable');

    addLog(`✅ Profil mis à jour : ${displayName}`, 'success');
    return true;
  }

  function loadUser(id) {
    id = id.trim();
    if (!/^\d{17,20}$/.test(id)) { setError('ID invalide.'); return; }
    setError('');

    $el('dcf-profile').style.display = 'none';
    $el('dcf-action').style.display = 'none';

    const u = getUser(id);

    if (u) {
      const displayName = u.globalName || u.global_name || u.username;
      const handle = u.discriminator && u.discriminator !== '0'
        ? `${u.username}#${u.discriminator}` : `@${u.username}`;

      $el('dcf-initials').textContent = '';
      $el('dcf-name').textContent = displayName;
      $el('dcf-user').textContent = handle;

      const avatarEl = $el('dcf-avatar');
      avatarEl.querySelector('img')?.remove();
      const img = document.createElement('img');
      img.src = getUserAvatarURL(id, u.avatar, 128);
      img.onerror = () => {
        img.src = getDefaultAvatarURL(id, 128);
      };
      avatarEl.appendChild(img);
      addLog(`Profil chargé`, 'success');
    } else {
      $el('dcf-initials').textContent = '';
      $el('dcf-name').textContent = 'Utilisateur inconnu';
      $el('dcf-user').textContent = id;
      const avatarEl = $el('dcf-avatar');
      avatarEl.querySelector('img')?.remove();
      const img = document.createElement('img');
      img.src = getDefaultAvatarURL(id, 128);
      img.onerror = () => { img.remove(); $el('dcf-initials').textContent = '?'; };
      avatarEl.appendChild(img);
      addLog(`Profil inconnu → suivi seul. Le pseudo s'affichera dès qu'il rejoindra un vocal.`, 'warn');
    }

    $el('dcf-avatar').classList.add('clickable');
    $el('dcf-name').classList.add('clickable');
    $el('dcf-user').classList.add('clickable');

    TARGET_USER_ID = id;
    $el('dcf-profile').style.display = 'block';
    $el('dcf-action').style.display = 'block';

    refreshVoiceUI();

    // ✅ Démarre le polling pour surveiller l'état vocal (même hors follow)
    startPolling();

    const vs = getVoiceStateForUser(id);
    if (vs?.channelId) {
      const ch = getChannel(vs.channelId);
      const gname = vs.guildId ? (getGuildName(vs.guildId) ?? vs.guildId.slice(-4)) : null;
      const isOther = vs.guildId && vs.guildId !== getGuildId();
      if (isOther) {
        addLog(`📍 Cible en vocal : #${ch?.name ?? vs.channelId} · ${gname}`, 'warn');
      } else {
        addLog(`📍 Cible en vocal : ${ch?.name ?? vs.channelId}${gname ? ' · ' + gname : ''}`, 'success');
      }
    } else {
      addLog(`Cible hors vocal (en attente…)`, 'info');
    }
  }

  function startFollow() {
    if (!TARGET_USER_ID) return;
    following = true;
    const btn = $el('dcf-action-btn');
    btn.className = 'action-btn stop';
    btn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12"/></svg> Stop follow`;
    addLog(`Suivi de ${TARGET_USER_ID} démarré`, 'info');
    setStatus('Surveillance active', true);
    indexGuildChannels();
    updateIndexDisplay();
    const vs = getVoiceStateForUser(TARGET_USER_ID);
    const chId = vs?.channelId ?? null;
    const guild = vs?.guildId ?? null;
    if (chId) {
      currentChannelId = chId;
      currentGuildId = guild;
      const ch = getChannel(chId);
      const gname = guild ? (getGuildName(guild) ?? guild.slice(-4)) : null;
      const label = gname ? `${ch?.name ?? chId} · ${gname}` : (ch?.name ?? chId);

      tryUpdateUserProfile(TARGET_USER_ID);

      const isOther = guild && guild !== getGuildId();
      if (isOther) {
        setVoiceState(true, label, 'other-guild');
        addLog(`Cible sur un autre serveur : ${gname}`, 'warn');
        showGotoBar(guild, chId);
      } else {
        setVoiceState(true, label);
        addLog(`Cible déjà en vocal : ${ch?.name ?? chId}`, 'info');
        joinVoiceChannel(chId).catch(e => addLog('Join err: ' + e.message, 'error'));
      }
    } else {
      setVoiceState(false, 'Hors vocal');
      addLog('Cible hors vocal sur les serveurs en commun · en attente…', 'warn');
    }
    startPolling();
    let ignoreKeys = true;
    setTimeout(() => { ignoreKeys = false; }, 1500);
    const onKey = e => {
      if (ignoreKeys || e.ctrlKey || e.altKey || e.metaKey) return;
      if (['Shift','Control','Alt','Meta','CapsLock','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
      stopFollow();
    };
    document.addEventListener('keydown', onKey);
    ui._stopKey = onKey;
  }

  function stopFollow() {
    following = false;
    // ⚠️ On garde le polling actif si un user est chargé
    if (!TARGET_USER_ID) stopPolling();
    if (ui._stopKey) {
      document.removeEventListener('keydown', ui._stopKey);
      ui._stopKey = null;
    }
    const btn = $el('dcf-action-btn');
    btn.className = 'action-btn start';
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z"/></svg> Start follow`;
    setStatus('Arrêté', false);
    hideGotoBar();
    addLog('Suivi arrêté.', 'error');
  }

  function destroyUI() {
    try { stopPolling(); } catch {}
    try { if (guildCheckTimer) clearInterval(guildCheckTimer); } catch {}
    if (ui._stopKey) {
      try { document.removeEventListener('keydown', ui._stopKey); } catch {}
      ui._stopKey = null;
    }
    if (window.__dcfInstances) {
      window.__dcfInstances = window.__dcfInstances.filter(i => i.ui !== ui);
    }
    try { ui.remove(); } catch {}
    try { document.getElementById('dc-follow-style')?.remove(); } catch {}
    console.log('[Discord Follow] Nettoyage complet effectué');
  }

  lastKnownMyGuild = getGuildId();
  guildCheckTimer = setInterval(() => {
    const currentMyGuild = getGuildId();
    if (!currentMyGuild && lastKnownMyGuild) {
      lastKnownMyGuild = null;
      updateIndexDisplay();
      return;
    }
    if (currentMyGuild && !lastKnownMyGuild) {
      lastKnownMyGuild = currentMyGuild;
      indexGuildChannels();
      updateIndexDisplay();
      return;
    }
    if (currentMyGuild && currentMyGuild !== lastKnownMyGuild) {
      lastKnownMyGuild = currentMyGuild;
      if (!following) indexGuildChannels();
      updateIndexDisplay();
      if (following && TARGET_USER_ID) {
        const vs = getVoiceStateForUser(TARGET_USER_ID);
        if (vs?.channelId && vs.guildId) {
          if (vs.guildId !== currentMyGuild) showGotoBar(vs.guildId, vs.channelId);
          else hideGotoBar();
        }
      }
    }
  }, 1500);

  $el('dcf-collapse').addEventListener('click', () => {
    ui.classList.toggle('collapsed');
  });

  $el('dcf-avatar').addEventListener('click', () => {
    if (!TARGET_USER_ID) return;
    openDiscordProfile(TARGET_USER_ID);
  });

  $el('dcf-name').addEventListener('click', () => {
    if (!TARGET_USER_ID) return;
    openDiscordProfile(TARGET_USER_ID);
  });

  $el('dcf-user').addEventListener('click', () => {
    if (!TARGET_USER_ID) return;
    openDiscordProfile(TARGET_USER_ID);
  });

  // ─── Clic badge → REJOINDRE le vocal ───────────────────────────
  $el('dcf-voice-badge').addEventListener('click', async () => {
    if (!TARGET_USER_ID) return;

    const vs = getVoiceStateForUser(TARGET_USER_ID);
    const chId = vs?.channelId ?? null;
    if (!chId) return;

    const chName = getChannel(chId)?.name ?? chId;
    addLog(`🎯 Clic badge → rejoindre ${chName}`, 'info');

    try {
      await joinVoiceChannel(chId);
    } catch (e) {
      addLog('Join err: ' + e.message, 'error');
    }
  });

  $el('dcf-load-btn').addEventListener('click', () => loadUser($el('dcf-id-input').value));
  $el('dcf-id-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadUser($el('dcf-id-input').value);
  });
  $el('dcf-action-btn').addEventListener('click', () => {
    if (!following) startFollow(); else stopFollow();
  });
  $el('dcf-goto-btn').addEventListener('click', gotoPendingGuild);

  $el('dcf-close').addEventListener('click', () => {
    destroyUI();
  });

  window.__dcfInstances.push({
    pollTimer,
    guildCheckTimer,
    ui,
    style,
    destroy: destroyUI,
  });

  console.log('[Discord Follow v20] Prêt !');
  console.log('  VoiceStore:', !!VoiceStore);
  console.log('  ChannelStore:', !!ChannelStore);
  console.log('  UserStore:', !!UserStore);
  console.log('  GuildStore:', !!GuildStore);
  console.log('  VoiceActions:', !!VoiceActions);
  console.log('  Mon ID:', MY_ID);
  console.log('  Index:', CHANNEL_CACHE.size, 'channels /', VOICE_CHANNELS.length, 'vocaux');
})();