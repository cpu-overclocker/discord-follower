(async () => {
  // 🔪 Kill all previous instances
  if (window.__dcfInstances) {
    for (const inst of window.__dcfInstances) {
      try {
        if (inst.pollTimer) clearInterval(inst.pollTimer);
        if (inst.guildCheckTimer) clearInterval(inst.guildCheckTimer);
        if (inst.reindexTimer) clearInterval(inst.reindexTimer);
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
  if (!CACHE || CACHE_SIZE < 1000) { alert('[Follow] Cache insufficient'); return; }

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

  function findStore(methodName, validator) {
    const candidates = [];
    for (const id in CACHE) {
      try {
        const e = CACHE[id]?.exports;
        if (!e) continue;
        const test = (obj) => {
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
          candidates.push({ id, obj, methods: methods.size });
        };
        test(e);
        if (e.default) test(e.default);
        for (const k of Object.keys(e)) {
          if (k === 'default') continue;
          try { test(e[k]); } catch {}
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

  const ChannelStore = findStore('getChannelIds', (obj) => {
    if (typeof obj.getChannel !== 'function') return false;
    if (typeof obj.getDMFromUserId !== 'function') return false;
    try {
      const ids = obj.getChannelIds('__invalid__');
      if (ids && (ids.locale || ids.ast)) return false;
    } catch {}
    return true;
  });

  const UserStore = findStore('getUser', (obj) => {
    if (typeof obj.getCurrentUser !== 'function') return false;
    const me = obj.getCurrentUser();
    return !!(me?.id && me?.username);
  });

  const GuildStore = findStore('getGuild', (obj) => {
    if (typeof obj.getGuilds !== 'function') return false;
    if (typeof obj.getGuild !== 'function') return false;
    try {
      const g = obj.getGuild('__invalid__');
      if (g && (g.locale || g.ast)) return false;
    } catch {}
    return true;
  });

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

  const PermissionStore = findStore('can', (obj) =>
    typeof obj.getChannelPermissions === 'function' && typeof obj.canWithPartialContext === 'function'
  );
  const PERM = {
    ADMINISTRATOR: 1n << 3n,
    VIEW_CHANNEL:  1n << 10n,
    CONNECT:       1n << 20n,
    MOVE_MEMBERS:  1n << 24n,
  };

  if (!VoiceStore || !ChannelStore || !UserStore || !VoiceActions) {
    alert('[Follow] One of the stores could not be found. Reload Discord.');
    return;
  }

  function getVoiceStateForUser(userId) {
    try { return VoiceStore.getVoiceStateForUser(userId); } catch { return null; }
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
  function getDefaultAvatarURL(userId) {
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
              if (val && typeof val === 'object' && !Array.isArray(val)
                && typeof val.dispatch === 'function' && '_actionHandlers' in val) {
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
        if (memberEl) { memberEl.click(); return; }
      }
    } catch {}
    try {
      const flux = getFluxDispatcher();
      if (flux) { flux.dispatch({ type: 'USER_PROFILE_MODAL_OPEN', userId }); return; }
    } catch {}
    try { window.open(`discord://-/users/${userId}`); } catch {}
  }

  const CHANNEL_CACHE = new Map();
  const CHANNEL_GUILD_MAP = new Map();
  let VOICE_CHANNELS = [];
  let MY_GUILDS = new Set();

  function indexAllGuildsChannels() {
    CHANNEL_CACHE.clear();
    CHANNEL_GUILD_MAP.clear();
    VOICE_CHANNELS = [];
    MY_GUILDS = new Set();

    if (!GuildStore) return { total: 0, voice: 0, guilds: 0 };

    let guildCount = 0;
    try {
      const guilds = GuildStore.getGuilds();
      const guildArr = guilds?._array
        ?? (Array.isArray(guilds) ? guilds : (guilds ? Object.values(guilds) : []));

      for (const g of guildArr) {
        if (!g || !g.id) continue;
        MY_GUILDS.add(g.id);
        guildCount++;
        try {
          const ids = ChannelStore.getChannelIds(g.id);
          const arr = ids?._array
            ?? (Array.isArray(ids) ? ids : (ids ? Object.values(ids) : []));
          for (const cid of arr) {
            try {
              const ch = ChannelStore.getChannel(cid);
              if (!ch || !ch.id) continue;
              CHANNEL_CACHE.set(ch.id, ch);
              CHANNEL_GUILD_MAP.set(ch.id, g.id);
              if (ch.type === 2 || ch.type === 13) {
                VOICE_CHANNELS.push({ ch, guildId: g.id });
              }
            } catch {}
          }
        } catch {}
      }
    } catch (e) {
      console.warn('[Follow] indexAllGuildsChannels err:', e.message);
    }
    return { total: CHANNEL_CACHE.size, voice: VOICE_CHANNELS.length, guilds: guildCount };
  }

  indexAllGuildsChannels();

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
      width: 24px; height: 24px; border-radius: 6px; border: none;
      background: transparent; cursor: pointer; display: flex; align-items: center;
      justify-content: center; color: #80848e;
      transition: background .15s, color .15s;
    }
    #dc-follow-ui .close-btn:hover { background: #ed4245; color: #fff; }
    #dc-follow-ui .close-btn svg { width: 14px; height: 14px; pointer-events: none; }
    #dc-follow-ui .collapse-btn {
      width: 24px; height: 24px; border-radius: 6px; border: none;
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
    #dc-follow-ui .avatar.clickable:hover { filter: brightness(1.15) drop-shadow(0 0 6px rgba(88,101,242,.6)); }
    #dc-follow-ui .profile-name.clickable:hover,
    #dc-follow-ui .profile-user.clickable:hover { color: #5865f2; text-decoration: underline; }
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
      max-width: 100%; flex-wrap: wrap; row-gap: 2px;
    }
    #dc-follow-ui .voice-badge.in-voice  { background: #1a3a2a; color: #23a559; border: 1px solid #23a559; }
    #dc-follow-ui .voice-badge.out-voice { background: #1e1f22; color: #80848e; border: 1px solid #2e3035; }
    #dc-follow-ui .voice-badge.other-guild { background: #1a2a3a; color: #4fc3f7; border: 1px solid #4fc3f7; }
    #dc-follow-ui .voice-badge.clickable { cursor: pointer; transition: transform .1s; }
    #dc-follow-ui .voice-badge.clickable:hover { transform: scale(1.02); }
    #dc-follow-ui .voice-badge svg {
      width: 11px; height: 11px;
      fill: none; stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round;
      flex-shrink: 0;
    }
    #dc-follow-ui .voice-badge span {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      max-width: 100%;
    }
    #dc-follow-ui .voice-badge-guild-icon {
      width: 14px; height: 14px; border-radius: 4px;
      flex-shrink: 0; object-fit: cover;
    }
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
    #dc-follow-ui .opt-row {
      display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
      font-size: 12px; color: #b5bac1; cursor: pointer; user-select: none;
    }
    #dc-follow-ui .opt-row input { accent-color: #5865f2; cursor: pointer; width: 14px; height: 14px; }

    /* ── Index bar (container) ─────────────────── */
    #dc-follow-ui .index-bar {
      margin-top: 10px; display: flex; align-items: center; gap: 8px;
      font-size: 11px; color: #80848e; padding: 6px 10px;
      background: #1e1f22; border-radius: 6px; border: 1px solid #111214;
    }
    #dc-follow-ui .index-bar .dot {
      width: 8px; height: 8px; border-radius: 50%; background: #5865f2;
    }

    /* ── Logs toggle (no container) ────────────── */
    #dc-follow-ui .log-toggle {
      margin-top: 8px; width: 100%; height: 26px;
      display: flex; align-items: center; gap: 6px;
      padding: 0; border: none; background: transparent;
      color: #80848e; font-size: 11px; font-weight: 600;
      cursor: pointer;
      transition: color .15s;
    }
    #dc-follow-ui .log-toggle:hover { color: #dbdee1; }
    #dc-follow-ui .log-toggle .log-toggle-chevron {
      width: 12px; height: 12px; flex-shrink: 0;
      transition: transform .2s;
    }
    #dc-follow-ui .log-toggle.open .log-toggle-chevron { transform: rotate(180deg); }
    #dc-follow-ui .log-toggle.open { color: #dbdee1; }
    #dc-follow-ui .log-badge {
      margin-left: auto;
      background: #5865f2; color: #fff;
      font-size: 10px; font-weight: 700;
      padding: 1px 6px; border-radius: 10px;
      min-width: 18px; text-align: center;
    }
    #dc-follow-ui .log-badge:empty { display: none; }

    /* ── Logs container ────────────────────────── */
    #dc-follow-ui .log-area {
      display: none; margin-top: 6px;
      background: #1e1f22; border-radius: 6px;
      border: 1px solid #111214;
      padding: 8px;
      max-height: 160px; overflow-y: auto;
      user-select: text; -webkit-user-select: text;
      scrollbar-width: thin; scrollbar-color: #5865f2 transparent;
    }
    #dc-follow-ui .log-area.open { display: block; }
    #dc-follow-ui .log-area::-webkit-scrollbar { width: 6px; height: 6px; }
    #dc-follow-ui .log-area::-webkit-scrollbar-track { background: transparent; margin: 4px 0; }
    #dc-follow-ui .log-area::-webkit-scrollbar-thumb { background: #3a3d44; border-radius: 3px; }
    #dc-follow-ui .log-area:hover::-webkit-scrollbar-thumb { background: #5865f2; }
    #dc-follow-ui .log-entry {
      font-size: 11px; font-family: 'Consolas',monospace; line-height: 1.7;
      white-space: pre-wrap; word-break: break-all;
      user-select: text; -webkit-user-select: text; cursor: text;
    }
    #dc-follow-ui .log-entry.info    { color: #80848e; }
    #dc-follow-ui .log-entry.success { color: #23a559; }
    #dc-follow-ui .log-entry.warn    { color: #f0b132; }
    #dc-follow-ui .log-entry.error   { color: #ed4245; }
    #dc-follow-ui .log-empty {
      font-size: 11px; font-family: 'Consolas',monospace;
      color: #5c6169; font-style: italic;
      padding: 2px 0;
    }
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
        <button class="collapse-btn" id="dcf-collapse" title="Collapse / Expand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <button class="close-btn" id="dcf-close" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <div class="body">
      <div class="input-row">
        <input id="dcf-id-input" type="text" placeholder="Discord user ID…" autocomplete="off">
        <button class="load-btn" id="dcf-load-btn">Load</button>
      </div>
      <div class="err-msg" id="dcf-err"></div>

      <div class="profile-card" id="dcf-profile">
        <div class="profile-top">
          <div class="avatar-wrap">
            <div class="avatar" id="dcf-avatar" title="Click to view Discord profile"><span id="dcf-initials"></span></div>
            <div class="status-dot offline" id="dcf-dot"></div>
          </div>
          <div class="profile-info">
            <div class="profile-name" id="dcf-name" title="Click to view Discord profile">—</div>
            <div class="profile-user" id="dcf-user" title="Click to view Discord profile">—</div>
            <div class="voice-badge out-voice" id="dcf-voice-badge">
              <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              <span id="dcf-voice-label">Not in voice</span>
            </div>
          </div>
        </div>
      </div>

      <div class="action-area" id="dcf-action">
        <label class="opt-row">
          <input type="checkbox" id="dcf-disc-with-target">
          <span>Disconnect with target</span>
        </label>
        <button class="action-btn start" id="dcf-action-btn">
          <svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z"/></svg> Start follow
        </button>
      </div>

      <div class="index-bar" id="dcf-index-bar">
        <div class="dot"></div>
        <span id="dcf-index-text">Indexing…</span>
      </div>

      <button class="log-toggle" id="dcf-log-toggle" type="button">
        <svg class="log-toggle-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <span>Logs</span>
        <span class="log-badge" id="dcf-log-badge"></span>
      </button>
      <div class="log-area" id="dcf-log">
        <div class="log-empty" id="dcf-log-empty">No logs</div>
      </div>
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

  let logsExpanded = false;
  let unreadLogs = 0;

  function updateLogToggle() {
    const badge = $el('dcf-log-badge');
    badge.textContent = logsExpanded ? '' : (unreadLogs > 0 ? String(unreadLogs) : '');
  }

  function addLog(msg, type = 'info') {
    const la = $el('dcf-log');

    const empty = $el('dcf-log-empty');
    if (empty) empty.remove();

    const d = document.createElement('div');
    d.className = 'log-entry ' + type;
    const t = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    d.textContent = `[${t}] ${msg}`;
    la.appendChild(d);
    la.scrollTop = la.scrollHeight;
    while (la.querySelectorAll('.log-entry').length > 80) {
      la.querySelector('.log-entry')?.remove();
    }

    if (!logsExpanded) {
      unreadLogs++;
      updateLogToggle();
    }
  }

  function getInitials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(w => (w[0] || '').toUpperCase()).join('') || '?';
  }

  function getTargetName() {
    if (!TARGET_USER_ID) return 'target';
    const u = getUser(TARGET_USER_ID);
    return u?.globalName || u?.global_name || u?.username || `…${TARGET_USER_ID.slice(-4)}`;
  }

  function getVoiceChannelLabel(channelId) {
    const ch = getChannel(channelId);
    if (!ch) return channelId;
    if (ch.type === 1) {
      const rec = ch.recipients?.[0];
      const u = rec ? getUser(rec) : null;
      return u?.globalName || u?.username || 'DM';
    }
    if (ch.type === 3) return ch.name || 'Group DM';
    return ch.name ?? channelId;
  }

  function setVoiceState(inVoice, channelId, guildId, variant = 'in-voice') {
    const badge = $el('dcf-voice-badge');
    const lbl   = $el('dcf-voice-label');
    const dot   = $el('dcf-dot');

    badge.querySelectorAll('.voice-badge-guild-icon').forEach(el => el.remove());

    if (inVoice) {
      badge.className = 'voice-badge ' + variant;

      const chName = getVoiceChannelLabel(channelId);
      const gName  = guildId ? (getGuildName(guildId) ?? `…${guildId.slice(-4)}`) : null;
      lbl.textContent = gName ? `${gName} · ${chName}` : chName;

      if (guildId) {
        const iconURL = getGuildIconURL(guildId, 32);
        if (iconURL) {
          const img = document.createElement('img');
          img.className = 'voice-badge-guild-icon';
          img.src = iconURL;
          img.onerror = () => img.remove();
          badge.insertBefore(img, lbl);
        }
      }

      dot.className = 'status-dot online';
      badge.classList.add('clickable');
      badge.title = `Join: ${lbl.textContent}`;
    } else {
      badge.className = 'voice-badge out-voice';
      lbl.textContent = 'Not in voice';
      dot.className = 'status-dot offline';
      badge.classList.remove('clickable');
      badge.removeAttribute('title');
    }
  }

  function setIndexStatus(text) {
    $el('dcf-index-text').textContent = text;
  }

  let TARGET_USER_ID = null;
  let currentChannelId = null;
  let currentGuildId = null;
  let following = false;
  let pollTimer = null;
  let guildCheckTimer = null;
  let reindexTimer = null;
  let lastKnownMyGuild = null;

  function updateIndexDisplay() {
    const voice = VOICE_CHANNELS.length;
    const guilds = MY_GUILDS.size;
    setIndexStatus(`🌐 ${guilds} servers · 🔊 ${voice} voice channels`);
  }
  updateIndexDisplay();

  function updateVoiceUI() {
    if (!TARGET_USER_ID) { setVoiceState(false, null, null); return; }
    const vs = getVoiceStateForUser(TARGET_USER_ID);
    if (!vs?.channelId) { setVoiceState(false, null, null); return; }
    const gid = vs.guildId || CHANNEL_GUILD_MAP.get(vs.channelId) || null;
    const isSameGuild = gid && gid === getGuildId();
    const variant = gid ? (isSameGuild ? 'in-voice' : 'other-guild') : 'in-voice';
    setVoiceState(true, vs.channelId, gid, variant);
  }

  // La cible quitte le vocal -> je me déconnecte aussi (si la case est cochée)
  function disconnectWithTarget() {
    if (!following || !$el('dcf-disc-with-target')?.checked) return;
    if (!getMyCurrentVoiceChannelId()) return;
    try { VoiceActions.disconnect(); addLog('Disconnected with target', 'info'); } catch {}
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!TARGET_USER_ID) return;

      const vs = getVoiceStateForUser(TARGET_USER_ID);
      const ch = vs?.channelId ?? null;
      const guild = vs?.guildId || CHANNEL_GUILD_MAP.get(ch) || null;

      if (ch !== currentChannelId || guild !== currentGuildId) {
        currentChannelId = ch;
        currentGuildId = guild;

        tryUpdateUserProfile(TARGET_USER_ID);
        updateVoiceUI();

        const name = getTargetName();

        if (ch) {
          const chName = getVoiceChannelLabel(ch);
          const gName  = guild ? getGuildName(guild) : null;
          const suffix = gName ? ` · ${gName}` : '';

          addLog(`${name} → ${chName}${suffix}`, 'success');

          if (following) joinVoiceChannel(ch).catch(() => {});
        } else {
          addLog(`${name} → User disconnected`, 'warn');
          disconnectWithTarget();
        }
      }
    }, 1200);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function canDo(perm, ch) {
    if (!PermissionStore) return null;
    try { return !!PermissionStore.can(perm, ch); } catch { return null; }
  }

  // Retourne { ok: true } ou { ok: false, reason }
  function checkJoinable(channelId) {
    const ch = getChannel(channelId);
    if (!ch) return { ok: true };                       // inconnu : on tente quand même
    if (ch.type === 1 || ch.type === 3) return { ok: true }; // DM / groupe : pas de permissions de salon

    if (canDo(PERM.VIEW_CHANNEL, ch) === false) return { ok: false, reason: 'no access (View Channel)' };
    if (canDo(PERM.CONNECT, ch) === false)      return { ok: false, reason: 'no Connect permission' };

    const limit = ch.userLimit || 0;
    if (limit > 0 && typeof VoiceStore.getVoiceStatesForChannel === 'function') {
      try {
        const raw = VoiceStore.getVoiceStatesForChannel(channelId);
        const states = raw instanceof Map ? Object.fromEntries(raw) : (raw || {});
        const count = Object.keys(states).length;
        const alreadyIn = !!(MY_ID && states[MY_ID]);
        const bypass = canDo(PERM.MOVE_MEMBERS, ch) === true;
        if (count >= limit && !alreadyIn && !bypass) {
          return { ok: false, reason: `channel full (${count}/${limit})` };
        }
      } catch {}
    }
    return { ok: true };
  }

  async function joinVoiceChannel(channelId) {
    const myCurrent = getMyCurrentVoiceChannelId();
    if (myCurrent === channelId) return true;

    const check = checkJoinable(channelId);
    if (!check.ok) {
      const gId = CHANNEL_GUILD_MAP.get(channelId);
      const gName = gId ? getGuildName(gId) : null;
      addLog(`Can't join #${getVoiceChannelLabel(channelId)}${gName ? ' · ' + gName : ''}: ${check.reason}`, 'warn');
      return false;
    }

    if (myCurrent && myCurrent !== channelId) {
      try { if (VoiceActions?.disconnect) VoiceActions.disconnect(); } catch {}
      await sleep(1500);
    }

    try {
      VoiceActions.selectVoiceChannel(channelId);
      return true;
    } catch {
      return false;
    }
  }

  function tryUpdateUserProfile(userId) {
    if (!userId || userId === 'unknown') return false;
    const u = getUser(userId);
    if (!u) return false;
    const currentName = $el('dcf-name').textContent;
    if (currentName && currentName !== 'Unknown user') return false;

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
    img.onerror = () => { img.src = getDefaultAvatarURL(userId, 128); };
    avatarEl.appendChild(img);

    $el('dcf-avatar').classList.add('clickable');
    $el('dcf-name').classList.add('clickable');
    $el('dcf-user').classList.add('clickable');

    return true;
  }

  function loadUser(id) {
    id = id.trim();
    if (!/^\d{17,20}$/.test(id)) { setError('Invalid ID.'); return; }
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
      img.onerror = () => { img.src = getDefaultAvatarURL(id, 128); };
      avatarEl.appendChild(img);
    } else {
      $el('dcf-initials').textContent = '';
      $el('dcf-name').textContent = 'Unknown user';
      $el('dcf-user').textContent = id;
      const avatarEl = $el('dcf-avatar');
      avatarEl.querySelector('img')?.remove();
      const img = document.createElement('img');
      img.src = getDefaultAvatarURL(id, 128);
      img.onerror = () => { img.remove(); $el('dcf-initials').textContent = '?'; };
      avatarEl.appendChild(img);
    }

    $el('dcf-avatar').classList.add('clickable');
    $el('dcf-name').classList.add('clickable');
    $el('dcf-user').classList.add('clickable');

    TARGET_USER_ID = id;

    const vs = getVoiceStateForUser(id);
    currentChannelId = vs?.channelId ?? null;
    currentGuildId = vs?.guildId || CHANNEL_GUILD_MAP.get(vs?.channelId) || null;

    $el('dcf-profile').style.display = 'block';
    $el('dcf-action').style.display = 'block';

    updateVoiceUI();
    startPolling();
  }

  function startFollow() {
    if (!TARGET_USER_ID) return;
    following = true;
    const btn = $el('dcf-action-btn');
    btn.className = 'action-btn stop';
    btn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12"/></svg> Stop follow`;

    indexAllGuildsChannels();
    updateIndexDisplay();

    const vs = getVoiceStateForUser(TARGET_USER_ID);
    const chId = vs?.channelId ?? null;
    const guild = vs?.guildId ?? CHANNEL_GUILD_MAP.get(chId) ?? null;

    currentChannelId = chId;
    currentGuildId = guild;

    tryUpdateUserProfile(TARGET_USER_ID);
    updateVoiceUI();

    if (chId) joinVoiceChannel(chId).catch(() => {});

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
    if (!TARGET_USER_ID) stopPolling();
    if (ui._stopKey) {
      document.removeEventListener('keydown', ui._stopKey);
      ui._stopKey = null;
    }
    const btn = $el('dcf-action-btn');
    btn.className = 'action-btn start';
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z"/></svg> Start follow`;
    updateVoiceUI();
  }

  function destroyUI() {
    try { stopPolling(); } catch {}
    try { if (guildCheckTimer) clearInterval(guildCheckTimer); } catch {}
    try { if (reindexTimer) clearInterval(reindexTimer); } catch {}
    if (ui._stopKey) {
      try { document.removeEventListener('keydown', ui._stopKey); } catch {}
      ui._stopKey = null;
    }
    if (window.__dcfInstances) {
      window.__dcfInstances = window.__dcfInstances.filter(i => i.ui !== ui);
    }
    try { ui.remove(); } catch {}
    try { document.getElementById('dc-follow-style')?.remove(); } catch {}
  }

  lastKnownMyGuild = getGuildId();
  guildCheckTimer = setInterval(() => {
    const currentMyGuild = getGuildId();
    if (currentMyGuild !== lastKnownMyGuild) {
      lastKnownMyGuild = currentMyGuild;
      updateIndexDisplay();
    }
  }, 1500);

  reindexTimer = setInterval(() => {
    indexAllGuildsChannels();
    updateIndexDisplay();
  }, 30000);

  $el('dcf-collapse').addEventListener('click', () => ui.classList.toggle('collapsed'));

  $el('dcf-avatar').addEventListener('click', () => { if (TARGET_USER_ID) openDiscordProfile(TARGET_USER_ID); });
  $el('dcf-name').addEventListener('click',   () => { if (TARGET_USER_ID) openDiscordProfile(TARGET_USER_ID); });
  $el('dcf-user').addEventListener('click',   () => { if (TARGET_USER_ID) openDiscordProfile(TARGET_USER_ID); });

  $el('dcf-voice-badge').addEventListener('click', async () => {
    if (!TARGET_USER_ID) return;
    const vs = getVoiceStateForUser(TARGET_USER_ID);
    const chId = vs?.channelId ?? null;
    if (!chId) return;
    try { await joinVoiceChannel(chId); } catch {}
  });

  $el('dcf-log-toggle').addEventListener('click', () => {
    logsExpanded = !logsExpanded;
    const la = $el('dcf-log');
    const toggle = $el('dcf-log-toggle');
    if (logsExpanded) {
      la.classList.add('open');
      toggle.classList.add('open');
      unreadLogs = 0;
      updateLogToggle();
      la.scrollTop = la.scrollHeight;
    } else {
      la.classList.remove('open');
      toggle.classList.remove('open');
    }
  });

  $el('dcf-load-btn').addEventListener('click', () => loadUser($el('dcf-id-input').value));
  $el('dcf-id-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadUser($el('dcf-id-input').value);
  });
  $el('dcf-action-btn').addEventListener('click', () => {
    if (!following) startFollow(); else stopFollow();
  });
  $el('dcf-close').addEventListener('click', () => destroyUI());

  window.__dcfInstances.push({
    pollTimer,
    guildCheckTimer,
    reindexTimer,
    ui,
    style,
    destroy: destroyUI,
  });
})();