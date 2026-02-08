// ===== CONFIG - REPLACE THESE WITH YOUR OWN SUPABASE VALUES =====
const SUPABASE_URL = 'https://cxbigjfbzupynkysbdiq.supabase.co'; // replace
const SUPABASE_ANON_KEY = 'sb_publishable_-GoEqPCuKkBsI8N554ME6g_tnqE7L-o'; // replace
// =================================================================

// PurgoMalum profanity check endpoint
const PURGOMALUM_CONTAINS = 'https://www.purgomalum.com/service/containsprofanity?text=';

let spinCounter = -1;
const spinInterval = 4200;

const spinCountEl = () => document.getElementById('spinCount');
const spinTextEl = () => document.getElementById('spinText');
const usernameDisplay = document.getElementById('usernameDisplay');
const leadersList = document.getElementById('leadersList');
const messageEl = document.getElementById('message');

function updateSpinCount() {
  spinCounter++;
  const spinText = (spinCounter === 1) ? 'spin' : 'spins';
  spinCountEl().textContent = spinCounter;
  spinTextEl().textContent = spinText;
}
updateSpinCount();
setInterval(updateSpinCount, spinInterval);

// ---------- Username handling ----------
function sanitizeLocalName(raw) {
  if (!raw) return '';
  return raw.trim();
}
// basic client-side checks (length and allowed chars)
function isValidLocalFormat(name) {
  if (name.length < 2 || name.length > 24) return false;
  // allow letters, numbers, underscores, hyphens, spaces
  return /^[A-Za-z0-9 _\-]+$/.test(name);
}

// call PurgoMalum containsprofanity?text=...
async function containsProfanity(name) {
  try {
    const resp = await fetch(PURGOMALUM_CONTAINS + encodeURIComponent(name));
    if (!resp.ok) return true; // fail-safe: if API fails, treat as profanity (safer)
    const text = await resp.text();
    // PurgoMalum returns 'true' or 'false' as plain text
    return text.trim().toLowerCase() === 'true';
  } catch (err) {
    console.error('Profanity API error', err);
    return true;
  }
}

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
    // double-check stored name is still ok
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
    usernameDisplay.textContent = `You: ${name}`;
    return name;
  } else {
    usernameDisplay.textContent = `You: (no name)`;
    return null;
  }
}

// ---------- Supabase (minimal REST calls) ----------
const SUPA_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
};

async function fetchLeaderboard(limit = 10) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/leaderboard?select=username,score,created_at&order=score.desc,created_at.asc&limit=${limit}`;
    const r = await fetch(url, { headers: SUPA_HEADERS });
    if (!r.ok) throw new Error('Failed to fetch leaderboard: ' + r.status);
    return await r.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function submitScoreToSupabase(username, score) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/leaderboard`;
    const body = JSON.stringify({ username, score });
    const r = await fetch(url, { method: 'POST', headers: SUPA_HEADERS, body });
    if (!r.ok) {
      const text = await r.text();
      throw new Error('Submit failed: ' + r.status + ' ' + text);
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// ---------- UI logic ----------
async function refreshLeaderboard() {
  leadersList.innerHTML = 'Loading...';
  const rows = await fetchLeaderboard(10);
  if (!rows || rows.length === 0) {
    leadersList.innerHTML = '<div style="padding:6px 0">No scores yet — be the first!</div>';
    return;
  }
  const you = localStorage.getItem('chihuahua_username') || '';
  leadersList.innerHTML = '';
  rows.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'row' + (r.username === you ? ' me' : '');
    div.innerHTML = `<div>${i+1}. ${escapeHtml(r.username)}</div><div>${r.score}</div>`;
    leadersList.appendChild(div);
  });
}

// small helper to avoid XSS when injecting usernames
function escapeHtml(s) {
  return (s + '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// Bind buttons
document.getElementById('submitScoreBtn').addEventListener('click', async () => {
  const name = localStorage.getItem('chihuahua_username');
  if (!name) {
    alert('No username set. Please choose a username first.');
    await ensureUsername();
    return;
  }
  messageEl.textContent = 'Submitting score...';
  const ok = await submitScoreToSupabase(name, spinCounter);
  messageEl.textContent = ok ? 'Score submitted!' : 'Failed to submit — check console.';
  await refreshLeaderboard();
});

document.getElementById('changeNameBtn').addEventListener('click', async () => {
  localStorage.removeItem('chihuahua_username');
  await ensureUsername();
  await refreshLeaderboard();
});

// On load: ensure username and load leaderboard
(async function init() {
  await ensureUsername();
  await refreshLeaderboard();
})();
