// Auth, page selection, tab switching, URL permalink
import state from './state.js';
import { showNotify } from './utils.js';

export function checkAuth() {
  fetch('/api/me', { credentials: 'same-origin' }).then(r => r.json()).then(data => {
    if (data.logged_in && data.user) {
      state.currentUser = data.user;
      showApp(data.user);
      fetch('/api/pages', { credentials: 'same-origin' }).then(r => r.json()).then(pd => {
        state.userPages = pd.pages || data.user.pages || [];
        populatePages(state.userPages);
      }).catch(() => { state.userPages = data.user.pages || []; populatePages(state.userPages); });
      window.loadHistory(); window.loadComposeDrafts();
    }
    else showLogin();
  }).catch(() => showLogin());
}

export function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('navUser').classList.add('hidden');
}

export function showApp(u) {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  const n = document.getElementById('navUser');
  n.classList.remove('hidden');
  if (u.picture) document.getElementById('navAvatar').src = u.picture;
  document.getElementById('navName').textContent = u.name || '';
  if (u.login_at) { document.getElementById('sessionLoginTime').textContent = 'เข้าสู่ระบบเมื่อ: ' + new Date(u.login_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); }
  if (u.expires_at) { document.getElementById('sessionExpiry').textContent = 'หมดอายุ: ' + new Date(u.expires_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); }
  if (u.new_ip) { showNotify('⚠️ เข้าสู่ระบบจาก IP ใหม่: ' + u.ip); }
}

export function loginFacebook() { window.location.href = '/auth/facebook'; }

export function logout() {
  fetch('/auth/logout', { method: 'POST' }).then(() => { history.replaceState(null, '', '/'); showLogin(); }).catch(() => showLogin());
}

export function populatePages(pages) {
  const sel = document.getElementById('pageSelect');
  sel.innerHTML = '<option value="">-- เลือกเพจ --</option>';
  if (!pages || !pages.length) {
    sel.innerHTML = '<option value="">ไม่พบเพจ — สร้างเพจ Facebook ก่อน</option>';
    var info = document.getElementById('pageInfo');
    if (info) { info.classList.remove('hidden'); info.innerHTML = '<div style="padding:12px;font-size:0.82rem;color:var(--warning);line-height:1.6"><strong>ไม่พบเพจ Facebook</strong><br>คุณต้องมีเพจ Facebook อย่างน้อย 1 เพจ และเป็นแอดมินของเพจนั้น<br><a href="https://www.facebook.com/pages/create" target="_blank" rel="noopener" style="color:var(--accent)">สร้างเพจใหม่</a> แล้วกลับมา Login ใหม่</div>'; }
    return;
  }
  pages.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  const urlPage = new URLSearchParams(window.location.search).get('page');
  const saved = urlPage || localStorage.getItem('fb-selected-page');
  if (saved && pages.find(p => p.id === saved)) { sel.value = saved; selectPage(saved); }
}

export function selectPage(id) {
  const page = state.userPages.find(p => p.id === id);
  const info = document.getElementById('pageInfo');
  if (page) {
    state.selectedPage = page;
    localStorage.setItem('fb-selected-page', id);
    history.replaceState(null, '', '?page=' + id);
    document.getElementById('pageInfoPic').src = page.picture || '';
    document.getElementById('pageInfoName').textContent = page.name;
    document.getElementById('pageInfoMeta').textContent = (page.category || 'Page') + (page.followers ? ' · ' + page.followers + ' followers' : '');
    info.classList.remove('hidden');
    if (!document.getElementById('tabInsights').classList.contains('hidden')) window.loadInsights();
    if (!document.getElementById('tabHistory').classList.contains('hidden')) window.loadHistory();
    if (!document.getElementById('tabAutoReply').classList.contains('hidden')) { window.loadAutoReplySettings(); window.loadAutoReplyHistory(); }
    if (!document.getElementById('tabSchedule').classList.contains('hidden')) { window.loadSchedule(); window.loadBulkDrafts(); }
    if (!document.getElementById('tabCalendar').classList.contains('hidden')) window.renderCalendar();
    if (!document.getElementById('tabActivityLog').classList.contains('hidden')) window.loadLogs();
    if (!document.getElementById('tabChallenges').classList.contains('hidden')) window.loadChallenges();
    if (!document.getElementById('tabTickets').classList.contains('hidden')) window.loadTickets();
  } else {
    state.selectedPage = null;
    info.classList.add('hidden');
  }
}

export function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav-item').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  ['tabCompose', 'tabHistory', 'tabTemplates', 'tabTrends', 'tabCalendar', 'tabActivityLog', 'tabAutoReply', 'tabAiSettings', 'tabSchedule', 'tabDrafts', 'tabInsights', 'tabChallenges', 'tabTickets'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.classList.add('hidden');
  });
  const tabEl = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (tabEl) { tabEl.classList.remove('hidden'); setTimeout(function () { tabEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); }
  if (tab === 'history') window.loadHistory();
  if (tab === 'templates') window.loadTemplates();
  if (tab === 'compose') { window.loadComposeTemplates(); window.loadAiImageTemplates(); }
  if (tab === 'trends') window.loadTrends();
  if (tab === 'calendar') window.renderCalendar();
  if (tab === 'activityLog') window.loadLogs();
  if (tab === 'aiSettings') { window.loadAiSettings(); window.loadApiKeyStatus(); }
  if (tab === 'autoReply') { var dp = document.getElementById('arDateFilter'); if (dp && !dp.value) dp.value = new Date().toISOString().slice(0, 10); window.loadAutoReplySettings(); window.loadAutoReplyHistory(); }
  if (tab === 'tickets') window.loadTickets();
  if (tab === 'schedule') { window.loadSchedule(); window.loadBulkDrafts(); }
  if (tab === 'drafts') window.loadDrafts();
  if (tab === 'insights') window.loadInsights();
  if (tab === 'challenges') window.loadChallenges();
}

export function initRouter() {
  // Clean URL params after login (preserve ?page= for permalink)
  if (window.location.search || window.location.hash) {
    const keepPage = new URLSearchParams(window.location.search).get('page');
    history.replaceState(null, '', keepPage ? '?page=' + keepPage : '/');
  }
  checkAuth();
}
