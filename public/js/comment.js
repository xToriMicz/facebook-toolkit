// Auto Reply settings, toggle, history, filter
import state from './state.js';
import { insEsc, showNotify } from './utils.js';

var MODE_LABELS = { all: 'ตอบทุก comment', random: 'ตอบ 60-80% (สุ่ม)', question_only: 'ตอบเฉพาะคำถาม', off: 'ปิด' };

export async function loadAutoReplySettings() {
  var el = document.getElementById('autoReplyPageList');
  if (!state.selectedPage) { el.innerHTML = '<div style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:16px">กรุณาเลือกเพจก่อน</div>'; return; }
  try {
    var settingsRes = await fetch('/api/auto-reply/settings?page_id=' + state.selectedPage.id, { credentials: 'same-origin' });
    var settingsData = await settingsRes.json();
    var pages = [{ id: state.selectedPage.id, name: state.selectedPage.name }];
    var settings = {};
    settings[settingsData.page_id || state.selectedPage.id] = settingsData;
    el.innerHTML = pages.map(function (p) {
      var pageId = p.id || p.page_id;
      var pageName = p.name || p.page_name || pageId;
      var s = settings[pageId] || {};
      var enabled = s.enabled === 1 || s.enabled === true;
      var mode = s.reply_mode || 'all';
      return '<div style="padding:10px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div style="min-width:0;flex:1">' +
        '<div style="font-size:0.82rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + insEsc(pageName) + '</div>' +
        '<div style="font-size:0.65rem;color:var(--text-muted);margin-top:1px">' + (enabled ? '🟢 ' + MODE_LABELS[mode] : '⚫ ปิดอยู่') + '</div>' +
        '</div>' +
        '<label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;flex-shrink:0;margin-left:8px">' +
        '<input type="checkbox" ' + (enabled ? 'checked' : '') + ' onchange="toggleAutoReplyPage(\'' + pageId + '\',this.checked)" style="opacity:0;width:0;height:0">' +
        '<span style="position:absolute;inset:0;background:' + (enabled ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)') + ';border-radius:24px;transition:all 0.3s;border:1px solid var(--border)"></span>' +
        '<span style="position:absolute;top:2px;left:' + (enabled ? '22px' : '2px') + ';width:20px;height:20px;border-radius:50%;background:' + (enabled ? 'var(--success)' : 'var(--text-muted)') + ';transition:all 0.3s"></span>' +
        '</label></div>' +
        (enabled ? '<div style="margin-top:6px"><select onchange="changeAutoReplyMode(\'' + pageId + '\',this.value)" style="width:100%;padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.72rem;font-family:inherit;color-scheme:dark">' +
        ['all', 'random', 'question_only', 'off'].map(function (m) { return '<option value="' + m + '"' + (m === mode ? ' selected' : '') + '>' + MODE_LABELS[m] + '</option>'; }).join('') +
        '</select></div>' : '') +
        '</div>';
    }).join('');
    loadAutoReplyHistory();
  } catch (e) { el.innerHTML = '<div style="color:var(--danger);font-size:0.72rem">โหลดไม่สำเร็จ</div>'; }
}

export async function toggleAutoReplyPage(pageId, enabled) {
  try {
    await fetch('/api/auto-reply/settings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: pageId, enabled: enabled, reply_mode: enabled ? 'all' : 'off' }) });
    showNotify(enabled ? 'เปิด Auto Reply สำเร็จ!' : 'ปิด Auto Reply แล้ว');
    loadAutoReplySettings();
  } catch (e) { }
}

export async function changeAutoReplyMode(pageId, mode) {
  try {
    await fetch('/api/auto-reply/settings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: pageId, enabled: mode !== 'off', reply_mode: mode }) });
    showNotify('เปลี่ยน mode เป็น ' + MODE_LABELS[mode]);
    loadAutoReplySettings();
  } catch (e) { }
}

export async function loadAutoReplyHistory() {
  var el = document.getElementById('autoReplyHistoryList');
  if (!state.selectedPage) { el.innerHTML = '<div style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:16px">กรุณาเลือกเพจก่อน</div>'; return; }
  try {
    var datePicker = document.getElementById('arDateFilter');
    var dateVal = datePicker ? datePicker.value : '';
    var url = '/api/auto-reply/history?limit=50' + (dateVal ? '&date=' + dateVal : '');
    var r = await fetch(url, { credentials: 'same-origin' });
    var d = await r.json();
    var replies = (d.replies || []).filter(function (r) { return r.page_id === state.selectedPage.id; });
    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);
    var weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    var replied = replies.filter(function (r) { return r.status === 'replied'; });
    var totalEl = document.getElementById('arStatTotal');
    var todayEl = document.getElementById('arStatToday');
    var weekEl = document.getElementById('arStatWeek');
    if (totalEl) totalEl.textContent = replied.length;
    if (todayEl) todayEl.textContent = replied.filter(function (r) { return (r.created_at || '').startsWith(todayStr); }).length;
    if (weekEl) weekEl.textContent = replied.filter(function (r) { return (r.created_at || '') >= weekAgo; }).length;
    if (!replies.length) { el.innerHTML = '<div style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:16px">ยังไม่มีประวัติ</div>'; return; }
    var TYPE_ICONS = { question: '❓', praise: '👍', experience: '💬', disagree: '🤔', tag_friend: '👥', emoji: '😊', spam: '🚫', unclear: '❔' };
    var TYPE_LABELS = { question: 'ถามข้อมูล', praise: 'ชม', experience: 'แชร์ประสบการณ์', disagree: 'ไม่เห็นด้วย', tag_friend: 'แท็กเพื่อน', emoji: 'emoji', spam: 'spam', unclear: 'ไม่ชัดเจน' };
    var dateGroups = {};
    var dateOrder = [];
    replies.forEach(function (r) {
      var commentDate = (r.created_at || '').slice(0, 10);
      if (!dateGroups[commentDate]) { dateGroups[commentDate] = { posts: {}, postOrder: [] }; dateOrder.push(commentDate); }
      var pid = r.post_id || 'unknown';
      var dg = dateGroups[commentDate];
      if (!dg.posts[pid]) { dg.posts[pid] = { post_id: pid, post_message: r.post_message || '', post_date: r.post_created_at || '', items: [] }; dg.postOrder.push(pid); }
      dg.posts[pid].items.push(r);
    });
    var gIdx = 0;
    el.innerHTML = dateOrder.map(function (dateKey, di) {
      var dg = dateGroups[dateKey];
      var dateLabel = new Date(dateKey + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
      var totalComments = dg.postOrder.reduce(function (s, pid) { return s + dg.posts[pid].items.length; }, 0);
      var dateId = 'arDate' + di;
      return '<div style="margin-bottom:10px">' +
        '<div onclick="var c=document.getElementById(\'' + dateId + '\');var a=this.querySelector(\'.ar-arrow\');if(c.style.display===\'none\'){c.style.display=\'block\';a.textContent=\'▼\'}else{c.style.display=\'none\';a.textContent=\'▶\'}" style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;border-bottom:1px solid var(--border)">' +
        '<span class="ar-arrow" style="font-size:0.6rem;color:var(--text-muted)">▼</span>' +
        '<span style="font-size:0.82rem;font-weight:700;color:var(--text)">📅 ' + dateLabel + '</span>' +
        '<span style="font-size:0.62rem;color:var(--text-muted)">' + totalComments + ' คอมเม้น · ' + dg.postOrder.length + ' โพส</span></div>' +
        '<div id="' + dateId + '">' +
        dg.postOrder.map(function (pid) {
          var g = dg.posts[pid];
          var postTitle = g.post_message ? insEsc(g.post_message.slice(0, 50)) + (g.post_message.length > 50 ? '...' : '') : 'โพส';
          var postDateStr = g.post_date ? new Date(g.post_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
          var fbLink = pid !== 'unknown' ? '<a href="https://facebook.com/' + pid + '" target="_blank" rel="noopener" style="font-size:0.62rem;color:var(--accent);text-decoration:none;flex-shrink:0" onclick="event.stopPropagation()">🔗</a>' : '';
          var groupId = 'arGroup' + (gIdx++);
          return '<div style="margin:6px 0 6px 12px;border:1px solid var(--border);border-radius:8px;overflow:hidden">' +
            '<div onclick="var c=document.getElementById(\'' + groupId + '\');var a=this.querySelector(\'.ar-arrow\');if(c.style.display===\'none\'){c.style.display=\'block\';a.textContent=\'▼\'}else{c.style.display=\'none\';a.textContent=\'▶\'}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:rgba(255,255,255,0.02);cursor:pointer">' +
            '<div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1"><span class="ar-arrow" style="font-size:0.55rem;color:var(--text-muted);flex-shrink:0">▼</span><span style="font-size:0.72rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📝 ' + postTitle + '</span><span style="font-size:0.6rem;color:var(--text-muted);flex-shrink:0">' + g.items.length + ' คอมเม้น' + (postDateStr ? ' | 📅 ' + postDateStr : '') + '</span></div>' +
            fbLink + '</div>' +
            '<div id="' + groupId + '" style="padding:0 10px 6px">' +
            g.items.map(function (r) {
              var icon = TYPE_ICONS[r.comment_type] || '💬';
              var label = TYPE_LABELS[r.comment_type] || r.comment_type;
              var time = new Date(r.created_at).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
              var statusBadge = r.status === 'replied' ? '<span style="color:var(--success);font-size:0.62rem">✅</span>' : r.status === 'hidden' ? '<span style="color:var(--warning);font-size:0.62rem">🚫</span>' : '<span style="color:var(--danger);font-size:0.62rem">❌</span>';
              return '<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.75rem">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">' +
                '<span style="font-size:0.66rem;color:var(--text-muted)">' + icon + ' ' + label + ' — ' + (r.comment_from || 'ไม่ทราบ') + '</span>' +
                '<span style="font-size:0.62rem;color:var(--text-muted)">' + time + ' ' + statusBadge + '</span></div>' +
                '<div style="color:var(--text-secondary);font-size:0.7rem;margin-bottom:2px">💭 ' + insEsc((r.comment_text || '').slice(0, 100)) + '</div>' +
                (r.reply_text ? '<div style="color:var(--text);font-size:0.7rem;padding:3px 8px;background:rgba(79,110,247,0.06);border-radius:6px;margin-top:2px">→ ' + insEsc(r.reply_text.slice(0, 150)) + '</div>' : '') +
                '</div>';
            }).join('') +
            '</div></div>';
        }).join('') +
        '</div></div>';
    }).join('');
  } catch (e) { el.innerHTML = '<div style="color:var(--danger);font-size:0.72rem">โหลดไม่สำเร็จ</div>'; }
}
