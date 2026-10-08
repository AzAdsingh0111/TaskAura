const navItems = [
  ['dashboard', '⌂', 'Dashboard'], ['tasks', '✓', 'Tasks'], ['focus', '◷', 'Focus sessions'],
  ['habits', '↻', 'Habits'], ['analytics', '▥', 'Analytics & Insights'], ['workload', '▱', 'Workload & Apps'],
  ['guard', '♢', 'Website Guard'], ['coach', '✣', 'AI Coach'], ['progress', '◉', 'Progress'],
  ['calendar', '▦', 'Calendar'], ['plugins', '⊞', 'Plugins']
];
const storageKey = 'task-aura-local-v1';
const apiBase = '/api';
const state = {
  page: location.hash.slice(1) || 'dashboard',
  timer: 0,
  timerLimit: 4 * 60 * 60,
  timerActive: false,
  data: loadData(),
  google: { configured: false, connected: false },
  workload: null,
  workloadError: '',
  guard: { enabled: true, rules: [], attempts: [] }
  ,profile: loadData().profile || { profileName: 'Local user', age: '', photo: '', theme: 'dark', muted: false }
  ,auth: { authenticated: false }
  ,activeTaskId: null
  ,tokens: 0
  ,coach: { monitoring: true, proposal: null, lastScan: null }
  ,habitCoach: { lastDetected: '', message: '' }
};
const app = document.querySelector('#app');
let liquidFlowCleanup = null;
let auraCompanionCleanup = null;

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return {
      tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
      habits: Array.isArray(saved.habits) ? saved.habits : [],
      sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
      calendar: Array.isArray(saved.calendar) ? saved.calendar : [],
      guardRules: Array.isArray(saved.guardRules) ? saved.guardRules : [],
      notes: Array.isArray(saved.notes) ? saved.notes : [],
      integrations: Array.isArray(saved.integrations) ? saved.integrations : [],
      xp: Number(saved.xp) || 0
      ,profile: saved.profile || { profileName: 'Local user', age: '', photo: '', theme: 'dark', muted: false }
    };
  } catch (error) {
    console.warn('Task Aura could not read local data.', error);
    return { tasks: [], habits: [], sessions: [], calendar: [], guardRules: [], notes: [], integrations: [], xp: 0 };
  }
}
function saveData() {
  localStorage.setItem(storageKey, JSON.stringify({ ...state.data, profile: state.profile }));
}
async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json();
}
async function refreshFromApi() {
  try {
    const remote = await apiRequest('/data');
    state.data = {
      tasks: Array.isArray(remote.tasks) ? remote.tasks : [],
      habits: Array.isArray(remote.habits) ? remote.habits : [],
      sessions: Array.isArray(remote.sessions) ? remote.sessions : [],
      calendar: Array.isArray(remote.calendar) ? remote.calendar : [],
      guardRules: Array.isArray(remote.guardRules) ? remote.guardRules : [],
      notes: Array.isArray(remote.notes) ? remote.notes : [],
      integrations: Array.isArray(remote.integrations) ? remote.integrations : [],
      xp: Number(remote.xp) || 0
    };
    state.profile = remote.settings || state.profile;
    state.activeTaskId = remote.activeTaskId || null;
    state.tokens = Number(remote.tokens) || 0;
    state.google = await apiRequest('/integrations/google/status').catch(() => ({ configured: false, connected: false }));
    state.auth = await apiRequest('/auth/status').catch(() => ({ authenticated: false, email: null, provider: null }));
    state.workload = await apiRequest('/workload').catch(error => {
      state.workloadError = error.message;
      return null;
    });
    state.guard = await apiRequest('/guard/status').catch(() => ({ enabled: true, rules: [], attempts: [] }));
    saveData();
    applyTheme();
    render();
  } catch (error) {
    console.warn('Local API unavailable; using browser cache.', error);
  }
}
function applyTheme() {
    document.body.dataset.theme = state.profile.theme || 'dark';
    document.body.classList.toggle('muted-mode', Boolean(state.profile.muted));
}
function saveProfile() {
    const profileName = document.querySelector('[name="profileName"]')?.value || state.profile.profileName;
    const age = document.querySelector('[name="age"]')?.value || '';
    const photo = document.querySelector('[name="photo"]')?.value || state.profile.photo;
    apiRequest('/profile', { method: 'PATCH', body: JSON.stringify({ profileName, age, photo }) }).then(profile => { state.profile = profile; saveData(); render(); });
}
function saveSettings() {
    const theme = document.querySelector('[name="theme"]')?.value || 'dark';
    const muted = document.querySelector('[name="muted"]')?.checked || false;
    apiRequest('/settings', { method: 'PATCH', body: JSON.stringify({ theme, muted }) }).then(profile => { state.profile = profile; applyTheme(); saveData(); render(); });
}
function authPage() {
    return pageTitle('Local account.', 'Sign in securely to your Task Aura workspace.') + card('Authentication', `<form class="auth-form"><input class="search" name="name" placeholder="Name (for registration)"><input class="search" name="email" type="email" placeholder="Email" required><input class="search" name="password" type="password" placeholder="Password" minlength="8" required><div class="actions"><button class="btn btn-primary" type="submit">Create account</button><button class="btn" type="button">Sign in</button><button class="btn google-login" type="button">Continue with Google</button></div><p class="muted auth-result">Use your email/password or Google account.</p></form>`);
}
function addTask() {
  const existing = document.querySelector('.task-form');
  if (existing) return;
  const form = document.createElement('form');
  form.className = 'task-form card';
  form.innerHTML = '<h3>Add a task</h3><input class="search" name="title" placeholder="What needs to be done?" required autofocus><div class="actions"><button class="btn" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save task</button></div>';
  document.querySelector('.content').prepend(form);
  form.querySelector('button[type="button"]').addEventListener('click', () => form.remove());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const title = new FormData(form).get('title');
    if (!title?.trim()) return;
    let task = { id: crypto.randomUUID(), title: title.trim(), status: 'To do', priority: 'Medium', createdAt: new Date().toISOString() };
    try {
      task = await apiRequest('/tasks', { method: 'POST', body: JSON.stringify({ title: task.title, status: task.status, priority: task.priority }) });
    } catch (error) {
      console.warn('Task API unavailable; saving browser copy.', error.message);
    }
    state.data.tasks.unshift(task);
    saveData();
    render();
  });
}
async function toggleTask(id) {
  const task = state.data.tasks.find(item => item.id === id);
  if (!task) return;
  const status = task.status === 'Done' ? 'To do' : 'Done';
  try {
    await apiRequest(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await refreshFromApi();
  } catch (error) {
    console.warn('Task completion could not be saved.', error.message);
  }
}
function addHabit() {
  const existing = document.querySelector('.habit-form');
  if (existing) return;
  const form = document.createElement('form');
  form.className = 'habit-form card task-form';
  form.innerHTML = '<h3>Add a habit</h3><input class="search" name="title" placeholder="What habit will you practice?" required autofocus><div class="actions"><button class="btn" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save habit</button></div>';
  document.querySelector('.content').prepend(form);
  form.querySelector('button[type="button"]').addEventListener('click', () => form.remove());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const title = new FormData(form).get('title');
    if (!title?.trim()) return;
    const habit = { id: crypto.randomUUID(), title: title.trim(), checked: false, createdAt: new Date().toISOString() };
    state.data.habits.unshift(habit);
    saveData();
    render();
    apiRequest('/habits', { method: 'POST', body: JSON.stringify({ title: habit.title, checked: false }) }).catch(error => console.warn(error.message));
  });
}
function emptyState(message) {
  return `<div class="empty">${message}<br><small>Use “New task” or “New habit” to add your first item.</small></div>`;
}

function sidebar() {
  const level = Math.floor(state.data.xp / 300) + 1;
  const levelXp = Math.max(0, state.data.xp % 300);
  return `<aside class="sidebar">
    <div class="brand"><div class="logo">◉</div><span>Task Aura</span></div>
    <button class="workspace-switcher" type="button" aria-label="Personal workspace">
      <span class="workspace-identity"><span class="workspace-logo" aria-hidden="true">▰</span><span>Personal workspace</span></span>
      <span class="workspace-control" aria-hidden="true">↕</span>
    </button>
    <div class="nav-label">Workspace</div><nav class="nav">${navItems.map(([id, icon, label]) => `<button class="${state.page === id ? 'active' : ''}" data-page="${id}"><i class="nav-icon">${icon}</i><span>${label}</span></button>`).join('')}</nav>
    <div class="level-card"><div class="level-top"><span class="level-badge">◉</span><strong>Level ${level}</strong><small>Momentum</small></div><div class="progress-track"><span class="progress-fill" style="width:${Math.round(levelXp / 3)}%"></span></div><small>${levelXp} / 300 XP to level ${level + 1}</small></div>
    <div class="sidebar-bottom"><button data-page="settings">⚙ &nbsp; Settings</button></div>
    <button class="profile" type="button" data-page="profile" title="Open profile"><span class="avatar">${state.profile.photo ? `<img src="${state.profile.photo}" alt="">` : 'U'}</span><span><b>${escapeHtml(state.profile.profileName)}</b><small>Profile</small></span><span style="margin-left:auto">•••</span></button>
  </aside>`;
}
function topbar() { return `<header class="topbar"><div class="crumb">Workspace &nbsp;/&nbsp; <strong>${navItems.find(x => x[0] === state.page)?.[2] || 'Dashboard'}</strong></div><div class="top-actions"><input class="search" placeholder="⌕  Search anything   ⌘ K" /><span>${new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span><span class="sync"><b>•</b> Local mode</span></div></header>`; }
function card(title, body, cls = '') { return `<section class="card ${cls}">${title ? `<div class="card-title"><h3>${title}</h3><small>View insights ↗</small></div>` : ''}${body}</section>`; }
function stat(label, value, note, icon = '◌') { return `<div class="card stat"><span class="eyebrow">${label}</span><span class="stat-icon">${icon}</span><strong>${value}</strong><small>${note}</small></div>`; }
function button(label, primary = false) { return `<button class="btn ${primary ? 'btn-primary' : ''}">${label}</button>`; }
function pageTitle(title, subtitle, action = '') { return `<div class="title-row page-title"><div><h1>${title}</h1><p>${subtitle}</p></div>${action ? `<div class="actions">${action}</div>` : ''}</div>`; }
function footer() { return `<footer class="footer"><span>Your work. Your focus. Your progress.</span><span>Local browser data • No integrations connected</span></footer>`; }
function timeGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'Good night.';
  if (hour < 12) return 'Good morning.';
  if (hour < 17) return 'Good afternoon.';
  if (hour < 21) return 'Good evening.';
  return 'Good night.';
}
function updateDashboardClock() {
  if (state.page !== 'dashboard') return;
  const now = new Date();
  const clock = document.querySelector('.live-clock');
  if (clock) clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const greeting = document.querySelector('.time-aware-greeting');
  if (greeting && greeting.dataset.period !== timeGreeting(now)) {
    greeting.classList.remove('fade-time-change');
    void greeting.offsetWidth;
    greeting.textContent = timeGreeting(now);
    greeting.dataset.period = timeGreeting(now);
    greeting.classList.add('fade-time-change');
  }
}
function updateFocusTimerDisplay() {
  const time = document.querySelector('.ring-time');
  if (time) time.textContent = formatTime();
  const ring = document.querySelector('[data-focus-ring]');
  if (ring) ring.style.setProperty('--focus-progress', `${Math.max(0, Math.min(100, state.timer / state.timerLimit * 100))}%`);
  const limitLabel = document.querySelector('[data-focus-limit-label]');
  if (limitLabel) limitLabel.textContent = `Maximum ${formatDuration(state.timerLimit)}`;
}
  function setupLiquidFlow() {
    if (liquidFlowCleanup) liquidFlowCleanup();
    if (state.page !== 'dashboard') return;
    const canvas = document.querySelector('.liquid-flow-canvas');
    if (!canvas) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const context = canvas.getContext('2d');
    if (!context) return;
    const particles = [];
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let lastClick = 0;
    let clickCount = 0;
    let pointer = { x: -1000, y: -1000, active: false };
    const colors = ['#27d9e8', '#895cff', '#ff6686', '#f7b63d', '#1fd4a5'];
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };
    const move = event => {
      pointer = { x: event.clientX, y: event.clientY, active: true };
    };
    const burst = (x, y) => {
      if (reducedMotion) return;
      for (let index = 0; index < 28; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 4;
        particles.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: 1, size: 1.5 + Math.random() * 3, color: colors[index % colors.length]
        });
      }
    };
    const click = event => {
      if (event.button !== 0) return;
      const now = performance.now();
      clickCount = now - lastClick < 420 ? clickCount + 1 : 1;
      lastClick = now;
      if (clickCount >= 2) {
        burst(event.clientX, event.clientY);
        clickCount = 0;
      }
    };
    const renderFrame = () => {
      context.clearRect(0, 0, width, height);
      if (pointer.active) {
        const glow = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 190);
        glow.addColorStop(0, 'rgba(137,92,255,.18)');
        glow.addColorStop(.35, 'rgba(39,217,232,.08)');
        glow.addColorStop(1, 'rgba(39,217,232,0)');
        context.fillStyle = glow;
        context.fillRect(pointer.x - 190, pointer.y - 190, 380, 380);
      }
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= .985;
        particle.vy = particle.vy * .985 + .035;
        particle.life -= .018;
        if (particle.life <= 0) {
          particles.splice(index, 1);
          continue;
        }
        context.globalAlpha = particle.life;
        context.fillStyle = particle.color;
        context.shadowBlur = 14;
        context.shadowColor = particle.color;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      animationFrame = window.requestAnimationFrame(renderFrame);
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('click', click);
    animationFrame = window.requestAnimationFrame(renderFrame);
    liquidFlowCleanup = () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('click', click);
      context.clearRect(0, 0, width, height);
      liquidFlowCleanup = null;
    };
}
function bars() { return `<div class="bars">${[35,58,72,66,88,52,43,75,69,91,62,51,67,49,57,34,65,54,42,32].map(h => `<i class="bar" style="height:${h}%"></i>`).join('')}</div><div class="chart-labels"><span>6 AM</span><span>9 AM</span><span>12 PM</span><span>3 PM</span><span>6 PM</span><span>9 PM</span></div>`; }
function auraCompanion() {
  const currentTask = { title: 'Build Aura Companion', progress: 68, xp: 120 };
  return `<div class="aura-companion" data-companion-state="IDLE" aria-label="Aura Companion">
    <div class="aura-task-bubble"><strong>Current Task</strong><span>${currentTask.title}</span><i><b style="width:${currentTask.progress}%"></b></i><small>${currentTask.progress}% complete <em>+${currentTask.xp} XP</em></small></div>
    <div class="aura-companion-art"><svg viewBox="0 0 220 180" role="img" aria-label="Interactive Aura Companion">
      <defs><linearGradient id="aura-body-gradient" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#be123c"/><stop offset="1" stop-color="#6f0b2a"/></linearGradient><radialGradient id="aura-glow"><stop stop-color="#fb7185" stop-opacity=".4"/><stop offset="1" stop-color="#fb7185" stop-opacity="0"/></radialGradient></defs>
      <ellipse class="aura-glow" cx="110" cy="96" rx="92" ry="68"/><path class="aura-ear aura-ear-left" d="M64 50c-18-24-2-43 20-20l8 20Z"/><path class="aura-ear aura-ear-right" d="M156 50c18-24 2-43-20-20l-8 20Z"/><path class="aura-body" d="M53 151c-8-30-5-77 10-102C77 27 96 18 110 18s33 9 47 31c15 25 18 72 10 102-29 13-85 13-114 0Z"/>
      <ellipse class="aura-eye" cx="86" cy="73" rx="23" ry="27"/><ellipse class="aura-eye" cx="134" cy="73" rx="23" ry="27"/><g class="aura-pupil" data-pupil="left"><circle cx="86" cy="75" r="9"/><circle class="aura-eye-shine" cx="89" cy="71" r="3"/></g><g class="aura-pupil" data-pupil="right"><circle cx="134" cy="75" r="9"/><circle class="aura-eye-shine" cx="137" cy="71" r="3"/></g>
      <path class="aura-eyelid" data-eyelid="left" d="M64 70c8-23 36-23 44 0"/><path class="aura-eyelid" data-eyelid="right" d="M112 70c8-23 36-23 44 0"/><ellipse class="aura-nose" cx="110" cy="105" rx="7" ry="5"/><path class="aura-mouth" d="M99 115c7 7 15 7 22 0"/>
    </svg></div>
    <div class="aura-snores" aria-hidden="true"><span>Z</span><span>Zz</span><span>Zzz</span></div>
  </div>`;
}
function setupAuraCompanion() {
  const companion = document.querySelector('.aura-companion');
  if (!companion) return;
  const svg = companion.querySelector('svg');
  const pupils = [...companion.querySelectorAll('[data-pupil]')];
  const eyelids = [...companion.querySelectorAll('[data-eyelid]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = { x: innerWidth / 2, y: innerHeight / 2 };
  const current = { x: 0, y: 0, attention: 0 };
  let frame = 0;
  let blinkTimeout = 0;
  let blinkEndTimeout = 0;
  let inactivityTimeout = 0;
  const setCompanionState = stateName => { companion.dataset.companionState = stateName; };
  const onMove = event => { pointer.x = event.clientX; pointer.y = event.clientY; };
  const wake = event => {
    onMove(event);
    window.clearTimeout(inactivityTimeout);
    setCompanionState('ATTENTION');
    inactivityTimeout = window.setTimeout(() => setCompanionState('SLEEPY'), 3000);
  };
  const blink = () => {
    eyelids.forEach(eyelid => { eyelid.style.opacity = '1'; });
    companion.classList.add('is-blinking');
    blinkEndTimeout = window.setTimeout(() => {
      companion.classList.remove('is-blinking');
      eyelids.forEach(eyelid => { eyelid.style.opacity = '0'; });
      blinkTimeout = window.setTimeout(blink, 3000 + Math.random() * 4000);
    }, 150);
  };
  const animate = () => {
    const rect = svg.getBoundingClientRect();
    const distance = Math.hypot(pointer.x - (rect.left + rect.width / 2), pointer.y - (rect.top + rect.height / 2));
    const target = Math.max(-7, Math.min(7, (pointer.x - (rect.left + rect.width / 2)) / 34));
    const targetY = Math.max(-7, Math.min(7, (pointer.y - (rect.top + rect.height / 2)) / 42));
    const smoothing = reducedMotion ? .18 : .24;
    current.x += (target - current.x) * smoothing;
    current.y += (targetY - current.y) * smoothing;
    current.attention += (Math.max(0, Math.min(1, 1 - distance / 360)) - current.attention) * smoothing;
    pupils.forEach(pupil => pupil.setAttribute('transform', `translate(${current.x} ${current.y})`));
    companion.style.setProperty('--aura-attention', current.attention.toFixed(2));
    frame = requestAnimationFrame(animate);
  };
  window.addEventListener('mousemove', wake, { passive: true });
  inactivityTimeout = window.setTimeout(() => setCompanionState('SLEEPY'), 3000);
  if (!reducedMotion) blinkTimeout = window.setTimeout(blink, 3000 + Math.random() * 4000);
  frame = requestAnimationFrame(animate);
  auraCompanionCleanup = () => {
    window.removeEventListener('mousemove', wake);
    cancelAnimationFrame(frame);
    clearTimeout(blinkTimeout);
    clearTimeout(blinkEndTimeout);
    clearTimeout(inactivityTimeout);
    auraCompanionCleanup = null;
  };
}
window.setAuraCompanionState = stateName => {
  const allowedStates = ['IDLE', 'FOCUS', 'HAPPY', 'SLEEPY', 'ATTENTION'];
  const companion = document.querySelector('.aura-companion');
  if (companion && allowedStates.includes(stateName)) companion.dataset.companionState = stateName;
};
function dashboard() {
  const completed = state.data.tasks.filter(task => task.status === 'Done').length;
  const total = state.data.tasks.length;
  const current = state.data.tasks.find(task => task.status !== 'Done');
  const now = new Date();
  const greeting = timeGreeting(now);
  return `<canvas class="liquid-flow-canvas" aria-hidden="true"></canvas><div class="title-row page-title"><div><h1 class="time-aware-greeting" data-period="${greeting}">${greeting}</h1><p>A little focus today. A little further tomorrow.</p></div></div>` +
    `<section class="card hero"><div class="hero-content"><span class="eyebrow">${now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span><h2>Your day, in focus.</h2><p>One clear next step is all you need.</p></div>${auraCompanion()}<div class="hero-time"><span class="live-clock">${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><small>No calendar connection</small></div></section>
    <div class="grid stats" style="margin-top:14px">${stat('Focus today',formatDuration(state.data.sessions.reduce((sum, session) => sum + session.duration, 0)),'Local sessions recorded','◷')}${stat('Tasks completed',`${completed} / ${total}`,'Stored in this browser','☑')}${stat('Habit consistency',`${state.data.habits.length ? '0%' : '—'}`,state.data.habits.length ? 'No check-ins yet' : 'No habits created','↻')}${stat("Today's progress",`+${state.data.xp} XP`,'Earned from your actions','◉')}</div>
    <div class="grid focus-layout">${card('Focus session', `<div class="ring-wrap"><div class="ring" data-focus-ring style="--focus-progress:${Math.max(0, Math.min(100, state.timer / state.timerLimit * 100))}%"><div class="ring-content"><div class="ring-time">${formatTime()}</div><small>${state.timerActive ? 'ELAPSED • DEEP WORK' : 'READY • DEEP WORK'}</small><span class="tag">${state.timerActive ? 'Session in progress' : 'Start a session'}</span></div></div></div><div class="focus-stats"><div><span>Focus quality</span><strong class="cyan">—</strong></div><div><span>Distractions</span><strong>—</strong></div><div><span data-focus-limit-label>Maximum ${formatDuration(state.timerLimit)}</span></div></div><div class="focus-actions"><label class="timer-limit">Limit <select class="search" data-focus-limit ${state.timerActive ? 'disabled' : ''}><option value="7200" ${state.timerLimit === 7200 ? 'selected' : ''}>2 hours</option><option value="10800" ${state.timerLimit === 10800 ? 'selected' : ''}>3 hours</option><option value="14400" ${state.timerLimit === 14400 ? 'selected' : ''}>4 hours</option></select></label>${button(state.timerActive ? 'Ⅱ Pause session' : '▶ Start session', true)}${button('□ End session')}${button('•••')}</div>`, 'focus-main')}
    ${card("Today's activity", emptyState('No activity recorded yet'))}
    ${card('Current task', current ? `<div class="code">&lt;/&gt;</div><h3>${escapeHtml(current.title)}</h3><p>Task stored locally in this browser.</p><div class="metric-line"><span style="width:0%"></span></div><span class="status">To do</span><br>${button('↗ Open task', true)}` : emptyState('No current task'), 'task-card')}
    ${card('Computer workload', emptyState('Workload integration is not connected'))}
    ${card('Up next', state.data.tasks.length ? `<div class="mini-list">${state.data.tasks.filter(task => task.status !== 'Done').slice(0, 3).map(task => `<div class="list-row"><span class="dot"></span>${escapeHtml(task.title)}<span class="right">${task.priority}</span></div>`).join('')}</div>` : emptyState('No upcoming tasks'))}
    ${card('Quick actions', `${button('+  Add task')} ${button('▣  Take a break')}<div class="list-row"><span class="dot green"></span>Local data storage is active</div><small class="muted">Your data stays in this browser.</small></div>`)}</div>`;
}
function formatTime() { const hours = Math.floor(state.timer / 3600); const minutes = Math.floor((state.timer % 3600) / 60).toString().padStart(2, '0'); const seconds = (state.timer % 60).toString().padStart(2, '0'); return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`; }
function formatDuration(seconds) { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); return `${hours}h ${minutes}m`; }
function localDateKey(date = new Date()) { const value = new Date(date); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
function escapeHtml(value) { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character])); }
function tasks() {
  const completed = state.data.tasks.filter(task => task.status === 'Done').length;
  return pageTitle('Make room for meaningful work.', 'Your tasks are stored locally in this browser.', button('+ New task', true)) + `<div class="grid two-col"><div>${card('', `<div class="card-title"><h3>✓ &nbsp; ${completed} of ${state.data.tasks.length} tasks complete</h3><small>+${state.data.xp} XP earned</small></div><div class="metric-line"><span style="width:${state.data.tasks.length ? Math.round(completed / state.data.tasks.length * 100) : 0}%;background:var(--cyan)"></span></div>`) }${card('', state.data.tasks.length ? `<table class="table"><thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead><tbody>${state.data.tasks.map(task => `<tr><td><button class="check ${task.status === 'Done' ? 'done' : ''}" data-task="${task.id}" aria-label="Toggle task"></button> &nbsp;${escapeHtml(task.title)}</td><td><span class="status ${task.status === 'Done' ? 'done' : ''}">${task.status}</span></td><td class="priority">${task.priority}</td><td>${new Date(task.createdAt).toLocaleDateString()}</td></tr>`).join('')}</tbody></table>` : emptyState('No tasks yet'))}</div>${card('', `<div class="detail"><h2>Local workspace</h2><p>Create tasks here and they will be saved to this browser without fake seed data or a remote service.</p><div class="kv">Tasks <b>${state.data.tasks.length}</b></div><div class="kv">Completed <b>${completed}</b></div><div class="kv">XP earned <b>${state.data.xp}</b></div>${button('+ New task', true)}</div>`)}</div>`;
}
function focus() { return pageTitle('Protect your attention.', 'One task. A clear mind. A little momentum.', button('☷ Session settings', true)) + `<div class="grid focus-layout">${card('', `<div class="actions" style="justify-content:start"><span class="tag">Deep work</span><span class="muted">Pomodoro</span><span class="muted">Free flow</span></div><div class="ring-wrap"><div class="ring" style="width:190px;height:190px"><div class="ring-content"><div class="ring-time">${formatTime()}</div><small>REMAINING • DEEP WORK</small><span class="tag">Session in progress</span></div></div><h3 style="margin-top:15px">Build Java REST API</h3><small class="muted">Atlas project • Session 3 of 4 • 60-minute block</small></div><div class="focus-actions">${button('▮▮ Pause session', true)}${button('□ End session')}</div>`, 'focus-main')}${card('Your focus environment', `<div class="list-row"><span class="dot green"></span><span>Website Guard active<small class="muted">12 sites blocked</small></span></div><div class="list-row"><span class="dot"></span><span>Notifications silenced<small class="muted">Until this session ends</small></span></div><div class="list-row"><span class="dot" style="background:var(--cyan)"></span><span>Ambient space<small class="muted">Soundscape • Volume 35%</small></span></div>`) }${card('Session quality', `<strong style="font:28px Space Grotesk">87%</strong><p class="muted">Focus quality</p><div class="metric-line"><span style="width:87%"></span></div><div class="kv">App switches <b>3</b></div><div class="kv">Longest uninterrupted stretch <b>14m</b></div>`) }${card("Today's sessions", `<div class="mini-list"><div class="list-row">Refactor user service <span class="right">60m • 91%</span></div><div class="list-row">Fix token refresh bug <span class="right">45m • 89%</span></div><div class="list-row">Build Java REST API <span class="right" style="color:var(--cyan)">60m • 87%</span></div></div>`) }${card('A steady rhythm', `<strong style="font:25px Space Grotesk">4h 12m</strong><p class="muted">Total focused time today</p><div class="metric-line"><span style="width:70%"></span></div><small style="color:var(--purple-2)">70% of your 6-hour goal</small>`)}</div>`; }
function habits() { const habits=[['☼','Plan the day','Before 8:00 AM','12 days streak'],['♨','Drink water','Goal: 2 litres','6 days streak'],['♧','Morning walk','20 minutes outdoors','18 days streak'],['▣','Read 20 minutes','Scheduled at 4:30 PM','6 days streak'],['◔','Evening reflection','Scheduled at 8:30 PM','12 days streak']]; return pageTitle('Small actions. Lasting momentum.', 'Build a rhythm that supports the way you work and live.', button('+ New habit', true)) + `<div class="grid stats">${stat("Today's habits",'3 / 5','Two small wins still ahead','◉')}${stat('Consistency','87%','↑ 5% compared with last month','▥')}${stat('Longest current streak','18 days','Morning walk • Keep it going','♨')}${stat('This week','13 / 15','Completed habit check-ins','▦')}</div><div class="grid habits-grid">${card('Your weekly rhythm', `<div class="habit-row" style="border:0;color:#697592;font-size:9px"><span>HABIT</span><span>M 5</span><span>T 6</span><span>W 7</span><span>T 8</span><span>F 9</span><span>S 10</span><span>S 11</span></div>${habits.map(h=>`<div class="habit-row"><div class="habit-name"><span class="tag">${h[0]}</span><div><b>${h[1]}</b><small>${h[2]}<br><span style="color:var(--yellow)">${h[3]}</span></small></div></div>${[1,1,1,0,0,0,0].map((x,i)=>`<span class="habit-day ${x?'checked':''}">${x?'✓':'–'}</span>`).join('')}</div>`).join('')}<small class="muted">● Complete &nbsp; • Ready to check in &nbsp; — Upcoming</small>`, 'card')}${card('Morning walk', `<span class="tag">Completed today</span><h2 style="font:22px Space Grotesk">18-day streak</h2><p>A little daylight. A clearer head. You checked in today at 7:42 AM.</p><div class="kv">Schedule <b>Every day · 7:30 AM</b></div><div class="kv">Daily goal <b>20 minutes</b></div><h3 style="margin-top:18px">LAST 28 DAYS</h3><div class="heatmap">${Array.from({length:28},(_,i)=>`<span></span>`).join('')}</div><small class="muted">Sep 10 &nbsp;&nbsp;&nbsp; Oct 7</small>`)}</div>`; }
function analytics() { return pageTitle('Understand your momentum.', 'See what helps you focus, and what quietly gets in the way.', button('⇩ Export report', true)) + `<div class="grid stats">${stat('Focused time','26h 40m','↑ 12.4% vs. previous 7 days','◷')}${stat('Tasks completed','38','↑ 8 tasks vs. previous period','✓')}${stat('Focus quality','89%','↑ 4 points • Consistently strong','◎')}${stat('Distraction time','2h 18m','↓ 22% vs. previous 7 days','♧')}</div><div class="grid two-col">${card('Focus over time', `<div class="tag">Focused time</div>${bars()}<p class="muted">Your strongest day was Tuesday. You’re building a more consistent week.</p>`)}${card('Where your time went', `<strong style="font:25px Space Grotesk">31h 06m</strong><p class="muted">Total tracked this week</p><div class="metric-line"><span style="width:85%"></span></div><div class="list-row"><span class="dot"></span>Productive <span class="right">26h 40m · 86%</span></div><div class="list-row"><span class="dot" style="background:#317ff2"></span>Neutral <span class="right">2h 08m · 7%</span></div><div class="list-row"><span class="dot" style="background:var(--red)"></span>Distracting <span class="right">2h 18m · 7%</span></div>`)}</div><div class="grid two-col" style="margin-top:12px">${card('Your attention curve', `<div class="line-chart"><svg viewBox="0 0 500 140" preserveAspectRatio="none"><path d="M0,90 C80,75 120,38 210,45 C290,40 320,65 360,55 C410,70 450,85 500,92" fill="none" stroke="#1bcde0" stroke-width="2"/></svg></div><small class="muted">Morning work blocks show the lowest interruption rate.</small>`)}${card('Most productive applications', `<div class="list-row">Visual Studio Code <span class="right">16h 24m</span></div><div class="list-row">IntelliJ IDEA <span class="right">5h 12m</span></div><div class="list-row">Figma <span class="right">3h 08m</span></div>`)}</div>`; }
function workload() { return pageTitle('A clear view of your workspace.', 'Computer performance and active applications, in one calm control center.', button('▦ Tracking settings', true)) + `<div class="grid stats">${stat('CPU usage','38%','3.5 GHz • 8 cores','▣')}${stat('GPU usage','27%','42°C • 0.8 / 6 GB VRAM','▥')}${stat('Memory','52%','8.3 / 16 GB in use','▰')}${stat('Disk usage','68%','348 / 512 GB • 164 GB free','▤')}</div><div class="grid app-grid">${card('Resource activity', `<div class="actions" style="justify-content:start"><span class="tag">CPU</span><span class="muted">GPU</span><span class="muted">Memory</span><span class="muted">Network</span><span class="status done">Healthy</span></div>${bars()}<small class="muted">Average 31% &nbsp; Peak 62% &nbsp; <span style="color:var(--cyan)">Current 38%</span></small>`)}${card('System health', `<h3>▱ &nbsp; Neil's workstation</h3><p class="muted">Windows 11 • Desktop agent v2.4.1</p><div class="kv">CPU temperature <b>54°C</b></div><div class="kv">GPU temperature <b>42°C</b></div><div class="kv">Uptime <b>6h 32m</b></div><div class="kv">Network <b>↕ 8.2 Mbps ↑ 1.24 Mbps</b></div><p class="healthy">◉ No performance issues detected</p>`) }${card('Active applications', `<div class="app-row header"><span>APPLICATION</span><span>CPU</span><span>MEMORY</span><span>ACTIVE TIME</span></div>${[['Visual Studio Code','12.4%','1.2 GB','2h 42m'],['IntelliJ IDEA','8.1%','2.1 GB','1h 05m'],['Google Chrome','6.8%','1.8 GB','48m'],['Figma','4.2%','820 MB','25m'],['Spotify','1.2%','240 MB','40m'],['Discord','0.6%','380 MB','8m']].map((a,i)=>`<div class="app-row ${i===0?'active':''}"><span>${a[0]}</span><span>${a[1]}</span><span>${a[2]}</span><span class="${i===5?'':'healthy'}">${a[3]}</span></div>`).join('')}`, '')}</div>`; }
function guard() { return pageTitle('Give distractions a boundary.', 'Keep the useful. Keep your attention yours.', button('+ Add website', true)) + `<div class="card" style="border-color:#07483f;background:#071c24;margin-bottom:12px"><b class="healthy">◉ &nbsp;Your focus is protected.</b><small class="muted"> &nbsp; 12 sites blocked during your current deep-work session.</small><span style="float:right">${button('Ⅱ Pause protection')}</span></div><div class="grid stats">${stat('Blocked attempts today','14','2 during your current focus session','◉')}${stat('Estimated time saved','36m','Based on your usual browsing time','◷')}${stat('Protected websites','12','Across 5 distraction categories','◎')}</div><div class="grid two-col">${card('Protected websites', `<div class="actions" style="justify-content:start"><span class="tag">Blocklist · 12</span><span class="muted">Allowlist · 4</span><span class="muted">Activity log</span></div><table class="table"><thead><tr><th>WEBSITE</th><th>CATEGORY</th><th>RULE</th></tr></thead><tbody>${['youtube.com','reddit.com','x.com','instagram.com','facebook.com','tiktok.com','twitch.tv','netflix.com','discord.com','pinterest.com','gape.com','news.ycombinator.com'].map((x,i)=>`<tr><td>⊘ ${x}</td><td>${i%3?'Social':'Video'}</td><td style="color:var(--purple-2)">During focus</td></tr>`).join('')}</tbody></table>`)}${card('Protection settings', `<div class="kv">WHEN TO PROTECT <b>Focus sessions</b></div><div class="kv">Start with focus sessions <b style="color:var(--purple-2)">●</b></div><div class="kv">Strict mode <b>○</b></div><p class="healthy">◉ Browser extension connected</p>`)}</div>`; }
function coach() { return pageTitle('A thoughtful partner for your day.', 'Turn your patterns into practical next steps. You decide what changes.', button('+ New conversation', true)) + `<div class="grid chat-grid">${card('Conversations', `${button('+  New conversation')}<div class="conversation"><button class="active">Plan a focused afternoon<small class="muted">10:40 AM</small></button><button>My weekly momentum<small class="muted">9:10 AM</small></button><button>Build a reading habit<small class="muted">Yesterday</small></button></div>`)}${card('✣ &nbsp; Plan a focused afternoon', `<div class="chat-message"><span class="tag">Neil · 10:40 AM</span><p>I have four tasks left and sprint planning at 2 PM. How should I organize the rest of my day?</p></div><p><b style="color:#bc8aff">✣ Task Aura AI Coach</b> <small class="muted">10:40 AM</small></p><p>You’ve already completed 6 tasks and logged 4h 12m of focused time. Let’s protect your momentum without overloading the afternoon.</p><div class="coach-block"><b>Finish your current block, then use the following plan:</b><div class="list-row">11:30 <span>Take a real break</span><span class="right">10 minutes</span></div><div class="list-row">11:40 <span>Review pull requests</span><span class="right">30 minutes</span></div><div class="list-row">13:00 <span>Document API endpoints</span><span class="right">45 minutes</span></div><div class="list-row">14:00 <span>Atlas sprint planning</span><span class="right">45 minutes</span></div><div class="list-row">15:00 <span>Write integration tests</span><span class="right">50 minutes</span></div></div>${button('▣ Add plan to calendar', true)} ${button('⚙ Adjust plan')}<input class="prompt" placeholder="Ask a follow-up or tell me what to change..." />`) }${card('Today, in context', `<span class="tag">Live workspace context</span><div class="kv">Focus time <b>4h 12m</b></div><div class="kv">Tasks complete <b>6 / 10</b></div><div class="kv">Next meeting <b>2:00 PM</b></div><h3 style="margin-top:25px">Patterns worth knowing</h3><p>Peak focus<br><strong>9–11 AM</strong></p><div class="metric-line"><span style="width:78%;background:var(--green)"></span></div><p class="healthy">Well balanced</p>`)}</div>`; }
function progress() { return pageTitle('Progress you can feel.', 'A quiet record of showing up. Every focused step adds up.', button('ⓘ How XP works', true)) + `<div class="grid two-col">${card('', `<div style="display:flex;gap:22px;align-items:center"><div class="ring" style="width:120px;height:120px"><div class="ring-content"><small>LEVEL</small><strong style="font:40px Space Grotesk">14</strong></div></div><div><span class="tag">Momentum</span><h2 style="font:20px Space Grotesk">Steady work. Real growth.</h2><p class="muted">You’re building a reliable rhythm, one task, focus session and small habit at a time.</p><div class="metric-line"><span style="width:76%"></span></div><small class="muted">2,450 / 3,000 XP &nbsp; 550 XP to level 15</small></div></div>`)}${card('Your XP this week', `<strong style="font:27px Space Grotesk">+1,840 XP</strong>${bars()}<small class="muted">↑ 16% compared with last week</small>`)}</div><div class="grid stats" style="margin-top:12px">${stat('XP earned today','+320','Tasks +180 • Focus +80 • Habits +60','◉')}${stat('Focus consistency','10 days','At least one session each day','◷')}${stat('Total tasks completed','248','38 this week • ↑ 6 today','✓')}</div><div class="grid two-col">${card('Milestones', `<div class="grid three-col"><div class="card"><b>◎ &nbsp; Focused ten</b><p class="muted">10 consecutive days of focus</p><span class="status done">Earned today</span></div><div class="card"><b>♧ &nbsp; A little every day</b><p class="muted">18-day morning walk streak</p><span class="status done">Earned Oct 5</span></div><div class="card"><b>✓ &nbsp; A productive week</b><p class="muted">Complete 40 tasks in one week</p><span class="status">38 / 40 tasks</span></div></div>`)}${card('What counts as progress?', `<div class="list-row">☑ &nbsp; Complete a task · +30 XP</div><div class="list-row">◷ &nbsp; Finish a focus session · +40 XP</div><div class="list-row">↻ &nbsp; Check in to a habit · +20 XP</div><p class="muted">XP celebrates effort, not perfection. Rest days never take away your progress.</p>`)}</div>`; }
function calendar() { return pageTitle('Make time for what matters.', 'Tasks, focus blocks, and your life — with a little room between them.', button('+ New event', true)) + `<div class="grid two-col"><div class="card" style="overflow:auto"><div class="actions" style="justify-content:start;margin-bottom:12px">${button('Today')}${button('‹')}${button('›')}<b style="padding:8px">October 5–9, 2026</b><span class="tag">Work week</span></div><div class="calendar">${['MON 5','TUE 6','WED 7','THU 8','FRI 9'].map((d,i)=>`<div class="day-col"><div class="day-head ${i===2?'active':''}">${d}</div>${[['Deep work · Atlas','8:00–9:30'],['Backend review','10:00–11:00'],['Project kickoff','14:00–15:00']].map((e,j)=>`<div class="event ${j===1?'blue':''}" style="margin-top:${j*25+7}px">${e[0]}<small>${e[1]}</small></div>`).join('')}</div>`).join('')}</div></div>${card('Wednesday, October 7', `<strong style="font:23px Space Grotesk">4h 05m</strong><span style="margin-left:28px;font:23px Space Grotesk">45m</span><p class="muted">Planned work &nbsp;&nbsp;&nbsp; Meetings</p><div class="metric-line"><span style="width:72%"></span></div><h3 style="margin-top:22px">Up next</h3><div class="list-row">11:30 <span>Review pull requests</span></div><div class="list-row">13:00 <span>Document API endpoints</span></div><div class="list-row">14:00 <span>Atlas sprint planning</span></div>`)}</div>`; }
function plugins() { const plugins=[['♢','Website Guard for Chrome','Block distracting websites automatically during focus sessions.'],['▣','Google Calendar','Keep meetings, focus blocks and tasks together in one schedule.'],['</>','Visual Studio Code','Link coding activity to tasks and understand your focus time.'],['◒','Ambient Space','Calm, immersive background audio for uninterrupted work.'],['⌘','GitHub','Bring issues and pull requests into your daily task flow.'],['▤','Notion','Turn notes and project pages into clear, actionable tasks.'],['▱','Slack','Set your focus status and quiet notifications while you work.']]; return pageTitle('Your tools. Better together.', 'Extend Task Aura with thoughtful connections that fit your workflow.', button('▣ Manage permissions', true)) + `<div class="grid plugin-grid"><div class="card plugin-banner"><div><span class="tag">BUILT FOR YOUR WORKFLOW</span><h2>Less switching. More doing.</h2><p class="muted">Bring your tasks, calendar and development tools into one focused workspace.</p></div>${button('↗ Explore integrations', true)}</div>${plugins.map((p,i)=>`<div class="card plugin-card"><div class="plugin-icon">${p[0]}</div><span class="status ${i<4?'done':''}" style="float:right">${i<4?'Installed':'Verified'}</span><h3>${p[1]}</h3><p>${p[2]}</p><small class="muted">${i<4?'Connected · Synced just now':'By Task Aura · Free'}</small><br>${button(i<4?'Manage':'＋ Install', i>=4)}</div>`).join('')}</div>`; }
function unavailablePage(title, subtitle) {
  return pageTitle(title, subtitle) + `<div class="card empty"><h3>No local data available</h3><p>This view does not invent activity. Connect a real integration or add data from the workspace to see it here.</p><span class="status">Not connected</span></div>`;
}
function localProgress() {
  const completed = state.data.tasks.filter(task => task.status === 'Done').length;
  return pageTitle('Progress you can feel.', 'A record built only from your local actions.') + `<div class="grid stats">${stat('XP earned', `+${state.data.xp}`, 'From completed local tasks', '◉')}${stat('Tasks completed', completed, 'Stored in this browser', '✓')}${stat('Focus sessions', state.data.sessions.length, 'Ended sessions', '◷')}${stat('Habits', state.data.habits.length, 'Created habits', '↻')}</div>${card('Your local activity', state.data.tasks.length || state.data.sessions.length ? `<div class="mini-list">${state.data.tasks.slice(0, 5).map(task => `<div class="list-row"><span class="dot ${task.status === 'Done' ? 'green' : ''}"></span>${escapeHtml(task.title)}<span class="right">${task.status}</span></div>`).join('')}</div>` : emptyState('No progress recorded yet'))}`;
}
function localHabits() {
  return pageTitle('Small actions. Lasting momentum.', 'Create habits and keep check-ins in the local workspace.', button('+ New habit', true)) +
    `${state.habitCoach.message ? `<div class="card"><span class="tag">AI HABIT COACH</span><p class="muted">${escapeHtml(state.habitCoach.message)}</p></div>` : ''}${card('Your habits', state.data.habits.length ? `<div class="mini-list">${state.data.habits.map(habit => `<div class="list-row"><span class="dot ${habit.checked ? 'green' : ''}"></span>${escapeHtml(habit.title)}<span class="right">${habit.source === 'ai-habit-coach' ? 'Detected automatically' : habit.checked ? 'Completed' : 'Ready to check in'}</span></div>`).join('')}</div>` : emptyState('No habits created yet'))}`;
}
function habitPatternHistory() {
  try { return JSON.parse(localStorage.getItem('task-aura-habit-patterns') || '{}'); } catch { return {}; }
}
function rememberHabitPattern(key, title, source, date) {
  const history = habitPatternHistory();
  const item = history[key] || { title, source, dates: [] };
  item.dates = [...new Set([...item.dates, date])].sort().slice(-30);
  history[key] = item;
  localStorage.setItem('task-aura-habit-patterns', JSON.stringify(history));
  return item;
}
async function detectHabitPatterns(workload) {
  const activities = [];
  const add = (title, source, date) => { if (title && date) activities.push({ title, source, date: date.slice(0, 10) }); };
  state.data.tasks.filter(item => item.status === 'Done').forEach(item => add(item.title, 'completed task', item.completedAt || item.updatedAt || item.createdAt));
  state.data.sessions.forEach(item => add('Complete a focused work session', 'focus session', item.endedAt));
  state.data.calendar.forEach(item => add(item.title || item.name, 'calendar entry', item.when || item.createdAt));
  (workload?.processes || []).slice(0, 100).forEach(item => {
    const name = String(item.name || '').replace(/\.exe$/i, '');
    if (/code|idea|devenv|figma|chrome|msedge/i.test(name)) add(`Use ${name} for focused work`, 'running app', new Date().toISOString());
  });
  let created = null;
  activities.forEach(activity => {
    const key = `${activity.source}:${activity.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const pattern = rememberHabitPattern(key, activity.title, activity.source, activity.date);
    const exists = state.data.habits.some(habit => habit.patternKey === key || habit.title.toLowerCase() === activity.title.toLowerCase());
    if (!created && pattern.dates.length >= 3 && !exists) created = { ...activity, patternKey: key, patternDays: pattern.dates.length };
  });
  if (!created) return;
  try {
    const habit = await apiRequest('/habits', { method: 'POST', body: JSON.stringify({ title: created.title, checked: false, source: 'ai-habit-coach', patternKey: created.patternKey, patternDays: created.patternDays }) });
    state.data.habits.unshift(habit);
    state.habitCoach.message = `Added “${created.title}” automatically after detecting it on ${created.patternDays} different days from ${created.source} activity.`;
    state.habitCoach.lastDetected = new Date().toISOString();
    saveData();
    if (state.page === 'habits') render();
  } catch (error) {
    state.habitCoach.message = `A recurring pattern was found, but it could not be saved: ${error.message}`;
  }
}
function collectionPage(title, subtitle, collection, label, placeholder) {
  const items = state.data[collection] || [];
  return pageTitle(title, subtitle, button(`+ ${label}`, true)) +
    `${card(label, items.length ? `<div class="mini-list">${items.map(item => `<div class="list-row"><span class="dot green"></span>${escapeHtml(item.title || item.name || item.url || 'Untitled')}<span class="right">${item.status || item.category || 'Saved'}</span></div>`).join('')}</div>` : emptyState(`No ${label.toLowerCase()} yet`))}`;
}
function addCollectionItem(collection, label, placeholder) {
  const form = document.createElement('form');
  form.className = 'task-form card';
  form.innerHTML = `<h3>Add ${label.toLowerCase()}</h3><input class="search" name="value" placeholder="${placeholder}" required autofocus><div class="actions"><button class="btn" type="button">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>`;
  document.querySelector('.content').prepend(form);
  form.querySelector('button[type="button"]').addEventListener('click', () => form.remove());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const value = new FormData(form).get('value')?.trim();
    if (!value) return;
    const item = await apiRequest(`/${collection}`, { method: 'POST', body: JSON.stringify({ title: value, name: value, url: value }) });
    state.data[collection].unshift(item);
    if (collection === 'guardRules') state.guard.rules = [item, ...state.guard.rules];
    saveData();
    render();
  });
}
function analyticsLocal() {
  const totalFocus = state.data.sessions.reduce((sum, session) => sum + session.duration, 0);
  const completed = state.data.tasks.filter(task => task.status === 'Done').length;
  return pageTitle('Understand your momentum.', 'Insights calculated from your local tasks and sessions.') +
    `<div class="grid stats">${stat('Focused time', formatDuration(totalFocus), 'Recorded locally', '◷')}${stat('Tasks completed', completed, 'Local task history', '✓')}${stat('Focus quality', totalFocus ? 'Tracked' : '—', 'Requires session history', '◎')}${stat('Distraction time', '—', 'No tracker connected', '♧')}</div>${card('Local activity', totalFocus || completed ? `<div class="mini-list"><div class="list-row">Completed tasks <span class="right">${completed}</span></div><div class="list-row">Focus sessions <span class="right">${state.data.sessions.length}</span></div><div class="list-row">Total focus time <span class="right">${formatDuration(totalFocus)}</span></div></div>` : emptyState('No analytics data yet'))}`;
}
function calendarLocal() {
  const items = state.data.calendar || [];
  const googleAction = state.google?.connected ? button('✓ Google Calendar connected') : button(state.google?.configured ? 'Connect Google Calendar' : 'Google Calendar setup required');
  const today = localDateKey();
  const todayCount = [...items, ...state.data.tasks].filter(item => String(item.when || item.createdAt || '').startsWith(today)).length;
  const focusHours = state.data.sessions.filter(item => String(item.endedAt || '').startsWith(today)).reduce((sum, item) => sum + Number(item.duration || 0), 0);
  return pageTitle('Make time for what matters.', 'A calm overview of your month, focus, and daily history.', `${googleAction} ${button('+ New event', true)}`) +
    `<div class="calendar-bento">
      ${card('Today', `<strong class="bento-number">${todayCount}</strong><p class="muted">Activity item${todayCount === 1 ? '' : 's'} recorded</p>`, 'calendar-bento-today')}
      ${card('Focus time', `<strong class="bento-number">${formatDuration(focusHours)}</strong><p class="muted">Completed sessions today</p>`, 'calendar-bento-focus')}
      ${card('Calendar entries', `<strong class="bento-number">${items.length}</strong><p class="muted">Local events saved</p>`, 'calendar-bento-events')}
      ${card('Month view', calendarGrid(items), 'calendar-bento-month')}
      ${card('Selected date history', `<div class="calendar-history">${calendarHistory(items)}</div>`, 'calendar-bento-history')}
    </div>`;
}
function calendarGrid(items) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const first = new Date(year, month, 1).getDay();
  const cells = Array.from({ length: first }, () => '<span class="calendar-day empty-day"></span>');
  for (let day = 1; day <= days; day++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const count = items.filter(item => String(item.when || item.createdAt || '').startsWith(date)).length;
    const isToday = date === localDateKey();
    cells.push(`<button class="calendar-day ${isToday ? 'today' : ''}" data-date="${date}"><b>${day}</b>${count ? `<small>${count} event(s)</small>` : '<span class="calendar-dot"></span>'}</button>`);
  }
  return `<h2 style="font:18px Segoe UI">${now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><div class="calendar-week">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => `<small>${day}</small>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div>`;
}
function calendarHistory(items, selectedDate = localDateKey()) {
  const history = [...items.map(item => ({ date: item.when || item.createdAt, text: item.title, type: 'Calendar' })), ...state.data.tasks.map(item => ({ date: item.createdAt, text: item.title, type: 'Task' })), ...state.data.sessions.map(item => ({ date: item.endedAt, text: 'Focus session', type: 'Focus' })), ...(state.guard.attempts || []).map(item => ({ date: item.blockedAt, text: item.url, type: 'Blocked website' }))].filter(item => String(item.date || '').startsWith(selectedDate));
  return `<h3>${selectedDate}</h3>${history.length ? `<div class="mini-list">${history.map(item => `<div class="list-row"><span class="dot"></span>${escapeHtml(item.text)}<span class="right">${item.type}</span></div>`).join('')}</div>` : emptyState('No activity recorded on this date')}`;
}
function profilePage() {
  const account = state.auth.authenticated
    ? `<div class="account-status"><span class="dot green"></span><span>Signed in as <b>${escapeHtml(state.auth.email || state.profile.profileName)}</b><small>${escapeHtml(state.auth.provider || 'local')} account</small></span><button class="btn logout-button" type="button">Log out</button></div>`
    : `<div class="account-actions"><button class="btn btn-primary" data-page="login">Sign in</button><button class="btn google-login" type="button">Continue with Google</button><small class="muted auth-control-message">${state.google?.configured ? 'Google login is ready.' : 'Google login requires your own OAuth credentials on the server.'}</small></div>`;
  return pageTitle('Your profile.', 'Update the local account details used by Task Aura.') + `${card('Profile details', `<form class="profile-form"><label>Name<input class="search" name="profileName" value="${escapeHtml(state.profile.profileName)}" required></label><label>Age<input class="search" name="age" type="number" min="1" max="120" value="${escapeHtml(state.profile.age)}"></label><label>Upload profile picture<input class="search" name="photoFile" type="file" accept="image/*"></label><label>Or use picture URL<input class="search" name="photo" value="${escapeHtml(state.profile.photo)}" placeholder="https://..."></label><button class="btn btn-primary" type="submit">Save profile</button></form>${account}`)}${card('Profile rewards', `<div class="kv"><span>Unique profile ID</span><b>${escapeHtml(state.profile.profileId || 'Generating...')}</b></div><div class="kv"><span>Total XP</span><b>${Number(state.profile.xp ?? state.data.xp) || 0} XP</b></div><div class="kv"><span>Emergency tokens</span><b>${Number(state.profile.tokens ?? state.tokens) || 0}</b></div><p class="muted">XP is added when a task is completed. One emergency token is added to this profile each new day.</p>`)}`;
}
function settingsPage() {
  return pageTitle('Settings.', 'Control appearance and notification behavior.') + card('Preferences', `<form class="settings-form"><label>Theme<select class="search" name="theme"><option value="dark" ${state.profile.theme === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${state.profile.theme === 'light' ? 'selected' : ''}>Light</option><option value="system" ${state.profile.theme === 'system' ? 'selected' : ''}>System</option></select></label><label><input name="muted" type="checkbox" ${state.profile.muted ? 'checked' : ''}> Mute notifications and sounds</label><button class="btn btn-primary" type="submit">Save settings</button></form>`);
}
function guardLocal() {
  const rules = state.guard.rules || state.data.guardRules || [];
  const attempts = state.guard.attempts || [];
  const toggleLabel = state.guard.enabled ? 'Ⅱ Pause protection' : '▶ Start protection';
  return pageTitle('Give distractions a boundary.', 'Check URLs against your local blocklist. Browser-wide blocking requires an extension.', `${button(toggleLabel)} ${button('+ Add website', true)}`) +
    `<div class="card" style="border-color:${state.guard.enabled ? '#07483f' : '#49321d'};margin-bottom:12px"><b class="${state.guard.enabled ? 'healthy' : ''}">${state.guard.enabled ? '◉ Protection active' : '○ Protection paused'}</b><span class="muted"> ${rules.length} local rule(s)</span></div>
    ${card('Test a website', `<form class="guard-check task-form"><input class="search" name="url" placeholder="Enter a URL to check, e.g. social.example" required><button class="btn btn-primary" type="submit">Check URL</button></form><div class="guard-result muted">No URL checked yet.</div>`)}
    <div class="grid two-col">${card('Protected websites', rules.length ? `<div class="mini-list">${rules.map(rule => `<div class="list-row"><span class="dot green"></span>${escapeHtml(rule.url || rule.title)}<span class="right">Block rule</span></div>`).join('')}</div>` : emptyState('No websites added'))}${card('Recent blocked attempts', attempts.length ? `<div class="mini-list">${attempts.slice(0, 8).map(item => `<div class="list-row"><span class="dot"></span>${escapeHtml(item.url)}<span class="right">${new Date(item.blockedAt).toLocaleTimeString()}</span></div>`).join('')}</div>` : emptyState('No blocked attempts yet'))}</div>`;
}
function coachLocal() {
  const notes = state.data.notes || [];
  const proposal = state.coach.proposal;
  const monitor = state.coach.monitoring ? 'Monitoring active' : 'Monitoring paused';
  return pageTitle('A thoughtful partner for your day.', 'The coach watches process names and workload metrics only. It never assigns a task without your approval.', button(state.coach.monitoring ? 'Ⅱ Pause monitoring' : '▶ Start monitoring')) +
    `${card('Coach monitor', `<div class="kv"><span>Status</span><b class="healthy">${monitor}</b></div><div class="kv"><span>Last scan</span><b>${state.coach.lastScan ? new Date(state.coach.lastScan).toLocaleTimeString() : 'Waiting for first scan'}</b></div><p class="muted">No window titles, file names, keystrokes, or screen contents are collected.</p>`)}${card('Suggested task', proposal ? `<div class="coach-proposal"><span class="tag">Detected from local workload</span><h3>${escapeHtml(proposal.title)}</h3><p class="muted">${escapeHtml(proposal.reason)}</p><button class="btn btn-primary approve-coach" data-task-title="${escapeHtml(proposal.title)}">Approve and assign</button><button class="btn dismiss-coach">Dismiss</button></div>` : emptyState('No task suggestion yet. The coach will suggest one after a workload scan.'))}${card('Local notes', notes.length ? `<div class="mini-list">${notes.map(note => `<div class="list-row"><span class="dot"></span>${escapeHtml(note.title)}<span class="right">${new Date(note.createdAt).toLocaleDateString()}</span></div>`).join('')}</div>` : emptyState('No notes yet'))}`;
}
function coachProposal(workload) {
  const names = (workload?.processes || []).map(item => String(item.name || '').toLowerCase());
  if (names.some(name => name.includes('code') || name.includes('idea') || name.includes('devenv'))) return { title: 'Continue the active development task', reason: 'A development environment is running. Set one clear implementation step and work on it in a focused session.' };
  if (names.some(name => name.includes('figma'))) return { title: 'Review and refine the current design', reason: 'Figma is active. Capture one design decision or finish one visible screen before switching context.' };
  if (names.some(name => name.includes('chrome') || name.includes('msedge'))) return { title: 'Complete the next browser-based work item', reason: 'A browser is active. Choose the next concrete work item before opening unrelated tabs.' };
  return { title: 'Review your next priority', reason: `The system has ${workload?.processes?.length || 0} visible processes. Choose one meaningful next step before starting another activity.` };
}
function workloadLocal() {
  const workload = state.workload;
  if (!workload) return pageTitle('A clear view of your workspace.', 'Local workload monitoring could not be read.') + card('Workload integration', `<div class="empty">${escapeHtml(state.workloadError || 'No workload data available')}</div>`);
  const usedPercent = workload.memory.usedPercent;
  const processes = workload.processes || [];
  return pageTitle('A clear view of your workspace.', 'Live data from this computer via the local Task Aura server.') +
    `<div class="grid stats">${stat('Memory used', `${usedPercent}%`, `${formatBytes(workload.memory.used)} / ${formatBytes(workload.memory.total)}`, '▰')}${stat('CPU cores', workload.cpuCount, workload.platform, '▣')}${stat('System uptime', formatUptime(workload.uptime), workload.hostname, '◷')}${stat('Running apps', processes.length, 'Processes visible to local server', '▱')}</div>
    <div class="grid app-grid">${card('System health', `<div class="kv">Host <b>${escapeHtml(workload.hostname)}</b></div><div class="kv">Platform <b>${escapeHtml(workload.platform)}</b></div><div class="kv">Free memory <b>${formatBytes(workload.memory.free)}</b></div><p class="healthy">◉ Local monitoring connected</p>`)}${card('Active applications', processes.length ? `<div class="app-row header"><span>PROCESS</span><span>PID</span><span>MEMORY</span><span>STATUS</span></div>${processes.slice(0, 15).map(item => `<div class="app-row"><span>${escapeHtml(item.name)}</span><span>${item.pid || '—'}</span><span>${escapeHtml(item.memory)}</span><span class="healthy">Running</span></div>`).join('')}` : emptyState('No Windows process data returned'))}</div>`;
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : `${hours}h`;
}
function pluginsLocal() {
  const integrations = state.data.integrations || [];
  const google = state.google || { configured: false, connected: false };
  const services = [
    { id: 'google', icon: '▦', name: 'Google Calendar', description: google.connected ? `Connected${google.email ? ` as ${google.email}` : ''}` : 'Sync events from your Google Calendar.', status: google.connected ? 'Connected' : (google.configured ? 'Ready to connect' : 'Credentials required'), action: google.connected ? 'Open calendar' : (google.configured ? 'Connect' : 'Setup required') },
    { id: 'guard', icon: '◈', name: 'Website Guard', description: 'Use your local blocklist to protect focused work.', status: state.guard.enabled ? 'Active locally' : 'Paused', action: 'Open guard' },
    { id: 'workload', icon: '▱', name: 'Local workload', description: 'Read live process and memory information from this computer.', status: state.workload ? 'Connected locally' : 'Unavailable', action: 'Open workload' }
  ];
  return pageTitle('Your tools. Better together.', 'Connect services and manage the local integrations used by Task Aura.', button('+ Add integration', true)) +
    `<div class="grid plugin-grid">${services.map(service => card(`<span class="plugin-icon">${service.icon}</span>${service.name}`, `<p class="muted">${service.description}</p><div class="kv"><span>Status</span><b class="${service.status.includes('Active') || service.status === 'Connected' ? 'healthy' : ''}">${service.status}</b></div><button class="btn ${service.action === 'Connect' ? 'btn-primary' : ''}" data-plugin="${service.id}">${service.action}</button>`)).join('')}</div>` +
    `${card('Saved integrations', integrations.length ? `<div class="mini-list">${integrations.map(item => `<div class="list-row"><span class="dot green"></span>${escapeHtml(item.title || item.name)}<span class="right">Saved locally</span></div>`).join('')}</div>` : emptyState('No custom integrations saved yet'))}`;
}
function localFocus() {
  const current = state.data.tasks.find(task => task.status !== 'Done');
  const total = state.data.sessions.reduce((sum, session) => sum + session.duration, 0);
  const assigned = state.data.tasks.find(task => task.id === state.activeTaskId);
  return pageTitle('Protect your attention.', 'Assign a task here to keep the focus plugins active until it is completed.') +
    `${card('Assigned task', `<form class="focus-assignment"><select class="search" name="taskId" required><option value="">Choose an unfinished task</option>${state.data.tasks.filter(task => task.status !== 'Done').map(task => `<option value="${task.id}" ${task.id === state.activeTaskId ? 'selected' : ''}>${escapeHtml(task.title)}</option>`).join('')}</select><button class="btn btn-primary" type="submit">Assign task</button>${assigned ? `<button class="btn emergency-cancel" type="button">Emergency cancel (1 token)</button>` : ''}<p class="muted">${assigned ? `Plugins locked for: ${escapeHtml(assigned.title)}` : 'No task assigned. You have ' + state.tokens + ' emergency token(s).'}</p></form>`)}${card('', `<div class="ring-wrap"><div class="ring" style="width:190px;height:190px"><div class="ring-content"><div class="ring-time">${formatTime()}</div><small>${state.timerActive ? 'REMAINING • DEEP WORK' : 'READY • DEEP WORK'}</small><span class="tag">${state.timerActive ? 'Session in progress' : 'Start a session'}</span></div></div><h3 style="margin-top:15px">${assigned ? escapeHtml(assigned.title) : current ? escapeHtml(current.title) : 'No task selected'}</h3><small class="muted">${assigned ? 'Assigned focus task' : 'Choose a task above'}</small></div><div class="focus-actions">${button(state.timerActive ? 'Ⅱ Pause session' : '▶ Start session', true)}${button('□ End session')}</div>`, 'focus-main')}${card('Session history', state.data.sessions.length ? `<div class="mini-list">${state.data.sessions.map(session => `<div class="list-row">Focus session <span class="right">${formatDuration(session.duration)}</span></div>`).join('')}</div>` : emptyState('No sessions recorded yet'))}${card('Local focus totals', `<strong style="font:25px Segoe UI">${formatDuration(total)}</strong><p class="muted">Total time recorded in this browser.</p>`)}</div>`;
}
const views = {
  dashboard,
  tasks,
  progress: localProgress,
  focus: localFocus,
  habits: localHabits,
  analytics: analyticsLocal,
  workload: workloadLocal,
  guard: guardLocal,
  coach: coachLocal,
  calendar: calendarLocal,
  plugins: pluginsLocal
  ,profile: profilePage,
  settings: settingsPage,
  login: authPage
};
function render() {
  if (state.page !== 'dashboard' && liquidFlowCleanup) liquidFlowCleanup();
  if (auraCompanionCleanup) auraCompanionCleanup();
  applyTheme();
  app.innerHTML = `<div class="app">${sidebar()}<main class="main">${topbar()}<div class="content">${views[state.page]?.() || dashboard()}${footer()}</div></main></div>`;
  setupLiquidFlow();
  setupAuraCompanion();
  document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => {
    state.page = b.dataset.page;
    location.hash = state.page;
    render();
  }));
  document.querySelectorAll('.focus-actions .btn-primary').forEach(button => button.addEventListener('click', () => {
    const limitSelect = button.closest('.focus-actions')?.querySelector('[data-focus-limit]');
    if (!state.timer) state.timerLimit = Number(limitSelect?.value) || state.timerLimit;
    state.timerActive = !state.timerActive;
    button.textContent = state.timerActive ? 'Ⅱ Pause session' : '▶ Resume session';
    updateFocusTimerDisplay();
  }));
  document.querySelectorAll('.focus-actions .btn').forEach(button => {
    if (button.textContent.includes('End session')) {
      button.addEventListener('click', () => {
        const elapsed = Math.max(0, state.timer);
        if (elapsed) {
          const session = { id: crypto.randomUUID(), duration: elapsed, endedAt: new Date().toISOString() };
          state.data.sessions.push(session);
          state.data.xp += Math.floor(elapsed / 60) * 2;
          saveData();
          apiRequest('/sessions', { method: 'POST', body: JSON.stringify({ duration: elapsed, endedAt: session.endedAt }) }).catch(error => console.warn(error.message));
        }
        state.timer = 0;
        state.timerActive = false;
        render();
      });
    }
  });
  document.querySelectorAll('.btn').forEach(button => {
    if (button.textContent.includes('New task') || button.textContent.includes('Add task')) {
      button.addEventListener('click', addTask);
    }
    if (button.textContent.includes('New habit')) button.addEventListener('click', addHabit);
    if (button.textContent.includes('New event')) button.addEventListener('click', () => addCollectionItem('calendar', 'Event', 'Event title'));
    if (button.textContent.includes('Connect Google Calendar')) button.addEventListener('click', () => { window.location.href = '/api/integrations/google/start'; });
    if (button.textContent.includes('Add website')) button.addEventListener('click', () => addCollectionItem('guardRules', 'Website', 'example.com'));
    if (button.textContent.includes('Pause protection') || button.textContent.includes('Start protection')) button.addEventListener('click', async () => {
      state.guard.enabled = !state.guard.enabled;
      await apiRequest('/guard/toggle', { method: 'POST', body: JSON.stringify({ enabled: state.guard.enabled }) });
      render();
    });
    if (button.textContent.includes('New note')) button.addEventListener('click', () => addCollectionItem('notes', 'Note', 'What are you thinking about?'));
    if (button.textContent.includes('Add integration')) button.addEventListener('click', () => addCollectionItem('integrations', 'Integration', 'Integration name'));
  });
  document.querySelectorAll('[data-task]').forEach(button => button.addEventListener('click', () => toggleTask(button.dataset.task)));
  const assignmentForm = document.querySelector('.focus-assignment');
  if (assignmentForm) assignmentForm.addEventListener('submit', async event => {
    event.preventDefault();
    const taskId = new FormData(assignmentForm).get('taskId');
    try {
      const result = await apiRequest('/focus/assign', { method: 'POST', body: JSON.stringify({ taskId }) });
      state.activeTaskId = result.activeTaskId;
      render();
    } catch (error) {
      assignmentForm.querySelector('.muted').textContent = error.message;
    }
  });
  document.querySelector('.emergency-cancel')?.addEventListener('click', async () => {
    if (!window.confirm('Cancel the assigned task and spend 1 emergency token?')) return;
    try {
      const result = await apiRequest('/focus/emergency-cancel', { method: 'POST', body: '{}' });
      state.activeTaskId = null;
      state.tokens = result.tokens;
      render();
    } catch (error) {
      window.alert(error.message);
    }
  });
  document.querySelectorAll('[data-plugin]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.plugin;
    if (action === 'google' && state.google?.configured && !state.google.connected) window.location.href = '/api/integrations/google/start';
    else if (action === 'google') button.textContent = 'Set credentials first';
    else { state.page = action === 'guard' ? 'guard' : 'workload'; location.hash = state.page; render(); }
  }));
  document.querySelectorAll('[data-page="profile"]').forEach(button => button.addEventListener('click', () => { state.page = 'profile'; location.hash = 'profile'; render(); }));
  document.querySelectorAll('[data-page="settings"]').forEach(button => button.addEventListener('click', () => { state.page = 'settings'; location.hash = 'settings'; render(); }));
  const profileForm = document.querySelector('.profile-form');
  if (profileForm) profileForm.addEventListener('submit', event => {
    event.preventDefault();
    const file = profileForm.querySelector('[name="photoFile"]').files[0];
    const save = photo => {
      profileForm.querySelector('[name="photo"]').value = photo;
      saveProfile();
    };
    if (file) {
      const reader = new FileReader();
      reader.onload = () => save(reader.result);
      reader.readAsDataURL(file);
    } else save(profileForm.querySelector('[name="photo"]').value);
  });
  const settingsForm = document.querySelector('.settings-form');
  if (settingsForm) settingsForm.addEventListener('submit', event => { event.preventDefault(); saveSettings(); });
  const authForm = document.querySelector('.auth-form');
  if (authForm) {
    authForm.querySelector('button[type="submit"]').addEventListener('click', async event => {
      event.preventDefault();
      await submitAuth('/auth/register', authForm);
    });
    authForm.querySelector('button[type="button"]').addEventListener('click', async () => submitAuth('/auth/login', authForm));
  }
  document.querySelectorAll('.google-login').forEach(button => button.addEventListener('click', () => beginGoogleLogin(button)));
  document.querySelectorAll('.logout-button').forEach(button => button.addEventListener('click', async () => {
    await apiRequest('/auth/logout', { method: 'POST', body: '{}' });
    state.auth = { authenticated: false, email: null, provider: null };
    render();
  }));
  document.querySelectorAll('.approve-coach').forEach(button => button.addEventListener('click', async () => {
    const title = button.dataset.taskTitle;
    try {
      const task = await apiRequest('/tasks', { method: 'POST', body: JSON.stringify({ title, status: 'To do', priority: 'Medium', source: 'ai-coach' }) });
      const assigned = await apiRequest('/focus/assign', { method: 'POST', body: JSON.stringify({ taskId: task.id }) });
      state.data.tasks.unshift(task);
      state.activeTaskId = assigned.activeTaskId;
      state.coach.proposal = null;
      saveData();
      render();
    } catch (error) {
      button.textContent = error.message;
    }
  }));
  document.querySelectorAll('.dismiss-coach').forEach(button => button.addEventListener('click', () => {
    state.coach.proposal = null;
    render();
  }));
  document.querySelectorAll('.page-title .btn').forEach(button => {
    if (button.textContent.includes('monitoring')) button.addEventListener('click', () => {
      state.coach.monitoring = !state.coach.monitoring;
      if (state.page === 'coach') render();
    });
  });
  document.querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => {
    const history = document.querySelector('.calendar-history');
    if (history) history.innerHTML = calendarHistory(state.data.calendar, button.dataset.date);
  }));
  const guardForm = document.querySelector('.guard-check');
  if (guardForm) guardForm.addEventListener('submit', async event => {
    event.preventDefault();
    const url = new FormData(guardForm).get('url');
    const result = await apiRequest('/guard/check', { method: 'POST', body: JSON.stringify({ url }) });
    const output = document.querySelector('.guard-result');
    output.textContent = result.blocked ? `Blocked: ${result.url} matches a protection rule.` : `Allowed: ${result.url} is not on the blocklist.`;
    output.style.color = result.blocked ? 'var(--red)' : 'var(--green)';
    state.guard = await apiRequest('/guard/status');
  });
}
async function beginGoogleLogin(button) {
  const message = button.closest('form, .account-actions')?.querySelector('.auth-result, .auth-control-message');
  try {
    const status = await apiRequest('/integrations/google/status');
    if (!status.configured) throw new Error('Google login is not configured on this server yet.');
    window.location.href = '/api/auth/google/start';
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}
async function scanCoach() {
  if (!state.coach.monitoring) return;
  try {
    const workload = await apiRequest('/workload');
    state.workload = workload;
    await detectHabitPatterns(workload);
    state.coach.lastScan = new Date().toISOString();
    if (!state.activeTaskId) state.coach.proposal = coachProposal(workload);
    if (state.page === 'coach') render();
  } catch (error) {
    state.workloadError = error.message;
  }
}
async function submitAuth(path, form) {
  const result = document.querySelector('.auth-result');
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    const response = await apiRequest(path, { method: 'POST', body: JSON.stringify(body) });
    state.auth = { authenticated: response.authenticated };
    state.profile = response.profile || state.profile;
    saveData();
    applyTheme();
    if (result) result.textContent = 'Account authenticated.';
  } catch (error) {
    if (result) result.textContent = error.message;
  }
}
render();
refreshFromApi();
window.addEventListener('hashchange', () => {
  state.page = location.hash.slice(1) || 'dashboard';
  render();
});
setInterval(() => {
  updateDashboardClock();
  if (state.timerActive) {
    state.timer++;
    updateFocusTimerDisplay();
    if (state.timer >= state.timerLimit) {
      state.timer = state.timerLimit;
      state.timerActive = false;
      render();
    }
  }
}, 1000);
setInterval(scanCoach, 30000);
scanCoach();
