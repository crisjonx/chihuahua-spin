// ------------------- CONFIG: your supabase values --------------------
const SUPABASE_URL = 'https://cxbigjfbzupynkysbdiq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-GoEqPCuKkBsI8N554ME6g_tnqE7L-o';
// --------------------------------------------------------------------

const PURGOMALUM_CONTAINS = 'https://www.purgomalum.com/service/containsprofanity?text=';

// supabase client (from CDN global)
const supabase = window.supabase && typeof window.supabase.createClient === 'function'
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

if (!supabase) console.warn('Supabase client not loaded. Remote features will fail.');

// ---------- simple helpers ----------
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(res => setTimeout(res, ms));
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// ---------- spin counter ----------
let spinCounter = -1;
const spinInterval = 4200;
function updateSpinCountUI() {
  spinCounter++;
  $('spinCount').textContent = spinCounter;
  $('spinText').textContent = (spinCounter === 1 ? 'spin' : 'spins');
}
updateSpinCountUI();
setInterval(updateSpinCountUI, spinInterval);

// ---------- username validators ----------
function sanitizeName(raw) { return raw ? raw.trim() : ''; }
function isValidFormat(name) {
  if (!name) return false;
  if (name.length < 2 || name.length > 24) return false;
  return /^[A-Za-z0-9 _\-]+$/.test(name);
}
async function containsProfanity(name) {
  try {
    const r = await fetch(PURGOMALUM_CONTAINS + encodeURIComponent(name), {cache:'no-store'});
    if (!r.ok) return true;
    const t = (await r.text()).trim().toLowerCase();
    return t === 'true';
  } catch (e) {
    console.warn('Profanity API failed', e);
    // fail-safe: treat failure as profanity to avoid bad names
    return true;
  }
}

// ---------- modal UI (returns value or null) ----------
function openModal(initial = '') {
  return new Promise(resolve => {
    const overlay = $('overlay');
    const input = $('modalInput');
    const ok = $('modalOk');
    const cancel = $('modalCancel');
    const err = $('modalError');

    document.body.classList.add('modal-open');
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    err.textContent = '';
    input.value = initial;
    input.focus();
    input.select();

    function close(value) {
      overlay.classList.remove('show');
      document.body.classList.remove('modal-open');
      overlay.setAttribute('aria-hidden', 'true');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      resolve(value);
    }
    function onOk() {
      close(input.value);
    }
    function onCancel() {
      close(null);
    }
    function onKey(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

// ---------- supabase wrappers (select->update->insert fallback) ----------
async function remoteFetchByUsername(name) {
  if (!supabase) return { ok: false, error: 'no client' };
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('id,username,score,created_at')
      .eq('username', name)
      .limit(100); // get any duplicates if present
    if (error) return { ok:false, error };
    return { ok: true, data };
  } catch (e) {
    return { ok:false, error: e };
  }
}

async function remoteFetchTop(limit = 10) {
  if (!supabase) return { ok: false, error: 'no client' };
  try {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('username,score,created_at')
      .order('score', { ascending: false })
      .limit(limit * 5); // fetch extra in case of duplicates, we'll reduce
    if (error) return { ok:false, error };
    return { ok: true, data };
  } catch (e) {
    return { ok:false, error: e };
  }
}

async function remoteUpsertOrUpdate(name, score) {
  if (!supabase) return { ok:false, error:'no client' };
  try {
    // 1) see if row(s) exist
    const r = await remoteFetchByUsername(name);
    if (!r.ok) return { ok:false, error: r.error };

    const rows = r.data || [];
    if (rows.length > 0) {
      // update ALL matching rows to the new score (keeps DB simple if duplicates exist)
      const { error: uerr } = await supabase
        .from('leaderboard')
        .update({ score })
        .eq('username', name);
      if (uerr) return { ok:false, error: uerr };
      return { ok:true, action: 'updated' };
    } else {
      // insert new row
      const { data, error: ierr } = await supabase
        .from('leaderboard')
        .insert([{ username: name, score }])
        .select();
      if (ierr) return { ok:false, error: ierr };
      return { ok:true, action: 'inserted', data };
    }
  } catch (e) {
    return { ok:false, error: e };
  }
}

// ---------- local fallback storage (keeps only one entry per username) ----------
const LOCAL_KEY = 'chihuahua_local_leaderboard';
function localLoadAll() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { console.error(e); return []; }
}
function localSaveAll(arr) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(arr)); return true; } catch(e){console.error(e); return false;}
}
function localSubmitReplace(username, score) {
  const arr = localLoadAll();
  const idx = arr.findIndex(r => r.username === username);
  const row = { username, score, created_at: new Date().toISOString() };
  if (idx >= 0) arr[idx] = row; else arr.push(row);
  arr.sort((a,b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at));
  return localSaveAll(arr.slice(0,100));
}

// ---------- UI: render leaderboard (reduces duplicates, picks highest score per name) ----------
async function renderLeaderboard() {
  const listEl = $('leadersList');
  listEl.innerHTML = '<small style="color:#666">Loading…</small>';

  // try remote
  const remote = await remoteFetchTop(10);
  let rows = null;
  if (remote.ok && Array.isArray(remote.data)) {
    // reduce duplicates by username: keep the highest score (so user sees only one entry)
    const map = new Map();
    for (const r of remote.data) {
      const uname = r.username || '(unknown)';
      const score = typeof r.score === 'number' ? r.score : parseInt(r.score) || 0;
      if (!map.has(uname) || score > map.get(uname).score) {
        map.set(uname, { username: uname, score, created_at: r.created_at });
      }
    }
    rows = Array.from(map.values());
    // sort desc
    rows.sort((a,b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at));
    rows = rows.slice(0,10);
    $('message').textContent = '';
  } else {
    // remote failed — fallback to local
    console.warn('remoteFetchTop failed:', remote.error);
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

// ---------- username flow: open modal -> validate -> store ----------
async function setUsernameFlow() {
  const suggested = localStorage.getItem('chihuahua_username') || '';
  const raw = await openModal(suggested); // returns string or null
  if (raw === null) return false; // cancelled
  const name = sanitizeName(raw);
  // local format
  if (!isValidFormat(name)) {
    // show immediate inline error and reopen modal
    $('modalError').textContent = 'Name must be 2–24 chars: letters, numbers, spaces, _ or -';
    await sleep(800);
    $('modalError').textContent = '';
    return setUsernameFlow();
  }
  // profanity
  const bad = await containsProfanity(name);
  if (bad) {
    $('modalError').textContent = 'Disallowed words detected. Pick another name.';
    await sleep(1000);
    $('modalError').textContent = '';
    return setUsernameFlow();
  }

  // check remote uniqueness (if possible)
  const remote = await remoteFetchByUsername(name);
  if (!remote.ok) {
    // if we can't reach remote, check local only and warn user
    const localArr = localLoadAll();
    if (localArr.some(r => r.username === name && localStorage.getItem('chihuahua_username') !== name)) {
      $('modalError').textContent = 'Name taken locally. Choose another.';
      await sleep(900);
      $('modalError').textContent = '';
      return setUsernameFlow();
    }
    // remote unreachable — allow name ONLY if it's not taken locally
    localStorage.setItem('chihuahua_username', name);
    $('usernameDisplay').textContent = `You: ${escapeHtml(name)}`;
    $('message').textContent = 'Registered locally (Supabase unreachable).';
    await renderLeaderboard();
    return true;
  } else {
    // remote reachable
    const exists = (remote.data && remote.data.length > 0);
    const stored = localStorage.getItem('chihuahua_username') || '';
    if (exists && name !== stored) {
      $('modalError').textContent = 'That name already exists on the leaderboard. Pick another.';
      await sleep(900);
      $('modalError').textContent = '';
      return setUsernameFlow();
    }
    // passed
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
  // try remote upsert/update
  const remoteRes = await remoteUpsertOrUpdate(name, spinCounter);
  if (remoteRes.ok) {
    $('message').textContent = 'Score saved to Supabase.';
    // also keep local copy for offline fallback
    localSubmitReplace(name, spinCounter);
    await renderLeaderboard();
    return;
  } else {
    console.warn('Remote submit failed:', remoteRes.error);
    // fallback local replace
    const ok = localSubmitReplace(name, spinCounter);
    $('message').textContent = ok ? 'Saved locally (Supabase unreachable).' : 'Failed to save. Check console.';
    await renderLeaderboard();
    return;
  }
}

// ---------- wire UI ----------
document.addEventListener('DOMContentLoaded', () => {
  $('openNameBtn').addEventListener('click', async () => {
    // show modal by programmatically focusing the input and awaiting result
    // We'll rely on openModal helper defined earlier — but we need to wire modal OK/Cancel here too.
    // The openModal function opens the overlay and returns the input value.
    // Implementation note: modal's internal events already resolve it, so just call setUsernameFlow after openModal resolves.
    // We call setUsernameFlow which will display the modal and validate.
    await setUsernameFlow();
  });

  // connect modal internal buttons to modal functions:
  // (openModal already handles the ok/cancel wiring by returning a Promise that resolves with input value.)
  // So we need to connect the DOM modal elements: modalOk/modalCancel/modalInput are wired in openModal handler.

  $('submitScoreBtn').addEventListener('click', submitScoreFlow);

  // init UI from stored name
  const stored = localStorage.getItem('chihuahua_username');
  $('usernameDisplay').textContent = stored ? `You: ${escapeHtml(stored)}` : 'You: (not set)';

  // first render
  renderLeaderboard();

  // periodic refresh
  setInterval(renderLeaderboard, 20000);
});

// small hook to transfer modal input text into setUsernameFlow's openModal call
// (the openModal above uses the modal elements; but we still need to ensure modal input/ok/cancel events exist)
(function hookModalButtons(){
  const overlay = $('overlay'), input = $('modalInput'), ok = $('modalOk'), cancel = $('modalCancel'), err = $('modalError');
  // The openModal implementation attached event listeners dynamically and will resolve a promise.
  // This helper just ensures modal elements exist and focus behavior is reasonable.
  if (!overlay) return;
  overlay.addEventListener('click', (e) => {
    // clicking overlay outside modal does NOT close (to avoid accidental close)
    if (e.target === overlay) {
      // do nothing
    }
  });
})();
