// ------------------- CONFIG: your supabase values --------------------
const SUPABASE_URL = 'https://cxbigjfbzupynkysbdiq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-GoEqPCuKkBsI8N554ME6g_tnqE7L-o';
// --------------------------------------------------------------------

const PURGOMALUM_CONTAINS = 'https://www.purgomalum.com/service/containsprofanity?text=';

// minimal helpers
const el = id => document.getElementById(id);
const sleep = ms => new Promise(res => setTimeout(res, ms));

// create supabase client
const supabase = supabaseJs.createClient
  ? supabaseJs.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) // some bundles expose supabaseJs
  : supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // default global name

document.addEventListener('DOMContentLoaded', () => {
  const spinCountEl = el('spinCount');
  const spinTextEl  = el('spinText');
  const usernameDisplay = el('usernameDisplay');
  const leadersList = el('leadersList');
  const messageEl = el('message');
  const setNameBtn = el('setNameBtn');
  const submitScoreBtn = el('submitScoreBtn');

  // simple spin counter
  let spinCounter = -1;
  const spinInterval = 4200;
  function updateSpinCount() {
    spinCounter++;
    spinCountEl.textContent = spinCounter;
    spinTextEl.textContent = spinCounter === 1 ? 'spin' : 'spins';
  }
  updateSpinCount();
  setInterval(updateSpinCount, spinInterval);

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // sanitizers + local validation
  function sanitizeLocalName(raw) {
    return raw ? raw.trim() : '';
  }
  function isValidLocalFormat(name) {
    if (!name) return false;
    if (name.length < 2 || name.length > 24) return false;
    return /^[A-Za-z0-9 _\-]+$/.test(name);
  }

  // profanity check (fail-safe: treat service failure as "contains profanity")
  async function containsProfanity(name) {
    try {
      const r = await fetch(PURGOMALUM_CONTAINS + encodeURIComponent(name), { cache: 'no-store' });
      if (!r.ok) return true;
      const text = await r.text();
      return text.trim().toLowerCase() === 'true';
    } catch (err) {
      console.warn('Profanity check failed:', err);
      return true;
    }
  }

  // --- DB helpers using supabase-js ---

  // check whether username exists remotely
  async function remoteUsernameExists(name) {
    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('username')
        .eq('username', name)
        .limit(1);
      if (error) {
        console.log('remoteUsernameExists error', error);
        return null; // signal "can't determine"
      }
      return data && data.length > 0;
    } catch (err) {
      console.error('remoteUsernameExists exception', err);
      return null;
    }
  }

  // fetch top rows
  async function fetchLeaderboard(limit = 10) {
    try {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('username,score,created_at')
        .order('score', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) {
        console.log('fetchLeaderboard error', error);
        return null;
      }
      return data || [];
    } catch (err) {
      console.error('fetchLeaderboard exception', err);
      return null;
    }
  }

  // upsert (insert or update by username). Use upsert with onConflict.
  async function upsertScore(username, score) {
    try {
      // attempt upsert (requires RLS/policies that permit update)
      const { data, error } = await supabase
        .from('leaderboard')
        .upsert([{ username, score }], { onConflict: 'username' })
        .select();
      if (error) {
        console.log('upsertScore returned error, will try update/insert fallback:', error);
        // fallback: if conflict handling not allowed, attempt update then insert
        // try update first
        const { data: udata, error: uerr } = await supabase
          .from('leaderboard')
          .update({ score })
          .eq('username', username);
        if (uerr) {
          console.log('update attempt error:', uerr);
          // try insert
          const { data: idata, error: ierr } = await supabase
            .from('leaderboard')
            .insert([{ username, score }])
            .select();
          if (ierr) {
            console.error('insert fallback error:', ierr);
            return { ok: false, reason: ierr.message || ierr };
          }
          return { ok: true, data: idata };
        }
        return { ok: true, data: udata };
      }
      return { ok: true, data };
    } catch (err) {
      console.error('upsertScore exception', err);
      return { ok: false, reason: err.message || err };
    }
  }

  // ----------------- local fallback (if supabase unreachable) -----------------
  function submitScoreToLocal(username, score) {
    try {
      const key = 'chihuahua_local_leaderboard';
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      // replace any existing local entry for username
      const idx = arr.findIndex(r => r.username === username);
      const entry = { username, score, created_at: new Date().toISOString() };
      if (idx >= 0) arr[idx] = entry; else arr.push(entry);
      arr.sort((a, b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at));
      localStorage.setItem(key, JSON.stringify(arr.slice(0, 100)));
      return true;
    } catch (err) {
      console.error('submitScoreToLocal error', err);
      return false;
    }
  }
  function fetchLeaderboardFromLocal(limit = 10) {
    try {
      const raw = localStorage.getItem('chihuahua_local_leaderboard');
      const arr = raw ? JSON.parse(raw) : [];
      return arr.slice(0, limit);
    } catch (err) {
      console.error('fetchLeaderboardFromLocal error', err);
      return [];
    }
  }

  // ----------------- UI & username flow -----------------
  function showMessage(txt, isError = true) {
    messageEl.textContent = txt || '';
    messageEl.style.color = isError ? '#b00' : '#080';
  }

  function updateUsernameDisplay(name) {
    usernameDisplay.textContent = name ? `You: ${escapeHtml(name)}` : 'You: (not set)';
  }

  async function promptForUsernameFlow() {
    // prompt with native prompt (simple minimal)
    while (true) {
      const suggested = localStorage.getItem('chihuahua_username') || '';
      const raw = prompt('Choose a username (2–24 chars). Names already on leaderboard are blocked.', suggested);
      if (raw === null) return null; // cancelled
      const name = sanitizeLocalName(raw);
      if (!isValidLocalFormat(name)) {
        alert('Name must be 2–24 characters and only letters, numbers, spaces, underscores or hyphens.');
        continue;
      }
      showMessage('Checking name…', false);

      // profanity
      const hasProf = await containsProfanity(name);
      if (hasProf) {
        alert('That username contains disallowed words. Pick another.');
        showMessage('', true);
        continue;
      }

      // check remote: disallow if exists and isn't the same as our stored one
      const stored = localStorage.getItem('chihuahua_username');
      const remoteExists = await remoteUsernameExists(name);
      if (remoteExists === null) {
        // couldn't determine — safe option: block if remote unreachable to avoid collisions
        alert('Could not check remote leaderboard — try again or pick a different name.');
        showMessage('', true);
        continue;
      }
      if (remoteExists && name !== stored) {
        alert('That name is already taken on the leaderboard. Pick another.');
        showMessage('', true);
        continue;
      }

      // passed checks — store and return
      localStorage.setItem('chihuahua_username', name);
      updateUsernameDisplay(name);
      showMessage('Name set.', false);
      await sleep(400);
      showMessage('');
      return name;
    }
  }

  // ----------------- render leaderboard -----------------
  async function renderLeaderboard() {
    leadersList.innerHTML = '<small class="note">Loading…</small>';
    const localName = localStorage.getItem('chihuahua_username') || '';
    let rows = await fetchLeaderboard(10);
    if (rows === null) {
      // supabase not reachable / error — show local
      showMessage('Could not reach Supabase — showing local scores (if any).', true);
      rows = fetchLeaderboardFromLocal(10);
    } else {
      showMessage('');
    }

    if (!rows || rows.length === 0) {
      leadersList.innerHTML = '<div class="row"><small class="note">No scores yet</small></div>';
      return;
    }
    leadersList.innerHTML = '';
    rows.forEach((r, i) => {
      const div = document.createElement('div');
      div.className = 'row' + (r.username === localName ? ' me' : '');
      const uname = escapeHtml(r.username || '(unknown)');
      const score = typeof r.score === 'number' ? r.score : (r.score ?? 0);
      div.innerHTML = `<div>${i+1}. ${uname}</div><div>${escapeHtml(String(score))}</div>`;
      leadersList.appendChild(div);
    });
  }

  // ----------------- button handlers -----------------
  setNameBtn.addEventListener('click', async () => {
    await promptForUsernameFlow();
    await renderLeaderboard();
  });

  submitScoreBtn.addEventListener('click', async () => {
    const name = localStorage.getItem('chihuahua_username');
    if (!name) {
      alert('Set a username first.');
      return;
    }
    showMessage('Submitting score…', false);
    // try upsert
    const res = await upsertScore(name, spinCounter);
    if (res.ok) {
      showMessage('Score submitted.', false);
    } else {
      console.warn('Upsert failed:', res.reason);
      // fallback: save locally
      const localOk = submitScoreToLocal(name, spinCounter);
      showMessage(localOk ? 'Could not submit to Supabase — saved locally.' : 'Failed to submit (local fallback failed).');
    }
    await renderLeaderboard();
  });

  // ----------------- init -----------------
  (async function init() {
    updateUsernameDisplay(localStorage.getItem('chihuahua_username'));
    await renderLeaderboard();
    // refresh occasionally so others appear (20s)
    setInterval(renderLeaderboard, 20000);
  })();

});
