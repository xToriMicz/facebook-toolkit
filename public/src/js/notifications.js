// Notification Bell v2 — priority, group by day, deep link, preferences
import state from './state.js';
import { insEsc } from './utils.js';

var TYPE_ICONS = {
  post_ok: '📝', post_fail: '❌', auto_reply: '💬', outbound: '🎯',
  comment_new: '💬', scheduled: '⏰', error: '⚠️', security: '🔒',
  bulk_done: '📦', settings: '⚙️',
};
var PRIORITY_COLORS = { urgent: '#ef4444', important: '#f59e0b', normal: 'var(--accent)' };

var _pollInterval = null;

export function initNotifications() {
  var navUser = document.getElementById('navUser');
  if (!navUser || document.getElementById('notifBell')) return;

  var bell = document.createElement('button');
  bell.id = 'notifBell';
  bell.style.cssText = 'position:relative;font-size:1.1rem;padding:6px 10px;cursor:pointer;background:none;border:none;color:var(--text)';
  bell.innerHTML = '🔔<span id="notifBadge" style="display:none;position:absolute;top:2px;right:2px;min-width:16px;height:16px;border-radius:8px;background:#ef4444;color:#fff;font-size:0.6rem;font-weight:700;text-align:center;line-height:16px;padding:0 4px"></span>';
  bell.onclick = toggleNotifPanel;

  var settingsBtn = navUser.querySelector('.nav-btn');
  if (settingsBtn) navUser.insertBefore(bell, settingsBtn);
  else navUser.appendChild(bell);

  var panel = document.createElement('div');
  panel.id = 'notifPanel';
  panel.style.cssText = 'display:none;position:fixed;top:56px;right:8px;width:min(380px,calc(100vw - 16px));max-height:75vh;background:var(--bg-card,#1a1a2e);border:1px solid var(--border);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.5);z-index:150;overflow:hidden;-webkit-overflow-scrolling:touch';
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-card,#1a1a2e);z-index:1">' +
    '<span style="font-size:0.9rem;font-weight:700;color:var(--text)">🔔 การแจ้งเตือน</span>' +
    '<button onclick="markNotifRead()" style="font-size:0.7rem;color:var(--accent);background:none;border:none;cursor:pointer;padding:4px 8px">อ่านทั้งหมด</button>' +
    '</div>' +
    '<div id="notifList" style="max-height:calc(75vh - 56px);overflow-y:auto;padding:0;-webkit-overflow-scrolling:touch"></div>';
  document.body.appendChild(panel);

  document.addEventListener('click', function (e) {
    var p = document.getElementById('notifPanel');
    var b = document.getElementById('notifBell');
    if (p && p.style.display !== 'none' && !p.contains(e.target) && !b.contains(e.target)) {
      p.style.display = 'none';
    }
  });

  loadNotifications();
  _pollInterval = setInterval(loadNotifications, 60000);
}

function toggleNotifPanel() {
  var panel = document.getElementById('notifPanel');
  if (!panel) return;
  var show = panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  if (show) loadNotifications();
}

export async function loadNotifications() {
  try {
    var r = await fetch('/api/notifications?limit=30', { credentials: 'same-origin' });
    var d = await r.json();
    var items = d.notifications || [];
    var unread = d.unread || 0;
    var urgent = d.urgent || 0;

    var badge = document.getElementById('notifBadge');
    if (badge) {
      if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.style.display = '';
        badge.style.background = urgent > 0 ? '#ef4444' : 'var(--accent)';
      } else {
        badge.style.display = 'none';
      }
    }

    var el = document.getElementById('notifList');
    if (!el) return;
    if (!items.length) {
      el.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--text-muted);font-size:0.82rem">ไม่มีการแจ้งเตือน</div>';
      return;
    }

    var groups = {};
    var groupOrder = [];
    var today = new Date().toISOString().slice(0, 10);
    var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    items.forEach(function (n) {
      var day = (n.created_at || '').slice(0, 10);
      if (!groups[day]) { groups[day] = []; groupOrder.push(day); }
      groups[day].push(n);
    });

    el.innerHTML = groupOrder.map(function (day) {
      var label = day === today ? 'วันนี้' : day === yesterday ? 'เมื่อวาน' : new Date(day + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long' });
      var notifs = groups[day];

      return '<div>' +
        '<div style="padding:8px 16px;font-size:0.7rem;font-weight:600;color:var(--text-muted);background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border)">' + label + '</div>' +
        notifs.map(function (n) {
          var icon = TYPE_ICONS[n.type] || '📌';
          var isUnread = !n.read_at;
          var time = formatTimeAgo(n.created_at);
          var prioColor = PRIORITY_COLORS[n.priority] || 'var(--accent)';

          return '<div onclick="markNotifSingleRead(' + n.id + ')" style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.03);' +
            (isUnread ? 'background:rgba(79,110,247,0.04);' : '') +
            'display:flex;gap:10px;align-items:start;cursor:pointer;-webkit-tap-highlight-color:transparent">' +
            '<div style="width:32px;height:32px;border-radius:8px;background:' + prioColor + '15;display:flex;align-items:center;justify-content:center;font-size:0.9rem;flex-shrink:0">' + icon + '</div>' +
            '<div style="flex:1;min-width:0">' +
            '<div style="font-size:0.8rem;color:var(--text);line-height:1.4' + (isUnread ? ';font-weight:600' : '') + '">' + insEsc(n.title) + '</div>' +
            (n.detail ? '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;line-height:1.3">' + insEsc(n.detail.slice(0, 80)) + '</div>' : '') +
            '<div style="font-size:0.62rem;color:var(--text-muted);margin-top:3px">' + time + '</div>' +
            '</div>' +
            (isUnread ? '<span style="width:8px;height:8px;border-radius:50%;background:' + prioColor + ';flex-shrink:0;margin-top:8px"></span>' : '') +
            '</div>';
        }).join('') +
        '</div>';
    }).join('');
  } catch (e) { /* silent */ }
}

export async function markNotifRead() {
  try {
    await fetch('/api/notifications/read', { method: 'POST', credentials: 'same-origin' });
    var badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
    loadNotifications();
  } catch (e) { }
}

export async function markNotifSingleRead(id) {
  try {
    await fetch('/api/notifications/' + id + '/read', { method: 'POST', credentials: 'same-origin' });
    loadNotifications();
  } catch (e) { }
}

function formatTimeAgo(dateStr) {
  var diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'เมื่อสักครู่';
  if (diff < 3600) return Math.floor(diff / 60) + ' นาทีที่แล้ว';
  if (diff < 86400) return Math.floor(diff / 3600) + ' ชั่วโมงที่แล้ว';
  if (diff < 604800) return Math.floor(diff / 86400) + ' วันที่แล้ว';
  return new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}
