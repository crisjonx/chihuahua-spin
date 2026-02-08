// ------------------- CONFIG (your values) --------------------
const SUPABASE_URL = 'https://cxbigjfbzupynkysbdiq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-GoEqPCuKkBsI8N554ME6g_tnqE7L-o';
// ------------------------------------------------------------

console.log('script.js loaded');

const PURGOMALUM_CONTAINS = 'https://www.purgomalum.com/service/containsprofanity?text=';

// REST headers for Supabase fallback
const SUPA_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
};

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Try to construct a supabase-js client if CDN loaded
let supabaseClient = null;
if (window && window.supabase && typeof window.supabase.createClient === 'function') {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Supabase client created (supabase-js).');
  } catch (e) {
    console.warn('Could not create supabase client:', e);
    supabaseClient = null;
  }
} else {
  console.warn('Supabase client not present (CDN likely not loaded). Falling back to REST calls.');
}

// ---------------- utility helpers ----------------
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function sanitizeName(raw) { return raw ? raw.trim() : ''; }
function isValidFormat(name) {
  if (!name) return false;
  if (name.length < 2 || name.length > 24) return false;
  return /^[A-Za-z0-9 _\-]+$/.test(name);
}
async function containsProfanity(name) {
  try {
    const r = await fetch(PURGOMALUM_CONTAINS + encodeURIComponent(name), { cache: 'no-store' });
    if (!r.ok) return true; // fail-safe: treat as bad
    const t = (await r.text()).trim().toLowerCase();
    return t === 'true';
  } catch (e) {
    console.warn('Profanity API failed:', e);
    return true; // fail-safe
  }
}

// -------------- Modal (HTML popup) --------------
function openModal(initial = '') {
  return new Promise(resolve => {
    const overlay = $('overlay');
    const input = $('modalInput');
    const ok = $('modalOk');
    const cancel = $('modalCancel');
    const err = $('modalError');

    if (!overlay || !input || !ok || !cancel || !err) {
      console.error('Modal elements missing from DOM.');
      resolve(null);
      return;
    }

    document.body.classList.add('modal-open');
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    err.textContent = '';
    input.value = initial;
    input.focus();
    input.select();

    function cleanup(value) {
      overlay.classList.remove('show');
      document.body.classList.remove('modal-open');
      overlay.setAttribute('aria-hidden', 'true');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      resolve(value);
    }
    function onOk() { cleanup(input.value); }
    function onCancel() { cleanup(null); }
    function onKey(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

// -------------- Local fallback storage (one entry per username) --------------
const LOCAL_KEY = 'chihuahua_local_leaderboard';
function localLoadAll() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('localLoadAll error', e);
    return [];
  }
}
function localSaveAll(arr) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
    return true;
  } catch (e) {
    console.error('localSaveAll error', e);
    return false;
  }
}
function localReplace(username, score) {
  const arr = localLoadAll();
  const idx = arr.findIndex(r => r.username === username);
  const entry = { username, score, created_at: new Date().toISOString() };
  if (idx >= 0) arr[idx] = entry; else arr.push(entry);
  arr.sort((a,b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at));
  return localSaveAll(arr.slice(0, 100));
}

// -------------- Remote helpers: either supabase-js client OR REST fallback --------------
async function remoteFetchByUsername(name) {
  // returns { ok: boolean, data: array, error }
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('leaderboard').select('id,username,score,created_at').eq('username', name).limit(100);
      if (error) return { ok:false, error };
      return { ok:true, data };
    } catch (e) { return { ok:false, error:e }; }
  } else {
    // REST GET: /rest/v1/leaderboard?username=eq.<name>&select=id,username,score,created_at
    try {
      const url = `${SUPABASE_URL}/rest/v1/leaderboard?username=eq.${encodeURIComponent(name)}&select=id,username,score,created_at`;
      const r = await fetch(url, { headers: SUPA_HEADERS });
      const text = await r.text();
      if (!r.ok) return { ok:false, error: text || `${r.status}` };
      const data = JSON.parse(text || '[]');
      return { ok:true, data };
    } catch (e) { return { ok:false, error:e }; }
  }
}

async function remoteFetchTop(limit = 10) {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('leaderboard')
        .select('username,score,created_at')
        .order('score', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(limit * 3);
      if (error) return { ok:false, error };
      return { ok:true, data };
    } catch (e) { return { ok:false, error:e }; }
  } else {
    try {
      // fetch more and dedupe on client
      const url = `${SUPABASE_URL}/rest/v1/leaderboard?select=username,score,created_at&order=score.desc,created_at.asc&limit=${limit*3}`;
      const r = await fetch(url, { headers: SUPA_HEADERS });
      const text = await r.text();
      if (!r.ok) return { ok:false, error: text || `${r.status}` };
      const data = JSON.parse(text || '[]');
      return { ok:true, data };
    } catch (e) { return { ok:false, error:e }; }
  }
}

async function remoteUpsertOrUpdate(name, score) {
  if (supabaseClient) {
    try {
      // use upsert with onConflict: username
      // supabase-js supports upsert({},{ onConflict: 'username' })
      const { data, error } = await supabaseClient
        .from('leaderboard')
        .upsert([{ username: name, score }], { onConflict: 'username' })
        .select();
      if (error) {
        // fallback: update then insert
        console.warn('upsert returned error; trying update/insert fallback:', error);
        const { error: uerr } = await supabaseClient.from('leaderboard').update({ score }).eq('username', name);
        if (uerr) {
          const { data: idata, error: ierr } = await supabaseClient.from('leaderboard').insert([{ username: name, score }]).select();
          if (ierr) return { ok:false, error: ierr };
          return { ok:true, action: 'inserted', data: idata };
        }
        return { ok:true, action: 'updated' };
      }
      return { ok:true, action: 'upserted', data };
    } catch (e) {
      return { ok:false, error:e };
    }
  } else {
    // REST fallback: check existing then PATCH or POST
    try {
      const exist = await remoteFetchByUsername(name);
      if (!exist.ok) return { ok:false, error: exist.error };
      if (exist.data && exist.data.length > 0) {
        // PATCH (update) all matching rows:
        // PATCH /rest/v1/leaderboard?username=eq.<name>
        const url = `${SUPABASE_URL}/rest/v1/leaderboard?username=eq.${encodeURIComponent(name)}`;
        const r = await fetch(url, {
          method: 'PATCH',
          headers: { ...SUPA_HEADERS, 'Prefer': 'return=representation' },
          body: JSON.stringify({ score })
        });
        const text = await r.text();
        if (!r.ok) return { ok:false, error: text || `${r.status}` };
        return { ok:true, action: 'updated', data: JSON.parse(text || '[]') };
      } else {
        // insert
        const url = `${SUPABASE_URL}/rest/v1/leaderboard`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { ...SUPA_HEADERS, 'Prefer': 'return=representation' },
          body: JSON.stringify({ username: name, score })
        });
        const text = await r.text();
        if (!r.ok) return { ok:false, error: text || `${r.status}` };
        return { ok:true, action: 'inserted', data: JSON.parse(text || '[]') };
      }
    } catch (e) {
      return { ok:false, error:e };
    }
  }
}

// -------------- Render leaderboard (dedupe by username, show highest) --------------
async function renderLeaderboard() {
  const listEl = $('leadersList');
  if (!listEl) return;
  listEl.innerHTML = '<small style="color:#666">Loading…</small>';

  const remote = await remoteFetchTop(10);
  let rows = [];
  if (remote.ok && Array.isArray(remote.data)) {
    // dedupe: keep highest score per username
    const map = new Map();
    for (const r of remote.data) {
      const uname = r.username || '(unknown)';
      const score = (typeof r.score === 'number') ? r.score : parseInt(r.score) || 0;
      if (!map.has(uname) || score > map.get(uname).score) map.set(uname, { username: uname, score, created_at: r.created_at });
    }
    rows = Array.from(map.values());
    rows.sort((a,b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at));
    rows = rows.slice(0, 10);
    $('message').textContent = '';
  } else {
    console.warn('remoteFetchTop failed:', remote.error);
    $('message').textContent = 'Could not reach Supabase — showing local scores.';
    rows = localLoadAll().slice(0, 10);
  }

  if (!rows || rows.length === 0) {
    listEl.innerHTML = '<div class="row"><small style="color:#666">No scores yet</small></div>';
    return;
  }

  const myName = localStorage.getItem('chihuahua_username') || '';
  listEl.innerHTML = '';
  rows.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'row' + (r.username === myName ? ' me' : '');
    div.innerHTML = `<div>${i+1}. ${escapeHtml(r.username)}</div><div>${escapeHtml(String(r.score))}</div>`;
    listEl.appendChild(div);
  });
}

// -------------- Username set flow (modal) --------------
async function setUsernameFlow() {
  const suggested = localStorage.getItem('chihuahua_username') || '';
  const raw = await openModal(suggested); // returns string | null
  if (raw === null) return false; // cancelled
  const name = sanitizeName(raw);

  // local format
  if (!isValidFormat(name)) {
    const errEl = $('modalError');
    if (errEl) { errEl.textContent = 'Name must be 2–24 chars and only letters/numbers/_/-/space'; }
    await sleep(900);
    if (errEl) errEl.textContent = '';
    return setUsernameFlow();
  }

  // profanity
  const bad = await containsProfanity(name);
  if (bad) {
    const errEl = $('modalError');
    if (errEl) errEl.textContent = 'Disallowed words detected.';
    await sleep(900);
    if (errEl) errEl.textContent = '';
    return setUsernameFlow();
  }

  // check remote uniqueness if possible
  const remote = await remoteFetchByUsername(name);
  if (!remote.ok) {
    // remote unreachable: only block if exists locally and isn't our stored name
    const localArr = localLoadAll();
    const takenLocally = localArr.some(r => r.username === name);
    const stored = localStorage.getItem('chihuahua_username') || '';
    if (takenLocally && name !== stored) {
      const errEl = $('modalError');
      if (errEl) errEl.textContent = 'Name taken locally. Pick another.';
      await sleep(900);
      if (errEl) errEl.textContent = '';
      return setUsernameFlow();
    }
    // allow local registration
    localStorage.setItem('chihuahua_username', name);
    const disp = $('usernameDisplay');
    if (disp) disp.textContent = `You: ${escapeHtml(name)}`;
    $('message').textContent = 'Registered locally (Supabase unreachable).';
    await renderLeaderboard();
    return true;
  } else {
    const exists = Array.isArray(remote.data) && remote.data.length > 0;
    const stored = localStorage.getItem('chihuahua_username') || '';
    if (exists && name !== stored) {
      const errEl = $('modalError');
      if (errEl) errEl.textContent = 'That name already exists on leaderboard. Pick another.';
      await sleep(900);
      if (errEl) errEl.textContent = '';
      return setUsernameFlow();
    }
    // passed checks
    localStorage.setItem('chihuahua_username', name);
    const disp = $('usernameDisplay');
    if (disp) disp.textContent = `You: ${escapeHtml(name)}`;
    $('message').textContent = '';
    await renderLeaderboard();
    return true;
  }
}

// -------------- Submit score flow (replace existing) --------------
async function submitScoreFlow() {
  const name = localStorage.getItem('chihuahua_username');
  if (!name) { alert('Set a username first.'); return; }

  $('message').textContent = 'Submitting…';
  try {
    const res = await remoteUpsertOrUpdate(name, spinCounter);
    if (res.ok) {
      $('message').textContent = 'Score saved to Supabase.';
      localReplace(name, spinCounter); // keep local copy too
      await renderLeaderboard();
      return;
    } else {
      console.warn('remoteUpsertOrUpdate failed:', res.error);
      const ok = localReplace(name, spinCounter);
      $('message').textContent = ok ? 'Saved locally (Supabase unreachable).' : 'Failed to save (check console).';
      await renderLeaderboard();
      return;
    }
  } catch (e) {
    console.error('submitScoreFlow exception', e);
    const ok = localReplace(name, spinCounter);
    $('message').textContent = ok ? 'Saved locally (error contacting Supabase).' : 'Failed to save.';
    await renderLeaderboard();
    return;
  }
}

// ---------------- Wire up UI once DOM is ready ----------------
function initOnceDomReady() {
  // ensure modal internal elements exist (modalOk/modalCancel IDs expected)
  // The HTML you told me is fine already has modal elements with these IDs.
  const openBtn = $('openNameBtn');
  const submitBtn = $('submitScoreBtn');

  if (!openBtn || !submitBtn) {
    console.error('Expected UI buttons missing (openNameBtn / submitScoreBtn). Check your HTML matches expected IDs.');
    return;
  }

  openBtn.addEventListener('click', setUsernameFlow);
  submitBtn.addEventListener('click', submitScoreFlow);

  // initialize displayed username
  const stored = localStorage.getItem('chihuahua_username');
  const disp = $('usernameDisplay');
  if (disp) disp.textContent = stored ? `You: ${escapeHtml(stored)}` : 'You: (not set)';

  // initial render
  renderLeaderboard();

  // periodic refresh in background
  setInterval(renderLeaderboard, 20000);
}

// If DOMContentLoaded already fired (script loaded with defer), init immediately
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOnceDomReady);
} else {
  initOnceDomReady();
}
