// ================= CONFIG - already filled with your values =================
const SUPABASE_URL = 'https://cxbigjfbzupynkysbdiq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-GoEqPCuKkBsI8N554ME6g_tnqE7L-o';
// ===========================================================================

const PURGOMALUM_CONTAINS = 'https://www.purgomalum.com/service/containsprofanity?text=';

document.addEventListener('DOMContentLoaded', () => {
  // --- Elements ---
  const spinCountEl = document.getElementById('spinCount');
  const spinTextEl = document.getElementById('spinText');
  const usernameDisplay = document.getElementById('usernameDisplay');
  const leadersList = document.getElementById('leadersList');
  const messageEl = document.getElementById('message');
  const submitScoreBtn = document.getElementById('submitScoreBtn');
  const changeNameBtn = document.getElementById('changeNameBtn');

  // --- Spin counter setup ---
  let spinCounter = -1;
  const spinInterval = 4200;
  function updateSpinCount() {
    spinCounter++;
    spinCountEl.textContent = spinCounter;
    spinTextEl.textContent = (spinCounter === 1) ? 'spin' : 'spins';
  }
  updateSpinCount();
  setInterval(updateSpinCount, spinInterval);

  // --- Helpers ---
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function sanitizeLocalName(raw) {
    if (!raw) return '';
    return raw.trim();
  }

  function isValidLocalFormat(name) {
    if (!name) return false;
    if (name.length < 2 || name.length > 24) return false;
    return /^[A-Za-z0-9 _\-]+$/.test(name);
  }

  async function containsProfanity(name) {
    try {
      const resp = await fetch(PURGOMALUM_CONTAINS + encodeURIComponent(name), { cache: 'no-store' });
      if (!resp.ok) {
        console.warn('PurgoMalum returned non-OK:', resp.status);
        // fail-safe: treat as profanity if service fails
        return true;
      }
      const text = await resp.text();
      return text.trim().toLowerCase() === 'true';
    } catch (err) {
      console.error('Profanity API error:', err);
      // fail-safe: treat as profanity if error
      return true;
    }
  }

  // --- Username prompt / ensure ---
  async function promptForUsername(initialPrompt = 'Enter a username (2–24 chars):') {
    while (true) {
      const raw = prompt(initialPrompt, localStorage.getItem('chihuahua_username') || '');
      if (raw === null) return null; // user cancelled
      const name = sanitizeLocalName(raw);
      if (!isValidLocalFormat(name)) {
        alert('Name must be 2–24 characters and only letters, numbers, spaces, underscores or hyphens.');
        continue;
      }
      messageEl.textContent = 'Checking name...';
      const hasProfanity = await containsProfanity(name);
      if (hasProfanity) {
        alert('That username contains disallowed words. Please pick another name.');
        messageEl.textContent = '';
        continue;
      }
      localStorage.setItem('chihuahua_username', name);
      messageEl.textContent = '';
      return name;
    }
  }

  async function ensureUsername() {
    let name = localStorage.getItem('chihuahua_username');
    if (!name) {
      name = await promptForUsername();
    } else {
      if (!isValidLocalFormat(name)) {
        name = await promptForUsername('Your stored username is invalid — please enter a new one:');
      } else {
        const bad = await containsProfanity(name);
        if (bad) {
          name = await promptForUsername('Your stored username is no longer allowed — choose a new one:');
        }
      }
    }
    if (name) {
      usernameDisplay.textContent = `You: ${escapeHtml(name)}`;
      return name;
    } else {
      usernameDisplay.textContent = 'You: (no name)';
      return null;
    }
  }

  // --- Supabase REST helpers (with detailed logging) ---
  const SUPA_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
  };

  async function submitScoreToSupabase(username, score) {
    try {
      const url = `${SUPABASE_URL}/rest/v1/leaderboard`;
      const body = JSON.stringify({ username, score });

      const r = await fetch(url, {
        method: 'POST',
        headers: {
          ...SUPA_HEADERS,
          'Prefer': 'return=representation'
        },
        body
      });

      const text = await r.text().catch(() => '');
      console.log('submitScore response status=', r.status, 'statusText=', r.statusText, 'body=', text);

      if (!r.ok) {
        // return detailed error for UI
        throw new Error(`Submit failed: ${r.status} ${r.statusText} — ${text}`);
      }
      return true;
    } catch (err) {
      console.error('submitScoreToSupabase error:', err);
      return false;
    }
  }

  async function fetchLeaderboardFromSupabase(limit = 10) {
    try {
      const url = `${SUPABASE_URL}/rest/v1/leaderboard?select=username,score,created_at&order=score.desc,created_at.asc&limit=${limit}`;
      const r = await fetch(url, {
        method: 'GET',
        headers: SUPA_HEADERS
      });

      const text = await r.text();
      console.log('fetchLeaderboard response status=', r.status, 'body=', text);

      if (!r.ok) {
        throw new Error(`Fetch failed: ${r.status} ${r.statusText} — ${text}`);
      }

      // If response is empty string, return []
      if (!text) return [];
      return JSON.parse(text);
    } catch (err) {
      console.error('fetchLeaderboardFromSupabase error:', err);
      return null; // signal failure so caller can fallback
    }
  }

  // --- Fallback localStorage leaderboard (if Supabase fails) ---
  function submitScoreToLocal(username, score) {
    try {
      const key = 'chihuahua_local_leaderboard';
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push({ username, score, created_at: new Date().toISOString() });
      // keep only top 100 locally
      arr.sort((a, b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at));
      localStorage.setItem(key, JSON.stringify(arr.slice(0, 100)));
      return true;
    } catch (err) {
      console.error('submitScoreToLocal error:', err);
      return false;
    }
  }

  function fetchLeaderboardFromLocal(limit = 10) {
    try {
      const raw = localStorage.getItem('chihuahua_local_leaderboard');
      const arr = raw ? JSON.parse(raw) : [];
      return arr.slice(0, limit);
    } catch (err) {
      console.error('fetchLeaderboardFromLocal error:', err);
      return [];
    }
  }

  // --- UI: refresh leaderboard and highlight user ---
  async function refreshLeaderboard() {
    leadersList.innerHTML = 'Loading...';
    const you = localStorage.getItem('chihuahua_username') || '';
    // Try Supabase first
    const rows = await fetchLeaderboardFromSupabase(10);
    if (rows === null) {
      // Supabase failed — show fallback and note in UI
      messageEl.textContent = 'Could not reach Supabase — showing local scores (if any).';
      const localRows = fetchLeaderboardFromLocal(10);
      if (!localRows || localRows.length === 0) {
        leadersList.innerHTML = '<div style="padding:6px 0">No scores yet — be the first!</div>';
        return;
      }
      leadersList.innerHTML = '';
      localRows.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = 'row' + (r.username === you ? ' me' : '');
        div.innerHTML = `<div>${i+1}. ${escapeHtml(r.username)}</div><div>${r.score}</div>`;
        leadersList.appendChild(div);
      });
      return;
    }

    // Supabase returned rows
    messageEl.textContent = '';
    if (!rows || rows.length === 0) {
      leadersList.innerHTML = '<div style="padding:6px 0">No scores yet — be the first!</div>';
      return;
    }
    leadersList.innerHTML = '';
    rows.forEach((r, i) => {
      const div = document.createElement('div');
      div.className = 'row' + (r.username === you ? ' me' : '');
      const username = r.username ?? '(unknown)';
      const score = (typeof r.score === 'number') ? r.score : (r.score ?? '0');
      div.innerHTML = `<div>${i+1}. ${escapeHtml(username)}</div><div>${escapeHtml(String(score))}</div>`;
      leadersList.appendChild(div);
    });
  }

  // --- Button bindings ---
  submitScoreBtn.addEventListener('click', async () => {
    const name = localStorage.getItem('chihuahua_username');
    if (!name) {
      alert('No username set. Please choose a username first.');
      await ensureUsername();
      return;
    }

    messageEl.textContent = 'Submitting score...';
    // try Supabase
    const supaOk = await submitScoreToSupabase(name, spinCounter);
    if (supaOk) {
      messageEl.textContent = 'Score submitted to Supabase!';
    } else {
      // fallback: localStorage + tell user
      const localOk = submitScoreToLocal(name, spinCounter);
      messageEl.textContent = localOk
        ? 'Could not submit to Supabase — saved locally instead.'
        : 'Failed to submit score (Supabase & localStorage both failed). Check console.';
    }

    await refreshLeaderboard();
  });

  changeNameBtn.addEventListener('click', async () => {
    localStorage.removeItem('chihuahua_username');
    await ensureUsername();
    await refreshLeaderboard();
  });

  // --- Init on load ---
  (async function init() {
    await ensureUsername();
    await refreshLeaderboard();
    // optional: refresh leaderboard every 20s so it doesn't get stale
    setInterval(refreshLeaderboard, 20000);
  })();
});
