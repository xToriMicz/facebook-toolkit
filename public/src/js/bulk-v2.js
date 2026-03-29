// Bulk Generate v2 — plan-based, cron generate, calendar preview
import state from './state.js';
import { toast, insEsc, showNotify } from './utils.js';

var STATUS_ICONS = { pending: '⏳', generating: '🤖', generated: '✅', posting: '📤', posted: '✅', failed: '❌' };
var STATUS_LABELS = { pending: 'รอสร้าง', generating: 'กำลังสร้าง', generated: 'สร้างแล้ว', posting: 'กำลังโพส', posted: 'โพสแล้ว', failed: 'ล้มเหลว' };
var TONE_LABELS = { general: '📝 ทั่วไป', professional: '📋 ให้ความรู้' };
var FREQ_LABELS = { auto: '🤖 Auto (peak hours)', '1perday': '📅 วันละ 1', many: '📊 หลายครั้ง/วัน', interval: '⏰ ทุก X ชม.' };

// --- Plan List ---
export async function loadBulkPlans() {
  var el = document.getElementById('bulkPlanList');
  if (!el) return;
  if (!state.selectedPage) { el.innerHTML = '<div class="empty-state">กรุณาเลือกเพจก่อน</div>'; return; }
  try {
    var r = await fetch('/api/bulk-plans?page_id=' + state.selectedPage.id, { credentials: 'same-origin' });
    var d = await r.json();
    var plans = d.plans || [];
    if (!plans.length) { el.innerHTML = '<div class="empty-state">ยังไม่มีแผนโพส — กด "+ สร้างแผนใหม่"</div>'; return; }
    el.innerHTML = plans.map(function (p) {
      var progress = p.total_items > 0 ? Math.round((p.posted / p.total_items) * 100) : 0;
      var statusColor = p.status === 'active' ? 'var(--success)' : p.status === 'paused' ? 'var(--warning)' : 'var(--text-muted)';
      var dateRange = new Date(p.date_start).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' - ' + new Date(p.date_end).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
      return '<div style="padding:12px;background:var(--bg-input);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;cursor:pointer" onclick="viewBulkPlan(' + p.id + ')">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div style="min-width:0;flex:1">' +
        '<div style="font-size:0.85rem;font-weight:600;color:var(--text)">' + insEsc(p.name || 'แผนโพส #' + p.id) + '</div>' +
        '<div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px">📅 ' + dateRange + ' · ' + p.total_items + ' โพส</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
        '<div style="font-size:0.72rem;color:' + statusColor + ';font-weight:600">' + (p.status === 'active' ? '🟢 กำลังทำงาน' : p.status === 'paused' ? '⏸️ หยุดชั่วคราว' : '✅ เสร็จ') + '</div>' +
        '<div style="font-size:0.65rem;color:var(--text-muted)">' + p.posted + '/' + p.total_items + ' (' + progress + '%)</div>' +
        '</div></div>' +
        '<div style="margin-top:8px;height:4px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden"><div style="height:100%;width:' + progress + '%;background:var(--accent);border-radius:2px;transition:width 0.3s"></div></div>' +
        '</div>';
    }).join('');
  } catch (e) { el.innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ</div>'; }
}

// --- View Plan Details ---
export async function viewBulkPlan(planId) {
  var el = document.getElementById('bulkPlanDetail');
  if (!el) return;
  document.getElementById('bulkPlanList').style.display = 'none';
  document.getElementById('bulkCreateForm').style.display = 'none';
  el.style.display = '';
  try {
    var r = await fetch('/api/bulk-plans/' + planId, { credentials: 'same-origin' });
    var d = await r.json();
    if (!d.plan) { el.innerHTML = '<div class="empty-state">ไม่พบแผน</div>'; return; }
    var plan = d.plan;
    var items = d.items || [];
    var isPaused = plan.status === 'paused';

    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">' +
      '<button onclick="backToPlanList()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.82rem;padding:0">← กลับ</button>' +
      '<div style="display:flex;gap:6px">' +
      '<button onclick="togglePlanPause(' + plan.id + ',' + (isPaused ? 'false' : 'true') + ')" style="padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:none;color:' + (isPaused ? 'var(--success)' : 'var(--warning)') + ';font-size:0.72rem;cursor:pointer">' + (isPaused ? '▶️ เริ่มต่อ' : '⏸️ หยุด') + '</button>' +
      '</div></div>' +
      '<div style="font-size:0.95rem;font-weight:700;color:var(--text);margin-bottom:4px">' + insEsc(plan.name || 'แผนโพส #' + plan.id) + '</div>' +
      '<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:12px">' + plan.generated + ' สร้างแล้ว · ' + plan.posted + ' โพสแล้ว · ' + items.length + ' ทั้งหมด</div>' +
      // Calendar mini-preview
      renderPlanCalendar(items) +
      // Items list
      '<div style="margin-top:12px">' +
      items.map(function (item) {
        var icon = STATUS_ICONS[item.status] || '⏳';
        var label = STATUS_LABELS[item.status] || item.status;
        var time = new Date(item.scheduled_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
        var canEdit = item.status === 'pending' || item.status === 'generated';
        return '<div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--bg-input)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div style="min-width:0;flex:1">' +
          '<div style="font-size:0.78rem;color:var(--accent);font-weight:600">' + insEsc(item.keyword) + (item.angle ? ' · ' + insEsc(item.angle) : '') + '</div>' +
          '<div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">' + icon + ' ' + label + ' · 📅 ' + time + '</div>' +
          '</div>' +
          (canEdit ? '<div style="display:flex;gap:4px;flex-shrink:0">' +
          (item.status === 'generated' ? '<button onclick="regeneratePlanItem(' + item.id + ')" style="padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:none;color:var(--text-muted);font-size:0.65rem;cursor:pointer">🔄</button>' : '') +
          '<button onclick="deletePlanItem(' + item.id + ',' + plan.id + ')" style="padding:3px 8px;border:1px solid rgba(239,68,68,0.3);border-radius:4px;background:none;color:#ef4444;font-size:0.65rem;cursor:pointer">✕</button>' +
          '</div>' : '') +
          '</div>' +
          (item.message ? '<div style="font-size:0.72rem;color:var(--text-secondary);margin-top:6px;padding:6px 8px;background:var(--bg);border-radius:6px;max-height:60px;overflow:hidden">' + insEsc(item.message.slice(0, 120)) + '</div>' : '') +
          '</div>';
      }).join('') +
      '</div>';
  } catch (e) { el.innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ</div>'; }
}

function renderPlanCalendar(items) {
  if (!items.length) return '';
  var days = {};
  items.forEach(function (item) {
    var day = (item.scheduled_at || '').slice(0, 10);
    if (!days[day]) days[day] = { total: 0, posted: 0, generated: 0, pending: 0 };
    days[day].total++;
    if (item.status === 'posted') days[day].posted++;
    else if (item.status === 'generated') days[day].generated++;
    else days[day].pending++;
  });
  var dayKeys = Object.keys(days).sort();
  return '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:8px 0">' +
    dayKeys.map(function (d) {
      var info = days[d];
      var color = info.posted === info.total ? 'var(--success)' : info.generated > 0 ? 'var(--accent)' : 'var(--text-muted)';
      var label = new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric' });
      return '<div style="width:36px;height:36px;border-radius:8px;background:' + color + '15;border:1px solid ' + color + '30;display:flex;flex-direction:column;align-items:center;justify-content:center" title="' + d + ': ' + info.total + ' โพส">' +
        '<div style="font-size:0.65rem;font-weight:600;color:' + color + '">' + label + '</div>' +
        '<div style="font-size:0.5rem;color:var(--text-muted)">' + info.total + '</div></div>';
    }).join('') +
    '</div>';
}

// --- Create Plan ---
export function showCreatePlan() {
  document.getElementById('bulkPlanList').style.display = 'none';
  document.getElementById('bulkPlanDetail').style.display = 'none';
  document.getElementById('bulkCreateForm').style.display = '';
}

export function backToPlanList() {
  document.getElementById('bulkPlanList').style.display = '';
  document.getElementById('bulkPlanDetail').style.display = 'none';
  document.getElementById('bulkCreateForm').style.display = 'none';
  loadBulkPlans();
}

export async function createBulkPlan() {
  if (!state.selectedPage) { toast('err', 'กรุณาเลือกเพจก่อน'); return; }
  var name = document.getElementById('bpName').value.trim();
  var keywords = document.getElementById('bpKeywords').value.trim().split('\n').filter(Boolean).slice(0, 100);
  if (!keywords.length) { toast('err', 'ใส่ keyword อย่างน้อย 1 อัน'); return; }
  var dateStart = document.getElementById('bpDateStart').value;
  var dateEnd = document.getElementById('bpDateEnd').value;
  if (!dateStart || !dateEnd) { toast('err', 'กรุณาเลือกวันเริ่ม-จบ'); return; }
  var timeStart = document.getElementById('bpTimeStart').value || '08:00';
  var timeEnd = document.getElementById('bpTimeEnd').value || '20:00';
  var tone = document.getElementById('bpTone').value || 'general';
  var freq = document.querySelector('input[name="bpFreq"]:checked');
  var frequency = freq ? freq.value : 'auto';

  // Calculate schedule for each keyword
  var items = calculatePlanSchedule(keywords, dateStart, dateEnd, timeStart, timeEnd, frequency);

  var btn = document.getElementById('bpCreateBtn');
  btn.disabled = true; btn.textContent = '⏳ กำลังสร้าง...';
  try {
    var r = await fetch('/api/bulk-plans', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_id: state.selectedPage.id, name: name || null, tone, post_type: 'text', date_start: dateStart, date_end: dateEnd, time_start: timeStart, time_end: timeEnd, frequency, items })
    });
    var d = await r.json();
    if (d.ok) {
      showNotify('สร้างแผน ' + items.length + ' โพสสำเร็จ!');
      backToPlanList();
    } else { toast('err', d.error || 'สร้างไม่สำเร็จ'); }
  } catch (e) { toast('err', 'Error: ' + e.message); }
  btn.disabled = false; btn.textContent = '✅ สร้างแผน';
}

function calculatePlanSchedule(keywords, dateStart, dateEnd, timeStart, timeEnd, frequency) {
  var items = [];
  var start = new Date(dateStart + 'T' + timeStart + ':00');
  var end = new Date(dateEnd + 'T' + timeEnd + ':00');
  var peakHours = [7, 8, 9, 11, 12, 13, 17, 18, 19, 20];
  var startH = parseInt(timeStart.split(':')[0]);
  var endH = parseInt(timeEnd.split(':')[0]);
  var usablePeaks = peakHours.filter(function (h) { return h >= startH && h < endH; });
  if (!usablePeaks.length) usablePeaks = [startH];

  var kwIdx = 0;
  var curDate = new Date(start);
  while (curDate <= end && kwIdx < keywords.length) {
    if (frequency === 'auto') {
      for (var p = 0; p < usablePeaks.length && kwIdx < keywords.length; p++) {
        var d = new Date(curDate);
        d.setHours(usablePeaks[p], Math.floor(Math.random() * 6) * 10, 0, 0);
        items.push({ keyword: keywords[kwIdx], scheduled_at: d.toISOString() });
        kwIdx++;
      }
    } else {
      var d = new Date(curDate);
      d.setHours(startH + Math.floor(Math.random() * (endH - startH)), Math.floor(Math.random() * 6) * 10, 0, 0);
      items.push({ keyword: keywords[kwIdx], scheduled_at: d.toISOString() });
      kwIdx++;
    }
    curDate.setDate(curDate.getDate() + 1);
  }
  return items;
}

// --- Actions ---
export async function togglePlanPause(planId, pause) {
  try {
    await fetch('/api/bulk-plans/' + planId, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: pause ? 'paused' : 'active' }) });
    showNotify(pause ? 'หยุดแผนชั่วคราว' : 'เริ่มแผนต่อ');
    viewBulkPlan(planId);
  } catch (e) { }
}

export async function deletePlanItem(itemId, planId) {
  try {
    await fetch('/api/bulk-plans/items/' + itemId, { method: 'DELETE', credentials: 'same-origin' });
    viewBulkPlan(planId);
  } catch (e) { }
}

export async function regeneratePlanItem(itemId) {
  try {
    await fetch('/api/bulk-plans/items/' + itemId, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pending' }) });
    showNotify('จะสร้างใหม่ใน cron ถัดไป');
  } catch (e) { }
}

export function initBulkV2() {
  loadBulkPlans();
  // Default dates
  var tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
  var end = new Date(); end.setDate(end.getDate() + 31);
  var ds = document.getElementById('bpDateStart');
  var de = document.getElementById('bpDateEnd');
  if (ds) ds.value = tmr.toISOString().split('T')[0];
  if (de) de.value = end.toISOString().split('T')[0];
}
