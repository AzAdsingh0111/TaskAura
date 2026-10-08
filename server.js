const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { Pool } = require('pg');

const root = __dirname;
const dataPath = path.join(root, 'data.json');
const databasePool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
}) : null;
let persistentData = null;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function defaultData() {
  return { tasks: [], habits: [], sessions: [], calendar: [], guardRules: [], guardAttempts: [], guardEnabled: true, notes: [], integrations: [], activeTaskId: null, tokens: 0, tokenDate: '', settings: { profileId: `profile-${crypto.randomUUID()}`, profileName: 'Local user', age: '', photo: '', theme: 'dark', muted: false, xp: 0, tokens: 0 }, user: null, xp: 0 };
}
function normalizeData(saved = {}) {
  const defaults = defaultData();
  const data = { ...defaults, ...saved, settings: { ...defaults.settings, ...(saved.settings || {}) } };
  if (!data.settings.profileId) data.settings.profileId = `profile-${crypto.randomUUID()}`;
  const today = new Date().toISOString().slice(0, 10);
  if (data.tokenDate !== today) {
    data.tokens = Number(data.tokens) + 1;
    data.tokenDate = today;
  }
  data.settings.xp = data.xp;
  data.settings.tokens = data.tokens;
  if (data.activeTaskId && !data.tasks.some(item => item.id === data.activeTaskId)) data.activeTaskId = null;
  return data;
}
function readFileData() {
  if (!fs.existsSync(dataPath)) {
    return defaultData();
  }
  try {
    return normalizeData(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
  } catch (error) {
    console.error('Could not read data.json:', error.message);
    return defaultData();
  }
}
function readData() {
  return persistentData || readFileData();
}
function writeData(data) {
  persistentData = normalizeData(data);
  if (!databasePool) fs.writeFileSync(dataPath, JSON.stringify(persistentData, null, 2));
  else void databasePool.query('UPDATE app_state SET data = $1, updated_at = NOW() WHERE id = 1', [persistentData]).catch(error => console.error('Could not persist database data:', error.message));
}
async function initializePersistence() {
  const localData = readFileData();
  if (!databasePool) {
    persistentData = localData;
    writeData(persistentData);
    return;
  }
  await databasePool.query('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const result = await databasePool.query('SELECT data FROM app_state WHERE id = 1');
  if (result.rows[0]) {
    persistentData = normalizeData(result.rows[0].data);
  } else {
    persistentData = localData;
    await databasePool.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [persistentData]);
  }
}
function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}
function collectionName(urlPath) {
  const name = urlPath.split('/')[2];
  return ['tasks', 'habits', 'sessions', 'calendar', 'guardRules', 'notes', 'integrations'].includes(name) ? name : null;
}
const googleRedirectUri = process.env.TASKAURA_GOOGLE_REDIRECT_URI || 'http://localhost:5173/api/integrations/google/callback';
const googleScope = 'https://www.googleapis.com/auth/calendar.readonly';
const oauthState = new Map();
const authSessions = new Map();
function googleConfigured() {
  return Boolean(process.env.TASKAURA_GOOGLE_CLIENT_ID && process.env.TASKAURA_GOOGLE_CLIENT_SECRET);
}
function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}
function requestSession(request) {
  const cookies = String(request.headers.cookie || '').split(';').map(item => item.trim());
  const token = cookies.find(item => item.startsWith('taskaura_session='))?.split('=').slice(1).join('=');
  return token ? authSessions.get(token) : null;
}
function createSession(response, user) {
  const token = crypto.randomBytes(32).toString('hex');
  authSessions.set(token, user);
  response.setHeader('Set-Cookie', `taskaura_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}
function clearSession(response, request) {
  const cookies = String(request.headers.cookie || '').split(';').map(item => item.trim());
  const token = cookies.find(item => item.startsWith('taskaura_session='))?.split('=').slice(1).join('=');
  if (token) authSessions.delete(token);
  response.setHeader('Set-Cookie', 'taskaura_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}
function authGoogleConfigured() {
  return Boolean(process.env.TASKAURA_GOOGLE_CLIENT_ID && process.env.TASKAURA_GOOGLE_CLIENT_SECRET);
}
async function googleProfile(accessToken) {
  const result = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!result.ok) throw new Error(`Google profile request failed: ${result.status}`);
  return result.json();
}
async function exchangeGoogleCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.TASKAURA_GOOGLE_CLIENT_ID,
    client_secret: process.env.TASKAURA_GOOGLE_CLIENT_SECRET,
    redirect_uri: googleRedirectUri,
    grant_type: 'authorization_code'
  });
  const result = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!result.ok) throw new Error(`Google token exchange failed: ${result.status}`);
  return result.json();
}
async function googleEvents(accessToken) {
  const start = new Date().toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(start)}`;
  const result = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!result.ok) throw new Error(`Google Calendar request failed: ${result.status}`);
  return result.json();
}
function processSnapshot() {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      const processes = stdout.split(/\r?\n/).filter(Boolean).map(line => {
        const fields = [...line.matchAll(/"([^"]*)"/g)].map(match => match[1]);
        return { name: fields[0] || 'Unknown', pid: Number(fields[1]) || null, memory: fields[4] || 'Unknown' };
      });
      resolve(processes);
    });
  });
}

const server = http.createServer(async (request, response) => {
  const requested = decodeURIComponent(request.url.split('?')[0]);
  if (requested === '/api/auth/status' && request.method === 'GET') {
    const data = readData();
    const session = requestSession(request);
    sendJson(response, 200, { authenticated: Boolean(session), email: session?.email || null, provider: session?.provider || null, profile: data.settings });
    return;
  }
  if (requested === '/api/auth/register' && request.method === 'POST') {
    try {
      const body = await parseBody(request);
      const data = readData();
      if (!body.email || !body.password || String(body.password).length < 8) { sendJson(response, 400, { error: 'Email and a password of at least 8 characters are required' }); return; }
      if (data.user) { sendJson(response, 409, { error: 'A local account already exists' }); return; }
      data.user = { email: String(body.email).trim().toLowerCase(), passwordHash: crypto.createHash('sha256').update(String(body.password)).digest('hex') };
      data.settings.profileName = String(body.name || 'Local user').trim() || 'Local user';
      writeData(data);
      createSession(response, { email: data.user.email, provider: 'password' });
      sendJson(response, 201, { authenticated: true, profile: data.settings });
    } catch { sendJson(response, 400, { error: 'Invalid registration data' }); }
    return;
  }
  if (requested === '/api/auth/login' && request.method === 'POST') {
    try {
      const body = await parseBody(request);
      const data = readData();
      const hash = crypto.createHash('sha256').update(String(body.password || '')).digest('hex');
      if (!data.user || data.user.email !== String(body.email || '').trim().toLowerCase() || data.user.passwordHash !== hash) { sendJson(response, 401, { error: 'Invalid email or password' }); return; }
      createSession(response, { email: data.user.email, provider: 'password' });
      sendJson(response, 200, { authenticated: true, profile: data.settings });
    } catch { sendJson(response, 400, { error: 'Invalid login data' }); }
    return;
  }
  if (requested === '/api/auth/logout' && request.method === 'POST') {
    clearSession(response, request);
    sendJson(response, 200, { authenticated: false });
    return;
  }
  if (requested === '/api/auth/google/start' && request.method === 'GET') {
    if (!authGoogleConfigured()) {
      sendJson(response, 503, { error: 'Google login is not configured. Set TASKAURA_GOOGLE_CLIENT_ID and TASKAURA_GOOGLE_CLIENT_SECRET.' });
      return;
    }
    const state = crypto.randomBytes(24).toString('hex');
    oauthState.set(`auth:${state}`, Date.now());
    const redirectUri = process.env.TASKAURA_GOOGLE_AUTH_REDIRECT_URI || 'http://localhost:5173/api/auth/google/callback';
    const query = new URLSearchParams({ client_id: process.env.TASKAURA_GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'select_account', scope: 'openid email profile', state });
    redirect(response, `https://accounts.google.com/o/oauth2/v2/auth?${query}`);
    return;
  }
  if (requested === '/api/auth/google/callback' && request.method === 'GET') {
    const params = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const state = params.get('state');
    const code = params.get('code');
    const stateKey = `auth:${state}`;
    if (!state || !code || !oauthState.has(stateKey)) { sendJson(response, 400, { error: 'Invalid Google login callback' }); return; }
    oauthState.delete(stateKey);
    try {
      const redirectUri = process.env.TASKAURA_GOOGLE_AUTH_REDIRECT_URI || 'http://localhost:5173/api/auth/google/callback';
      const body = new URLSearchParams({ code, client_id: process.env.TASKAURA_GOOGLE_CLIENT_ID, client_secret: process.env.TASKAURA_GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' });
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!tokenResponse.ok) throw new Error(`Google login token exchange failed: ${tokenResponse.status}`);
      const tokens = await tokenResponse.json();
      const profile = await googleProfile(tokens.access_token);
      const data = readData();
      data.user = { email: profile.email, provider: 'google', googleId: profile.sub };
      data.settings.profileName = profile.name || data.settings.profileName;
      if (profile.picture) data.settings.photo = profile.picture;
      writeData(data);
      createSession(response, { email: profile.email, provider: 'google' });
      redirect(response, '/#profile');
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return;
  }
  if (requested === '/api/profile' && request.method === 'PATCH') {
    try {
      const body = await parseBody(request);
      const data = readData();
      data.settings = { ...data.settings, profileName: String(body.profileName ?? data.settings.profileName).trim(), age: String(body.age ?? data.settings.age), photo: String(body.photo ?? data.settings.photo) };
      writeData(data);
      sendJson(response, 200, data.settings);
    } catch { sendJson(response, 400, { error: 'Invalid profile data' }); }
    return;
  }
  if (requested === '/api/settings' && request.method === 'PATCH') {
    try {
      const body = await parseBody(request);
      const data = readData();
      data.settings = { ...data.settings, theme: ['dark', 'light', 'system'].includes(body.theme) ? body.theme : data.settings.theme, muted: Boolean(body.muted) };
      writeData(data);
      sendJson(response, 200, data.settings);
    } catch { sendJson(response, 400, { error: 'Invalid settings data' }); }
    return;
  }
  if (requested === '/api/tokens' && request.method === 'GET') {
    const data = readData();
    sendJson(response, 200, { tokens: data.tokens, tokenDate: data.tokenDate });
    return;
  }
  if (requested === '/api/focus/assign' && request.method === 'POST') {
    try {
      const body = await parseBody(request);
      const data = readData();
      const task = data.tasks.find(item => item.id === body.taskId && item.status !== 'Done');
      if (!task) { sendJson(response, 404, { error: 'Choose an unfinished task to assign.' }); return; }
      data.activeTaskId = task.id;
      writeData(data);
      sendJson(response, 200, { activeTaskId: task.id });
    } catch { sendJson(response, 400, { error: 'Invalid task assignment' }); }
    return;
  }
  if (requested === '/api/focus/emergency-cancel' && request.method === 'POST') {
    const data = readData();
    if (!data.activeTaskId) { sendJson(response, 409, { error: 'There is no assigned task to cancel.' }); return; }
    if (data.tokens < 1) { sendJson(response, 402, { error: 'No emergency token available.' }); return; }
    data.tokens -= 1;
    data.activeTaskId = null;
    data.settings.tokens = data.tokens;
    writeData(data);
    sendJson(response, 200, { tokens: data.tokens, cancelled: true });
    return;
  }
  if (requested === '/api/integrations/google/status' && request.method === 'GET') {
    const data = readData();
    sendJson(response, 200, { configured: googleConfigured(), connected: Boolean(data.googleCalendar?.accessToken), email: data.googleCalendar?.email || null });
    return;
  }
  if (requested === '/api/integrations/google/start' && request.method === 'GET') {
    if (!googleConfigured()) {
      sendJson(response, 503, { error: 'Google OAuth is not configured. Set TASKAURA_GOOGLE_CLIENT_ID and TASKAURA_GOOGLE_CLIENT_SECRET.' });
      return;
    }
    const state = crypto.randomBytes(24).toString('hex');
    oauthState.set(state, Date.now());
    const query = new URLSearchParams({ client_id: process.env.TASKAURA_GOOGLE_CLIENT_ID, redirect_uri: googleRedirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: googleScope, state });
    redirect(response, `https://accounts.google.com/o/oauth2/v2/auth?${query}`);
    return;
  }
  if (requested === '/api/integrations/google/callback' && request.method === 'GET') {
    const params = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const state = params.get('state');
    const code = params.get('code');
    if (!state || !oauthState.has(state) || Date.now() - oauthState.get(state) > 10 * 60 * 1000 || !code) {
      sendJson(response, 400, { error: 'Invalid or expired Google OAuth callback.' });
      return;
    }
    oauthState.delete(state);
    try {
      const tokens = await exchangeGoogleCode(code);
      const data = readData();
      data.googleCalendar = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || data.googleCalendar?.refreshToken || null, connectedAt: new Date().toISOString() };
      writeData(data);
      redirect(response, '/#calendar?connected=google');
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return;
  }
  if (requested === '/api/integrations/google/events' && request.method === 'GET') {
    const data = readData();
    if (!data.googleCalendar?.accessToken) {
      sendJson(response, 409, { error: 'Google Calendar is not connected.' });
      return;
    }
    try {
      const result = await googleEvents(data.googleCalendar.accessToken);
      sendJson(response, 200, result.items || []);
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return;
  }
  if (requested === '/api/workload' && request.method === 'GET') {
    try {
      const processes = await processSnapshot();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      sendJson(response, 200, {
        platform: process.platform,
        hostname: os.hostname(),
        uptime: os.uptime(),
        cpuCount: os.cpus().length,
        loadAverage: os.loadavg(),
        memory: { total: totalMemory, free: freeMemory, used: totalMemory - freeMemory, usedPercent: Math.round((1 - freeMemory / totalMemory) * 100) },
        processes: processes.slice(0, 100)
      });
    } catch (error) {
      sendJson(response, 500, { error: `Unable to read local workload: ${error.message}` });
    }
    return;
  }
  if (requested === '/api/data' && request.method === 'GET') {
    sendJson(response, 200, readData());
    return;
  }
  if (requested === '/api/data' && request.method === 'DELETE') {
    writeData({ tasks: [], habits: [], sessions: [], calendar: [], guardRules: [], guardAttempts: [], guardEnabled: true, notes: [], integrations: [], settings: { profileName: 'Local user' }, xp: 0 });
    sendJson(response, 200, readData());
    return;
  }
  if (requested === '/api/guard/status' && request.method === 'GET') {
    const data = readData();
    sendJson(response, 200, { enabled: data.guardEnabled !== false, rules: data.guardRules, attempts: data.guardAttempts || [] });
    return;
  }
  if (requested === '/api/guard/toggle' && request.method === 'POST') {
    parseBody(request).then(body => {
      const data = readData();
      data.guardEnabled = Boolean(body.enabled);
      writeData(data);
      sendJson(response, 200, { enabled: data.guardEnabled });
    }).catch(() => sendJson(response, 400, { error: 'Invalid JSON body' }));
    return;
  }
  if (requested === '/api/guard/check' && request.method === 'POST') {
    parseBody(request).then(body => {
      const value = String(body.url || '').trim().toLowerCase();
      if (!value) {
        sendJson(response, 400, { error: 'A URL is required' });
        return;
      }
      const data = readData();
      const hostname = new URL(value.includes('://') ? value : `https://${value}`).hostname.replace(/^www\./, '');
      const rule = data.guardRules.find(item => String(item.url || item.title || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] === hostname);
      const blocked = data.guardEnabled !== false && Boolean(rule);
      if (blocked) {
        data.guardAttempts = data.guardAttempts || [];
        data.guardAttempts.unshift({ url: hostname, blockedAt: new Date().toISOString() });
        data.guardAttempts = data.guardAttempts.slice(0, 100);
        writeData(data);
      }
      sendJson(response, 200, { url: hostname, blocked, rule: rule || null });
    }).catch(() => sendJson(response, 400, { error: 'Invalid URL' }));
    return;
  }
  if (requested.startsWith('/api/')) {
    const collection = collectionName(requested);
    if (!collection) {
      sendJson(response, 404, { error: 'Unknown API resource' });
      return;
    }
    const parts = requested.split('/').filter(Boolean);
    const id = parts[2];
    const data = readData();
    if (request.method === 'GET') {
      sendJson(response, 200, id ? (data[collection].find(item => item.id === id) || { error: 'Not found' }) : data[collection]);
      return;
    }
    parseBody(request).then(body => {
      if (request.method === 'POST') {
        const item = { id: `${collection}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), ...body };
        data[collection].unshift(item);
        if (collection === 'tasks' && item.status === 'Done') data.xp += 30;
        data.settings.xp = data.xp;
        data.settings.tokens = data.tokens;
        writeData(data);
        sendJson(response, 201, item);
        return;
      }
      const index = data[collection].findIndex(item => item.id === id);
      if (index < 0) {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }
      if (request.method === 'PATCH') {
        const before = data[collection][index];
        data[collection][index] = { ...before, ...body, updatedAt: new Date().toISOString() };
        if (collection === 'tasks' && before.status !== 'Done' && data[collection][index].status === 'Done') {
          data[collection][index].completedAt = new Date().toISOString();
        }
        if (collection === 'tasks' && before.status !== 'Done' && data[collection][index].status === 'Done') data.xp += 30;
        if (collection === 'tasks' && data[collection][index].status === 'Done' && data.activeTaskId === id) data.activeTaskId = null;
        data.settings.xp = data.xp;
        data.settings.tokens = data.tokens;
        writeData(data);
        sendJson(response, 200, data[collection][index]);
        return;
      }
      if (request.method === 'DELETE') {
        data[collection].splice(index, 1);
        if (collection === 'tasks' && data.activeTaskId === id) data.activeTaskId = null;
        writeData(data);
        sendJson(response, 200, { ok: true });
        return;
      }
      sendJson(response, 405, { error: 'Method not allowed' });
    }).catch(() => sendJson(response, 400, { error: 'Invalid JSON body' }));
    return;
  }
  const relative = requested === '/' ? '/index.html' : requested;
  const filePath = path.join(root, relative);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
});

const port = Number(process.env.PORT) || 5173;
initializePersistence().then(() => {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Task Aura running on port ${port}${databasePool ? ' with PostgreSQL persistence' : ' with local JSON persistence'}`);
  });
}).catch(error => {
  console.error('Task Aura could not initialize persistence:', error.message);
  process.exitCode = 1;
});
