// ------------------- CONFIG --------------------
const SUPABASE_URL = 'https://cxbigjfbzupynkysbdiq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-GoEqPCuKkBsI8N554ME6g_tnqE7L-o';
// -----------------------------------------------

console.log('script.js loaded'); // confirms script executed

// ensure supabase client exists
const supabase = (window && window.supabase && typeof window.supabase.createClient === 'function')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

if (supabase) console.log('Supabase client ready');
else console.warn('Supabase client not available - check CDN script tag and network (supabase features will fallback to localStorage)');

const PURGOMALUM_CONTAINS = 'https://www.purgomalum.com/service/containsprofanity?text=';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(res => setTimeout(res, ms));

// ---------- UI + spin counter ----------
let spinCounter = -1;
const spinInterval = 4200;
function updateSpinCountUI() {
  spinCounter++;
  const spinCountEl = $('spinCount');
  const spinTextEl = $('spinText');
  if (spinCountEl) spinCountEl.textContent = spinCounter;
  if (spinTextEl) spinTextEl.textContent = (spinCounter === 1 ? 'spin' : 'spins');
}
updateSpinCountUI();
setInterval(updateSpinCountUI, spinInterval);

// ---------- helpers ----------
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
    if (!r.ok) return true;
    const t = (await r.text()).trim().toLowerCase();
    return t === 'true';
  } catch (e) {
    console.warn('Profanity API failed', e);
    return true; // fail-safe
  }
}

// ---------- modal helpers ----------
function showModal(initial = '') {
  return new Promise(resolve => {
    const overlay = $('overlay');
    const input = $('modalInput');
    const ok = $('modalOk');
    const cancel = $('modalCancel');
    const err = $('modalError');

    document.body.classList.add('modal-open');
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden','false');
    err.textContent = '';
    input.value = initial;
    input.focus();
    input.select();

    function close(returnValue) {
      overlay.classList.remove('show');
      document.body.classList.remove('modal-open');
      overlay.setAttribute('aria-hidden','true');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      resolve(returnValue);
    }
    function onOk() { close(input.value); }
    function onCancel() { close(null); }
    function onKey(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

// ---------- local fallback storage ----------
const LOCAL_KEY = 'chihuahua_local_leaderboard';
function localLoadAll() {
  try { const raw = localStorage.getItem(LOCAL_KEY); return raw ? JSON.parse(raw) : []; }
  catch(e){ console.error(e); return []; }
}
function localSaveAll(arr) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(arr)); return true; }
  catch(e){ console.error(e); return false; }
}
function localReplace(username, score) {
  const arr = localLoadAll();
  const idx = arr.findIndex(r => r.username === username);
  const entry = { username, score, created_at: new Date().toISOString() };
  if (idx >= 0) arr[idx] = entry; else arr.push(entry);
  arr.sort((a,b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at));
  return localSaveAll(arr.slice(0,100));
}

// ---------- remote helpers (use supabase client if available) ----------
async function remoteGetByUsername(name) {
  if (!supabase) return { ok:false, error:'no client' };
  try {
    const { data, error } = await supabase.from('leaderboard').select('id,username,score,created_at').eq('username', name).limit(100);
    if (error) return { ok:false, error };
    return { ok:true, data };
  } catch (e) { return { ok:false, error:e }; }
}
async function remoteGetTop() {
  if (!supabase) return { ok:false, error:'no client' };
  try {
    const { data, error } = await supabase.from('leaderboard').select('username,score,created_at').order('score',{ascending:false}).limit(100);
    if (error) return { ok:false, error };
    return { ok:true, data };
  } catch (e) { return { ok:false, error:e }; }
}
async function remoteUpsertOrUpdate(name, score) {
  if (!supabase) return { ok:false, error:'no client' };
  try {
    // check existing
    const r = await remoteGetByUsername(name);
    if (!r.ok) return { ok:false, error:r.error };
    if (r.data.length > 0) {
      const { error } = await supabase.from('leaderboard').update({ score }).eq('username', name);
      if (error) return { ok:false, error };
      return { ok:true, action:'updated' };
    } else {
      const { data, error } = await supabase.from('leaderboard').insert([{ username:name, score }]).select();
      if (error) return { ok:false, error };
      return { ok:true, action:'inserted', data };
    }
  } catch (e) { return { ok:false, error:e }; }
}

// ---------- render leaderboard (dedupe, highest score wins) ----------
async function renderLeaderboard() {
  const listEl = $('leadersList');
  if (!listEl) return;
  listEl.innerHTML = '<small style="color:#666">Loading…</small>';

  // try remote first
  const remote = await remoteGetTop();
  let rows = [];
  if (remote.ok && Array.isArray(remote.data)) {
    // reduce duplicates by username -> keep highest
    const map = new Map();
    for (const r of remote.data) {
      const uname = r.username || '(unknown)';
      const score = typeof r.score === 'number' ? r.score : parseInt(r.score) || 0;
      if (!map.has(uname) || score > map.get(uname).score) map.set(uname, { username:uname, score, created_at:r.created_at });
    }
    rows = Array.from(map.values()).sort((a,b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at)).slice(0,10);
    $('message').textContent = '';
  } else {
    console.warn('remoteGetTop failed:', remote.error);
    $('message').textContent = 'Could not reach Supabase — showing local scores.';
    rows = localLoadAll().slice(0,10);
  }

  if (!rows || rows.length === 0) {
    listEl.innerHTML = '<div class="row"><small style="color:#666">No scores yet</small></div>';
    return;
  }
  const myName = localStorage.getItem('chihuahua_username') || '';
  listEl.innerHTML = '';
  rows.forEach((r,i) => {
    const div = document.createElement('div');
    div.className = 'row' + (r.username === myName ? ' me' : '');
    div.innerHTML = `<div>${i+1}. ${escapeHtml(r.username)}</div><div>${escapeHtml(String(r.score))}</div>`;
    listEl.appendChild(div);
  });
}

// ---------- username flow ----------
async function setUsernameFlow() {
  const suggested = localStorage.getItem('chihuahua_username') || '';
  const raw = await showModal(suggested);
  if (raw === null) return false;
  const name = sanitizeName(raw);
  if (!isValidFormat(name)) {
    $('modalError').textContent = 'Name must be 2–24 chars (letters/numbers/_/-/space)';
    await sleep(900);
    $('modalError').textContent = '';
    return setUsernameFlow();
  }
  const prof = await containsProfanity(name);
  if (prof) {
    $('modalError').textContent = 'Disallowed word detected.';
    await sleep(900);
    $('modalError').textContent = '';
    return setUsernameFlow();
  }

  // check remote uniqueness if possible
  const remote = await remoteGetByUsername(name);
  if (!remote.ok) {
    // remote unreachable: only block if name exists locally and isn't yours
    const local = localLoadAll();
    const takenLocally = local.some(r => r.username === name);
    const stored = localStorage.getItem('chihuahua_username') || '';
    if (takenLocally && name !== stored) {
      $('modalError').textContent = 'Name taken locally. Pick another.';
      await sleep(900);
      $('modalError').textContent = '';
      return setUsernameFlow();
    }
    // allow and store locally
    localStorage.setItem('chihuahua_username', name);
    $('usernameDisplay').textContent = `You: ${escapeHtml(name)}`;
    $('message').textContent = 'Registered locally (Supabase unreachable).';
    await renderLeaderboard();
    return true;
  } else {
    // remote checked
    const exists = (remote.data && remote.data.length > 0);
    const stored = localStorage.getItem('chihuahua_username') || '';
    if (exists && name !== stored) {
      $('modalError').textContent = 'That name already exists on the leaderboard. Pick another.';
      await sleep(900);
      $('modalError').textContent = '';
      return setUsernameFlow();
    }
    localStorage.setItem('chihuahua_username', name);
    $('usernameDisplay').textContent = `You: ${escapeHtml(name)}`;
    $('message').textContent = '';
    await renderLeaderboard();
    return true;
  }
}

// ---------- submit score ----------
async function submitScoreFlow() {
  const name = localStorage.getItem('chihuahua_username');
  if (!name) { alert('Set a username first.'); return; }
  $('message').textContent = 'Submitting…';
  const res = await remoteUpsertOrUpdate(name, spinCounter);
  if (res.ok) {
    $('message').textContent = 'Score saved to Supabase.';
    localReplace(name, spinCounter); // update local copy too
    await renderLeaderboard();
  } else {
    console.warn('Remote submit failed:', res.error);
    const ok = localReplace(name, spinCounter);
    $('message').textContent = ok ? 'Saved locally (Supabase unreachable).' : 'Failed to save. Check console.';
    await renderLeaderboard();
  }
}

// ---------- wire UI ----------
document.addEventListener('DOMContentLoaded', () => {
  // make sure elements exist
  if (!$('openNameBtn') || !$('submitScoreBtn')) {
    console.error('Expected DOM elements missing — check that index.html and script.js are in sync.');
    return;
  }

  $('openNameBtn').addEventListener('click', setUsernameFlow);
  $('submitScoreBtn').addEventListener('click', submitScoreFlow);

  // modal wiring for clicks is inside showModal; just ensure overlay elements exist
  const overlay = $('overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      // clicking outside doesn't close to avoid accidental cancels
      if (e.target === overlay) {
        // noop
      }
    });
  }

  // init UI
  const stored = localStorage.getItem('chihuahua_username');
  $('usernameDisplay').textContent = stored ? `You: ${escapeHtml(stored)}` : 'You: (not set)';
  renderLeaderboard();

  // refresh occasionally
  setInterval(renderLeaderboard, 20000);
});
