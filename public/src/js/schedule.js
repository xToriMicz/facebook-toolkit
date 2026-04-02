// Schedule, calendar, logs, trends, insights, challenges, tickets, AI settings, drafts, API keys
import state from './state.js';
import { toast, insEsc, showNotify, showProgress, hideProgress } from './utils.js';

export function setTrendView(mode) {
  var grid = document.getElementById('trendList');
  document.getElementById('trendViewGrid').classList.toggle('active', mode === 'grid');
  document.getElementById('trendViewList').classList.toggle('active', mode === 'list');
  if (mode === 'list') grid.classList.add('trend-list-mode');
  else grid.classList.remove('trend-list-mode');
}

var SHOPEE_MOCK = [
  {name:"เสื้อยืดโอเวอร์ไซส์ Unisex",price:199,price_min:159,price_max:299,image:"",rating:4.8,sold:12500,category:"fashion",url:"#"},
  {name:"หูฟัง Bluetooth TWS กันน้ำ IPX5",price:390,price_min:290,price_max:590,image:"",rating:4.6,sold:8700,category:"electronics",url:"#"},
  {name:"เซรั่มวิตามินซี Bright Skin 30ml",price:259,price_min:199,price_max:359,image:"",rating:4.9,sold:25000,category:"beauty",url:"#"},
  {name:"ชั้นวางของสแตนเลส 4 ชั้น",price:450,price_min:350,price_max:650,image:"",rating:4.5,sold:3200,category:"home",url:"#"},
  {name:"วิตามินซี 1000mg 60 เม็ด",price:190,price_min:150,price_max:290,image:"",rating:4.7,sold:18000,category:"health",url:"#"},
  {name:"กางเกงขาสั้น ผ้าร่ม ระบายอากาศ",price:179,price_min:129,price_max:249,image:"",rating:4.4,sold:9300,category:"fashion",url:"#"},
  {name:"สายชาร์จ USB-C 100W ถัก Nylon",price:89,price_min:59,price_max:159,image:"",rating:4.8,sold:42000,category:"electronics",url:"#"},
  {name:"แผ่นมาส์กหน้า Collagen 10 แผ่น",price:99,price_min:79,price_max:149,image:"",rating:4.6,sold:31000,category:"beauty",url:"#"},
  {name:"ไฟ LED Strip RGB รีโมท 5 เมตร",price:199,price_min:149,price_max:349,image:"",rating:4.3,sold:6100,category:"home",url:"#"},
  {name:"โปรตีนเวย์ Isolate 2lb ช็อกโกแลต",price:890,price_min:750,price_max:1290,image:"",rating:4.7,sold:4500,category:"health",url:"#"}
];

export async function loadTrends() {
  var el = document.getElementById('trendList');
  el.innerHTML = '<div class="empty-state" style="grid-column:1/-1">กำลังโหลด...</div>';
  var products = [];
  try {
    var r = await fetch('/api/shopee-trends', { credentials: 'same-origin' });
    var d = await r.json();
    products = d.products || d.items || [];
  } catch(e) { /* fallback to mock */ }
  if (!products.length) products = SHOPEE_MOCK;
  var countEl = document.getElementById('trendCount');
  if (countEl) countEl.textContent = '(' + products.length + ' สินค้า)';
  el.innerHTML = products.map(function(p) {
    var price = p.price_min && p.price_max && p.price_min !== p.price_max
      ? '฿' + Number(p.price_min).toLocaleString() + '-' + Number(p.price_max).toLocaleString()
      : '฿' + Number(p.price || p.price_min || 0).toLocaleString();
    var stars = '';
    var rating = p.rating || 0;
    for (var s = 0; s < 5; s++) stars += s < Math.round(rating) ? '★' : '☆';
    var sold = p.sold || 0;
    var soldStr = sold >= 1000 ? (sold/1000).toFixed(1) + 'k' : String(sold);
    var cat = p.category || 'general';
    var img = p.image || p.thumbnail || '';
    var url = p.url || p.link || '#';
    var name = insEsc((p.name || p.title || '').substring(0, 60));
    return '<div class="trend-card" data-cat="' + insEsc(cat) + '">' +
      (img ? '<img class="trend-card-img" src="' + insEsc(img) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '<div class="trend-card-img" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:2rem">🛒</div>') +
      '<div class="trend-card-body">' +
        '<div class="trend-card-name">' + name + '</div>' +
        '<div class="trend-card-price">' + price + '</div>' +
        '<div class="trend-card-meta">' +
          '<span class="trend-card-stars">' + stars + ' ' + rating.toFixed(1) + '</span>' +
          '<span>' + soldStr + ' ขายแล้ว</span>' +
        '</div>' +
      '</div>' +
      '<a href="' + insEsc(url) + '" target="_blank" rel="noopener" class="trend-card-btn">ดูสินค้า →</a>' +
    '</div>';
  }).join('');
}

// Schedule
// 24h time dropdowns
export function initScheduleTime() {
  var hSel=document.getElementById('schedTimeHour'), mSel=document.getElementById('schedTimeMin');
  for(var h=0;h<24;h++) hSel.innerHTML+='<option value="'+String(h).padStart(2,'0')+'">'+String(h).padStart(2,'0')+'</option>';
  for(var m=0;m<60;m+=5) mSel.innerHTML+='<option value="'+String(m).padStart(2,'0')+'">'+String(m).padStart(2,'0')+'</option>';
  function syncTime(){document.getElementById('schedTime').value=hSel.value+':'+mSel.value;}
  hSel.onchange=syncTime; mSel.onchange=syncTime;
  hSel.value='09'; mSel.value='00'; syncTime();
}
export function setSchedTime(timeStr){
  if(!timeStr)return;
  var p=timeStr.split(':');
  var h=document.getElementById('schedTimeHour'), m=document.getElementById('schedTimeMin');
  if(h&&p[0])h.value=p[0];
  if(m&&p[1]){var mv=Math.round(parseInt(p[1])/5)*5;m.value=String(mv%60).padStart(2,'0');}
  document.getElementById('schedTime').value=timeStr;
}
export function toggleSchedule() {
  const el = document.getElementById('schedulePicker');
  const show = el.style.display === 'none';
  el.style.display = show ? '' : 'none';
  if (show) {
    // Default: tomorrow 9:00
    const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
    document.getElementById('schedDate').value = tmr.toISOString().split('T')[0];
    setSchedTime('09:00');
    loadScheduled();
  }
}

export async function submitScheduled() {
  const msg = document.getElementById('message').value.trim();
  if (!msg && !state.uploadedImageUrl) { toast('err','กรุณาเขียนข้อความหรือเลือกรูป'); return; }
  if (!state.selectedPage) { toast('err','กรุณาเลือกเพจก่อน'); return; }
  const date = document.getElementById('schedDate').value;
  const time = document.getElementById('schedTime').value;
  if (!date || !time) { toast('err','กรุณาเลือกวันและเวลา'); return; }
  const scheduledAt = new Date(date + 'T' + time + ':00').toISOString();
  try {
    const imageUrls = state.uploadedImages.filter(i=>i.url).map(i=>i.url);
    const body = imageUrls.length > 1
      ? { message:msg, image_urls:imageUrls, page_id:state.selectedPage.id, scheduled_at:scheduledAt }
      : { message:msg, image_url:imageUrls[0]||null, page_id:state.selectedPage.id, scheduled_at:scheduledAt };
    const r = await fetch('/api/post/schedule', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify(body) });
    const d = await r.json();
    if (d.ok) { toast('ok','ตั้งเวลาเรียบร้อย!'); showNotify('ตั้งเวลาโพสสำเร็จ!'); document.getElementById('message').value=''; document.getElementById('charCount').textContent='0'; document.getElementById('imagePreview').innerHTML=''; state.uploadedImages=[]; state.uploadedImageUrl=null; state.uploadedImageData=null; var dz=document.getElementById('dropZone'); dz.classList.remove('has-file'); dz.textContent='📷 คลิกเพื่อเลือกรูปหรือวิดีโอ หรือลากไฟล์มาวาง'; loadScheduled(); }
    else toast('err', d.error || 'ตั้งเวลาไม่สำเร็จ');
  } catch(e) { toast('err','เกิดข้อผิดพลาด'); }
}

export async function loadScheduled() {
  const el = document.getElementById('scheduledList');
  try {
    const pid = state.selectedPage ? state.selectedPage.id : '';
    const r = await fetch('/api/posts/scheduled' + (pid ? '?page_id=' + pid : ''), { credentials:'same-origin' });
    const d = await r.json();
    const items = d.scheduled || d.posts || [];
    if (!items.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px;font-weight:500">📅 โพสที่ตั้งเวลาไว้</div>' +
      items.map(function(p) {
        var dt = new Date(p.scheduled_at).toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false });
        var preview = insEsc((p.message || '').substring(0, 50));
        var full = insEsc(p.message || '');
        var imgUrls = p.image_urls ? (typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : p.image_urls) : (p.image_url ? [p.image_url] : []);
        var imgCount = imgUrls.length;
        var thumb = imgCount > 0 ? '<div style="position:relative;flex-shrink:0"><img src="' + insEsc(imgUrls[0]) + '" style="width:40px;height:40px;border-radius:6px;object-fit:cover;border:1px solid var(--border)" onerror="this.style.display=\'none\'">' + (imgCount > 1 ? '<span style="position:absolute;bottom:-2px;right:-2px;background:#3b82f6;color:#fff;font-size:0.55rem;padding:1px 4px;border-radius:4px;font-weight:600">+' + (imgCount-1) + '</span>' : '') + '</div>' : '';
        return '<div style="padding:8px 0;border-top:1px solid var(--border);cursor:pointer" onclick="var f=this.querySelector(\'.sched-full\');f.style.display=f.style.display===\'block\'?\'none\':\'block\'">' +
          '<div style="display:flex;align-items:center;gap:8px;font-size:0.8rem">' + thumb + (p.page_name ? (p.page_picture ? '<img src="' + insEsc(p.page_picture) + '" style="width:14px;height:14px;border-radius:50%;object-fit:cover">' : '') + '<span style="color:#3b82f6;font-size:0.72rem;font-weight:500">' + insEsc(p.page_name) + '</span>' : '') + '<span style="color:var(--warning)">⏰ ' + dt + '</span><span style="color:var(--text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + preview + '</span></div>' +
          '<div class="sched-full" style="display:none;font-size:0.75rem;color:var(--text-secondary);white-space:pre-wrap;line-height:1.5;margin-top:6px;padding:6px 8px;background:var(--bg-input);border-radius:6px">' + full + '</div>' +
        '</div>';
      }).join('');
  } catch { el.innerHTML = ''; }
}

// Log state in state.js
// let allLogs = [];
// let currentLogFilter = 'all';
const LOG_ICONS = { login:'🔑', logout:'🔴', post_created:'📝', post_scheduled:'⏰', draft_saved:'💾', ai_write:'🤖', page_switched:'📄', settings_changed:'⚙️', auto_reply:'💬', auto_hide_spam:'🚫' };
const LOG_LABELS = { login:'เข้าสู่ระบบ', logout:'ออกจากระบบ', post_created:'โพสลงเพจ', post_scheduled:'ตั้งเวลาโพส', draft_saved:'บันทึกแบบร่าง', ai_write:'AI เขียน', page_switched:'เปลี่ยนเพจ', settings_changed:'เปลี่ยนการตั้งค่า', auto_reply:'AI ตอบคอมเม้น', auto_hide_spam:'ซ่อน Spam' };
const LOG_CSS = { login:'login', logout:'login', post_created:'post', post_scheduled:'schedule', draft_saved:'settings', ai_write:'ai', page_switched:'settings', settings_changed:'settings', auto_reply:'ai', auto_hide_spam:'settings' };

export async function loadLogs() {
  const el = document.getElementById('logList');
  try {
    const pid = state.selectedPage ? state.selectedPage.id : '';
    const r = await fetch('/api/activity' + (pid ? '?page_id=' + pid : ''), { credentials:'same-origin' });
    const d = await r.json();
    state.allLogs = d.activities || [];
    updateLogStats();
    renderLogs('all');
  } catch { el.innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ</div>'; }
}

export function filterLogs(type, btn) {
  if (btn) { document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
  if (type !== null) state.currentLogFilter = type;
  renderLogs(state.currentLogFilter);
}

export function updateLogStats() {
  document.getElementById('logStatTotal').textContent = state.allLogs.length;
  document.getElementById('logStatPosts').textContent = state.allLogs.filter(l=>l.action==='post_created'||l.action==='posted').length;
  document.getElementById('logStatAI').textContent = state.allLogs.filter(l=>l.action==='ai_write'||l.action==='auto_reply').length;
  document.getElementById('logStatSchedule').textContent = state.allLogs.filter(l=>l.action==='post_scheduled'||l.action==='scheduled').length;
}

export function renderLogs(type) {
  const el = document.getElementById('logList');
  const filterMap = { 'post_created': ['post_created','posted'], 'post_scheduled': ['post_scheduled','scheduled'], 'ai_write': ['ai_write','auto_reply'], 'auto_reply': ['auto_reply','auto_hide_spam'] };
  let logs = type === 'all' ? state.allLogs : state.allLogs.filter(l => (filterMap[type] || [type]).includes(l.action));
  const search = (document.getElementById('logSearch')||{}).value||'';
  if (search.length >= 2) { const q=search.toLowerCase(); logs=logs.filter(l=>(l.details||'').toLowerCase().includes(q)||(l.action||'').includes(q)); }
  const dateVal = (document.getElementById('logDate')||{}).value||'';
  if (dateVal) logs = logs.filter(l=>(l.created_at||'').startsWith(dateVal));
  if (!logs.length) { el.innerHTML = '<div class="empty-state">ไม่มีกิจกรรม</div>'; return; }
  el.innerHTML = logs.slice(0, 50).map(l => {
    const icon = LOG_ICONS[l.action] || '📌';
    const label = LOG_LABELS[l.action] || l.action;
    const css = LOG_CSS[l.action] || 'settings';
    const time = new Date(l.created_at).toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false });
    return '<div class="log-item"><div class="log-icon '+css+'">'+icon+'</div><div class="log-body"><div class="log-action">'+label+'</div>'+(l.details?'<div class="log-detail">'+l.details+'</div>':'')+'</div><div class="log-time">'+time+'</div></div>';
  }).join('');
}

// Engagement Chart (CSS bar chart)
export function renderEngagementChart(posts) {
  const el = document.getElementById('engagementChart');
  if (!posts || !posts.length) { el.innerHTML = '<div style="text-align:center;width:100%;color:var(--text-muted);font-size:0.8rem;padding:20px">ยังไม่มีข้อมูล</div>'; return; }
  const days = ['อา','จ','อ','พ','พฤ','ศ','ส'];
  const today = new Date();
  const weekData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayPosts = posts.filter(p => (p.created_at||p.ts||'').startsWith(dateStr));
    const likes = dayPosts.reduce((s,p) => s + (p.likes||0), 0);
    const comments = dayPosts.reduce((s,p) => s + (p.comments||0), 0);
    const shares = dayPosts.reduce((s,p) => s + (p.shares||0), 0);
    weekData.push({ day: days[d.getDay()], likes, comments, shares, total: likes+comments+shares });
  }
  const maxVal = Math.max(1, ...weekData.map(d => d.total));
  el.innerHTML = weekData.map(d => {
    const h = Math.max(4, (d.total / maxVal) * 80);
    const color = d.total > 0 ? 'var(--accent)' : 'rgba(255,255,255,0.04)';
    return '<div class="chart-bar" style="height:'+h+'px;background:'+color+'"><div class="chart-bar-val">'+(d.total||'')+'</div><div class="chart-bar-label">'+d.day+'</div></div>';
  }).join('');
}

// Calendar
let calYear, calMonth, calPosts=[], calScheduled=[];
export function calNav(dir) { calMonth+=dir; if(calMonth>11){calMonth=0;calYear++;} if(calMonth<0){calMonth=11;calYear--;} window.renderCalendar(); }
export async function renderCalendar() {
  if(!calYear){const n=new Date();calYear=n.getFullYear();calMonth=n.getMonth();}
  const months=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  document.getElementById('calMonth').textContent=months[calMonth]+' '+calYear;
  // Fetch data — filter ตามเพจที่เลือกจาก sidebar
  try{const pfv=state.selectedPage?state.selectedPage.id:'';const q=pfv?'?page_id='+pfv+'&limit=50':'?limit=50';const[p,s]=await Promise.all([fetch('/api/posts'+q,{credentials:'same-origin'}).then(r=>r.json()).catch(()=>({posts:[]})),fetch('/api/posts/scheduled'+(pfv?'?page_id='+pfv:''),{credentials:'same-origin'}).then(r=>r.json()).catch(()=>({posts:[]}))]);calPosts=p.posts||[];renderEngagementChart(calPosts);calScheduled=s.posts||[];}catch{}
  const grid=document.getElementById('calGrid');
  const days=['อา','จ','อ','พ','พฤ','ศ','ส'];
  let html=days.map(d=>'<div class="cal-day-name">'+d+'</div>').join('');
  const first=new Date(calYear,calMonth,1).getDay();
  const total=new Date(calYear,calMonth+1,0).getDate();
  const today=new Date();
  for(let i=0;i<first;i++) html+='<div class="cal-day empty"></div>';
  for(let d=1;d<=total;d++){
    const dateStr=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const dayP=calPosts.filter(p=>(p.created_at||p.ts||'').startsWith(dateStr));
    const dayS=(calScheduled||[]).filter(p=>(p.scheduled_at||'').startsWith(dateStr));
    const hasFail=dayP.some(p=>p.status==='failed')||dayS.some(p=>p.status==='failed');
    const hasOk=dayP.some(p=>p.status==='posted');
    const hasPend=dayS.some(p=>p.status==='pending');
    const isToday=today.getFullYear()===calYear&&today.getMonth()===calMonth&&today.getDate()===d;
    var dots='';if(hasFail)dots+='<span class="cal-dot failed"></span>';if(hasOk)dots+='<span class="cal-dot posted"></span>';if(hasPend)dots+='<span class="cal-dot scheduled"></span>';
    var count=dayP.length+dayS.length;
    var countBadge=count>0?'<span style="font-size:0.6rem;color:var(--text-muted)">'+count+'</span>':'';
    html+='<div class="cal-day'+(isToday?' today':'')+'" onclick="showCalDay(\''+dateStr+'\')">'+d+'<div class="cal-dots">'+dots+'</div>'+countBadge+'</div>';
  }
  grid.innerHTML=html;
  document.getElementById('calDetail').innerHTML='';
}
export function calToday(){var n=new Date();calYear=n.getFullYear();calMonth=n.getMonth();window.renderCalendar();}
export function calCreatePost(dateStr){window.switchTab('compose');setTimeout(()=>{const di=document.getElementById('schedDate');if(di)di.value=dateStr;},100);}
export function showCalDay(dateStr) {
  const posts=calPosts.filter(p=>(p.created_at||p.ts||'').startsWith(dateStr));
  const scheds=(calScheduled||[]).filter(p=>(p.scheduled_at||'').startsWith(dateStr));
  const el=document.getElementById('calDetail');
  const addBtn='<button onclick="calCreatePost(\''+dateStr+'\')" style="margin-top:8px;padding:7px 14px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.8rem;font-family:inherit">+ สร้างโพสวันนี้</button>';
  if(!posts.length&&!scheds.length){el.innerHTML='<div class="cal-day-detail"><div class="cal-day-detail-title">'+dateStr+'</div><div class="cal-detail-item" style="color:var(--text-muted)">ไม่มีโพส</div>'+addBtn+'</div>';return;}
  const si={posted:'✅',pending:'⏳',failed:'❌'};
  let html='<div class="cal-day-detail"><div class="cal-day-detail-title">'+dateStr+'</div>';
  posts.forEach(p=>{const icon=si[p.status]||'📤';const pn=p.page_name?'<span style="color:var(--accent);font-size:0.72rem">'+p.page_name+'</span> ':'';const typeIcon=p.image_url?'🖼️':p.video_url?'🎬':'📝';const fbLink=p.fb_post_id?'<a href="https://www.facebook.com/'+p.fb_post_id+'" target="_blank" rel="noopener" style="color:var(--text-primary);text-decoration:none;border-bottom:1px dashed var(--text-muted)">':'';const fbLinkEnd=p.fb_post_id?'</a>':'';const thumb=p.image_url?'<img src="'+insEsc(p.image_url)+'" style="width:32px;height:32px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:6px">':'';html+='<div class="cal-detail-item" style="display:flex;align-items:center;gap:6px">'+icon+' '+typeIcon+' '+thumb+pn+fbLink+(p.message||'').substring(0,50)+fbLinkEnd+'</div>';});
  scheds.forEach(p=>{const t=new Date(p.scheduled_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',hour12:false});const icon=si[p.status]||'⏰';const typeIcon=p.image_url?'🖼️':'📝';html+='<div class="cal-detail-item">'+icon+' '+typeIcon+' '+t+' — '+(p.message||'').substring(0,50)+'</div>';});
  html+=addBtn+'</div>';
  el.innerHTML=html;
}

// Ticket UI (Kumo polish)
export async function uploadTicketImage(file) {
  if(!file) return;
  const form = new FormData(); form.append('file', file);
  try {
    const r = await fetch('/api/upload', { method:'POST', credentials:'same-origin', body:form });
    const d = await r.json();
    if(d.ok) { document.getElementById('ticketImage').value = d.url; showNotify('แนบรูปสำเร็จ!'); }
    else { toast('err', d.error || 'อัพโหลดรูปไม่สำเร็จ'); }
  } catch(e) { toast('err','อัพโหลดรูปไม่สำเร็จ'); }
}

export async function loadTickets() {
  const el = document.getElementById('ticketList');
  try {
    const r = await fetch('/api/tickets', { credentials:'same-origin' });
    const d = await r.json();
    const tickets = d.tickets || [];
    if (!tickets.length) { el.innerHTML = '<div class="empty-state">ยังไม่มี ticket</div>'; return; }
    const TYPE_ICONS = { bug:'🐛', feature:'✨', question:'❓' };
    el.innerHTML = tickets.map(t => {
      const icon = TYPE_ICONS[t.type] || '📌';
      const status = t.status || 'open';
      const time = new Date(t.created_at).toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false });
      return '<div class="ticket-item">' +
        '<div class="ticket-type '+t.type+'">'+icon+'</div>' +
        '<div class="ticket-body">' +
          '<div class="ticket-title">'+((t.title||'').replace(/</g,'&lt;'))+'</div>' +
          '<div class="ticket-desc">'+((t.description||'').substring(0,80).replace(/</g,'&lt;'))+'</div>' +
          '<div class="ticket-meta">' +
            '<span class="ticket-status '+status+'">'+({open:'เปิด','in-progress':'กำลังแก้',closed:'ปิดแล้ว'}[status]||status)+'</span>' +
            '<span class="ticket-time">'+time+'</span>' +
            (t.issue_url ? '<a href="'+t.issue_url+'" target="_blank" class="ticket-link">GitHub →</a>' : '') +
          '</div>' +
        '</div></div>';
    }).join('');
  } catch { el.innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ</div>'; }
}

// AI Settings
const AI_MODELS = {
  anthropic: { models: ['claude-haiku-4-5','claude-sonnet-4-6','claude-opus-4-6'], endpoint: 'https://api.anthropic.com/v1' },
  openai: { models: ['gpt-4o-mini','gpt-4o','gpt-4.1'], endpoint: 'https://api.openai.com/v1' },
  google: { models: ['gemini-2.0-flash','gemini-2.5-pro'], endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
};

export function onProviderChange() {
  const provider = document.getElementById('aiProvider').value;
  const isCustom = provider === 'custom';
  const isDefault = provider === 'default';
  const show = (id, v) => { document.getElementById(id).style.display = v ? '' : 'none'; };

  show('aiModelField', !isDefault && !isCustom);
  show('aiCustomModelField', isCustom);
  show('aiKeyField', !isDefault);
  show('aiEndpointField', !isDefault);
  show('aiSettingsActions', !isDefault);

  const status = document.getElementById('aiCurrentStatus');
  if (isDefault) {
    status.style.background = 'rgba(34,197,94,0.06)';
    status.style.color = 'var(--success)';
    status.style.borderColor = 'rgba(34,197,94,0.12)';
    status.textContent = '🟢 กำลังใช้ AI ของระบบ (ฟรี)';
  } else {
    status.style.background = 'rgba(79,110,247,0.06)';
    status.style.color = 'var(--accent)';
    status.style.borderColor = 'rgba(79,110,247,0.12)';
    status.textContent = '🔵 ใช้ API Key ของคุณ — ' + (isCustom ? 'Custom' : provider.charAt(0).toUpperCase() + provider.slice(1));
  }

  if (!isDefault && !isCustom && AI_MODELS[provider]) {
    const sel = document.getElementById('aiModel');
    sel.innerHTML = AI_MODELS[provider].models.map(m => '<option value="'+m+'">'+m+'</option>').join('');
    document.getElementById('aiEndpoint').value = AI_MODELS[provider].endpoint;
  }
}

export async function testAiKey() {
  const btn = document.getElementById('aiTestBtn');
  btn.disabled = true; btn.textContent = '⏳ กำลังทดสอบ...';
  const key = document.getElementById('aiApiKey').value;
  const provider = document.getElementById('aiProvider').value;
  if (!key) { aiToast('err','กรุณาใส่ API Key'); btn.disabled=false; btn.textContent='🔍 ทดสอบ'; return; }
  try {
    const r = await fetch('/api/ai/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify({ provider, api_key:key, model: provider==='custom' ? document.getElementById('aiCustomModel').value : document.getElementById('aiModel').value, endpoint: document.getElementById('aiEndpoint').value }) });
    const d = await r.json();
    if (d.ok) { aiToast('ok','API Key ใช้ได้!'); showNotify('ทดสอบ API Key สำเร็จ!'); }
    else aiToast('err', d.error || 'ทดสอบไม่สำเร็จ');
  } catch(e) { aiToast('err','เกิดข้อผิดพลาด: '+e.message); }
  btn.disabled=false; btn.textContent='🔍 ทดสอบ';
}

export async function saveAiSettings() {
  const provider = document.getElementById('aiProvider').value;
  const body = { provider };
  if (provider !== 'default') {
    body.api_key = document.getElementById('aiApiKey').value;
    body.endpoint = document.getElementById('aiEndpoint').value;
    body.model = provider === 'custom' ? document.getElementById('aiCustomModel').value : document.getElementById('aiModel').value;
  }
  try {
    const r = await fetch('/api/ai-settings', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify(body) });
    const d = await r.json();
    if (d.ok) { aiToast('ok','บันทึกแล้ว!'); showNotify('บันทึกการตั้งค่า AI สำเร็จ!'); }
    else aiToast('err','บันทึกไม่สำเร็จ');
  } catch(e) { aiToast('err','เกิดข้อผิดพลาด'); }
}

export function aiToast(type,msg) { const el=document.getElementById('aiSettingsStatus'); el.className='toast '+type; el.textContent=msg; setTimeout(()=>{el.className='toast';},5000); }

// Load AI settings on tab open
export function loadAiSettings() {
  fetch('/api/ai-settings',{credentials:'same-origin'}).then(r=>r.json()).then(d=>{
    if(d.provider && d.provider !== 'default') {
      document.getElementById('aiProvider').value = d.provider;
      onProviderChange();
      if(d.model) {
        if(d.provider === 'custom') document.getElementById('aiCustomModel').value = d.model;
        else document.getElementById('aiModel').value = d.model;
      }
      if(d.endpoint) document.getElementById('aiEndpoint').value = d.endpoint;
    }
  }).catch(()=>{});
}

export async function loadSchedule() {
  const list = document.getElementById('scheduleList');
  try {
    const pid = state.selectedPage ? state.selectedPage.id : '';
    const res = await fetch('/api/schedule' + (pid ? '?page_id=' + pid : ''), {credentials:'same-origin'});
    const data = await res.json();
    if (!data.scheduled || data.scheduled.length === 0) {
      list.innerHTML = '<div class="empty-state">ยังไม่มีโพสที่ตั้งเวลาไว้</div>';
      return;
    }
    var pageColors = {};
    var colorPalette = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#06b6d4','#84cc16'];
    var colorIdx = 0;
    data.scheduled.forEach(function(s) {
      if (s.page_id && !pageColors[s.page_id]) {
        pageColors[s.page_id] = colorPalette[colorIdx % colorPalette.length];
        colorIdx++;
      }
    });
    list.innerHTML = data.scheduled.map(function(s) {
      var msg = insEsc(s.message || '');
      var preview = insEsc((s.message || '').slice(0, 60)) + (s.message && s.message.length > 60 ? '...' : '');
      var dt = new Date(s.scheduled_at).toLocaleString('th-TH',{hour12:false});
      var stColor = s.status === 'pending' ? 'var(--accent)' : s.status === 'posted' ? '#4caf50' : '#ef4444';
      var stText = s.status === 'pending' ? 'รอโพส' : s.status === 'posted' ? 'โพสแล้ว' : 'ล้มเหลว';
      var pgColor = pageColors[s.page_id] || 'var(--text-muted)';
      var pageBadge = s.page_name ? '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">' + (s.page_picture ? '<img src="' + insEsc(s.page_picture) + '" style="width:16px;height:16px;border-radius:50%;object-fit:cover">' : '<span style="width:16px;height:16px;border-radius:50%;background:' + pgColor + ';display:inline-block;flex-shrink:0"></span>') + '<span style="font-size:0.72rem;color:' + pgColor + ';font-weight:500">' + insEsc(s.page_name) + '</span></div>' : '';
      var hasImage = s.image_url && s.image_url.trim() !== '';
      var typeBadge = hasImage
        ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(59,130,246,0.15);color:#60a5fa;padding:1px 6px;border-radius:4px;font-size:0.68rem;font-weight:500">🖼️ รูปภาพ</span>'
        : '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(148,163,184,0.15);color:#94a3b8;padding:1px 6px;border-radius:4px;font-size:0.68rem;font-weight:500">📝 ข้อความ</span>';
      var thumbnail = hasImage
        ? '<img src="' + insEsc(s.image_url) + '" style="width:48px;height:48px;border-radius:6px;object-fit:cover;flex-shrink:0;border:1px solid var(--border)" onerror="this.style.display=\'none\'">'
        : '<div style="width:48px;height:48px;border-radius:6px;background:var(--bg-card,rgba(148,163,184,0.1));display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.2rem;border:1px solid var(--border)">📝</div>';
      var actionBtns = s.status === 'pending' ? '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">' +
        '<button onclick="event.stopPropagation();editScheduledPost(' + s.id + ',' + JSON.stringify(s.message||'').replace(/"/g,'&quot;').replace(/'/g,"\\'") + ',' + JSON.stringify(s.image_url||'').replace(/"/g,'&quot;').replace(/'/g,"\\'") + ',\'' + (s.scheduled_at||'').slice(0,10) + '\',\'' + (s.scheduled_at||'').slice(11,16) + '\')" style="background:none;border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:4px 10px;border-radius:6px;font-size:0.72rem;cursor:pointer;white-space:nowrap">✏️ แก้ไข</button>' +
        '<button onclick="event.stopPropagation();cancelSchedule(' + s.id + ')" style="background:none;border:1px solid rgba(239,68,68,0.3);color:#ef4444;padding:4px 10px;border-radius:6px;font-size:0.72rem;cursor:pointer;white-space:nowrap">ยกเลิก</button>' +
        '</div>' : '';
      return '<div style="background:var(--bg-input);border-radius:8px;margin-bottom:6px;border-left:3px solid ' + pgColor + ';border:1px solid var(--border);border-left:3px solid ' + pgColor + '">' +
        '<div style="display:flex;align-items:center;padding:10px 12px;gap:10px">' +
          thumbnail +
          '<div style="flex:1;min-width:0">' +
            pageBadge +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' + typeBadge + '</div>' +
            '<div style="font-size:0.82rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + preview + '</div>' +
            '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">📅 ' + dt + ' · <span style="color:' + stColor + '">' + stText + '</span></div>' +
          '</div>' +
          actionBtns +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) { list.innerHTML = '<div class="empty-state">Error</div>'; }
}

export async function createSchedule() {
  const msg = document.getElementById('scheduleMsg').value.trim();
  const date = document.getElementById('scheduleDate').value;
  const time = document.getElementById('scheduleTime').value;
  const st = document.getElementById('scheduleStatus');
  if (!msg) { st.textContent='กรุณาเขียนข้อความ'; st.className='toast err'; return; }
  if (!date || !time) { st.textContent='กรุณาเลือกวันและเวลา'; st.className='toast err'; return; }
  const scheduledAt = new Date(date+'T'+time+':00').toISOString();
  try {
    const res = await fetch('/api/schedule', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:msg,scheduled_at:scheduledAt})});
    const data = await res.json();
    if (data.ok) { st.textContent='ตั้งเวลาสำเร็จ!'; st.className='toast ok'; document.getElementById('scheduleMsg').value=''; window.loadSchedule(); }
    else { st.textContent=data.error||'Error'; st.className='toast err'; }
  } catch(e) { st.textContent='Error: '+e.message; st.className='toast err'; }
}

export async function cancelSchedule(id) {
  await fetch('/api/schedule/'+id, {method:'DELETE', credentials:'same-origin'});
  window.loadSchedule();
}

export function editScheduledPost(id, message, imageUrl, date, time) {
  state.editingScheduleId = id;
  // Switch to compose tab
  window.switchTab('compose', document.querySelector('.sidebar-nav-item'));
  // Pre-fill message
  var msgEl = document.getElementById('message');
  msgEl.value = message || '';
  msgEl.dispatchEvent(new Event('input'));
  // Pre-fill image
  var prevEl = document.getElementById('imagePreview');
  if (imageUrl) {
    state.uploadedImageUrl = imageUrl;
    document.getElementById('postType').value = 'image';
    prevEl.innerHTML = '<div class="preview-item" style="position:relative;display:inline-block"><img src="' + insEsc(imageUrl) + '" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid var(--border)"><button onclick="removeEditImage()" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:0.7rem">✕</button></div>';
  } else {
    state.uploadedImageUrl = null;
    document.getElementById('postType').value = 'text';
    prevEl.innerHTML = '';
  }
  // Show schedule picker with pre-filled date/time
  var picker = document.getElementById('schedulePicker');
  picker.style.display = 'block';
  if (date) document.getElementById('schedDate').value = date;
  if (time) setSchedTime(time);
  // Change button to update mode
  var postBtn = document.getElementById('postBtn');
  postBtn.style.display = 'none';
  var schedToggle = document.getElementById('scheduleToggle');
  schedToggle.style.display = 'none';
  // Add/update the update button
  var updateBtn = document.getElementById('schedUpdateBtn');
  if (!updateBtn) {
    updateBtn = document.createElement('button');
    updateBtn.id = 'schedUpdateBtn';
    updateBtn.className = 'btn btn-accent';
    updateBtn.style.cssText = 'font-size:1.05rem;padding:16px 32px;box-shadow:0 4px 20px var(--accent-glow)';
    postBtn.parentElement.insertBefore(updateBtn, postBtn);
  }
  updateBtn.style.display = '';
  updateBtn.innerHTML = '✅ อัพเดตโพส';
  updateBtn.onclick = async function() {
    var newMsg = document.getElementById('message').value.trim();
    if (!newMsg && !state.uploadedImageUrl) { toast('err','กรุณาเขียนข้อความหรือเลือกรูป'); return; }
    var newDate = document.getElementById('schedDate').value;
    var newTime = document.getElementById('schedTime').value;
    var body = { message: newMsg, image_url: state.uploadedImageUrl || null };
    if (newDate && newTime) body.scheduled_at = newDate + 'T' + newTime + ':00';
    try {
      var res = await fetch('/api/schedule/' + state.editingScheduleId, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var data = await res.json();
      if (data.ok) {
        toast('ok','อัพเดตโพสสำเร็จ!');
        exitEditMode();
        window.loadSchedule();
      } else { toast('err', data.error || 'Error'); }
    } catch(e) { toast('err','Error: ' + e.message); }
  };
  // Add cancel edit button
  var cancelEditBtn = document.getElementById('schedCancelEditBtn');
  if (!cancelEditBtn) {
    cancelEditBtn = document.createElement('button');
    cancelEditBtn.id = 'schedCancelEditBtn';
    cancelEditBtn.className = 'btn btn-ghost';
    cancelEditBtn.style.cssText = 'font-size:0.85rem;padding:12px 18px';
    cancelEditBtn.innerHTML = '↩️ ยกเลิกแก้ไข';
    cancelEditBtn.onclick = function() { exitEditMode(); };
    postBtn.parentElement.appendChild(cancelEditBtn);
  }
  cancelEditBtn.style.display = '';
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function removeEditImage() {
  state.uploadedImageUrl = null;
  document.getElementById('imagePreview').innerHTML = '';
  document.getElementById('postType').value = 'text';
}

export function exitEditMode() {
  state.editingScheduleId = null;
  document.getElementById('message').value = '';
  document.getElementById('charCount').textContent = '0';
  document.getElementById('imagePreview').innerHTML = '';
  state.uploadedImageUrl = null;
  document.getElementById('postType').value = 'text';
  document.getElementById('schedulePicker').style.display = 'none';
  document.getElementById('postBtn').style.display = '';
  document.getElementById('scheduleToggle').style.display = '';
  var updateBtn = document.getElementById('schedUpdateBtn');
  if (updateBtn) updateBtn.style.display = 'none';
  var cancelEditBtn = document.getElementById('schedCancelEditBtn');
  if (cancelEditBtn) cancelEditBtn.style.display = 'none';
  window.switchTab('schedule', document.querySelector('.sidebar-nav-item'));
}

// Drafts
export async function loadDrafts() {
  const list = document.getElementById('draftList');
  try {
    const dpid = state.selectedPage ? state.selectedPage.id : '';
    const res = await fetch('/api/drafts' + (dpid ? '?page_id=' + dpid : ''), {credentials:'same-origin'});
    const data = await res.json();
    if (!data.drafts || data.drafts.length === 0) {
      list.innerHTML = '<div class="empty-state">ยังไม่มีฉบับร่าง</div>';
      return;
    }
    list.innerHTML = data.drafts.map(d => `
      <div style="padding:12px;background:var(--bg-input);border-radius:8px;margin-bottom:8px;border:1px solid var(--border)">
        <div style="font-size:0.85rem;color:var(--text);white-space:pre-wrap;max-height:60px;overflow:hidden">${d.message.slice(0,120)}${d.message.length>120?'...':''}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <span style="font-size:0.7rem;color:var(--text-muted)">${new Date(d.updated_at).toLocaleString('th-TH',{hour12:false})}</span>
          <div style="display:flex;gap:6px">
            <button onclick="publishDraft(${d.id})" style="background:var(--accent);color:#fff;border:none;padding:4px 12px;border-radius:6px;font-size:0.72rem;cursor:pointer">โพสเลย</button>
            <button onclick="editDraft(${d.id})" style="background:none;border:1px solid var(--border);color:var(--text-secondary);padding:4px 10px;border-radius:6px;font-size:0.72rem;cursor:pointer">แก้ไข</button>
            <button onclick="deleteDraft(${d.id})" style="background:none;border:1px solid rgba(239,68,68,0.3);color:#ef4444;padding:4px 10px;border-radius:6px;font-size:0.72rem;cursor:pointer">ลบ</button>
          </div>
        </div>
      </div>
    `).join('');
  } catch(e) { list.innerHTML = '<div class="empty-state">Error</div>'; }
}

export async function saveDraft() {
  const msg = document.getElementById('message').value.trim();
  if (!msg) { toast('err','เขียนข้อความก่อนบันทึก'); return; }
  try {
    const res = await fetch('/api/drafts', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:msg, image_url:window._uploadedUrl||null})});
    const data = await res.json();
    if (data.ok) { toast('ok','บันทึกฉบับร่างแล้ว'); } else { toast('err',data.error); }
  } catch(e) { toast('err',e.message); }
}

export async function publishDraft(id) {
  // inline confirm handled by UI
  try {
    const res = await fetch('/api/drafts/'+id+'/publish', {method:'POST', credentials:'same-origin'});
    const data = await res.json();
    if (data.ok) { toast('ok','โพสสำเร็จ!'); loadDrafts(); } else { toast('err',data.error); }
  } catch(e) { toast('err',e.message); }
}

export async function editDraft(id) {
  try {
    const dpid = state.selectedPage ? state.selectedPage.id : '';
    const res = await fetch('/api/drafts' + (dpid ? '?page_id=' + dpid : ''), {credentials:'same-origin'});
    const data = await res.json();
    const draft = data.drafts.find(d => d.id === id);
    if (draft) {
      document.getElementById('message').value = draft.message;
      document.getElementById('charCount').textContent = draft.message.length;
      window.switchTab('compose', document.querySelector('.sidebar-nav-item'));
      toast('ok','โหลดฉบับร่างแล้ว แก้ไขได้เลย');
    }
  } catch(e) { toast('err',e.message); }
}

export async function deleteDraft(id) {
  
  await fetch('/api/drafts/'+id, {method:'DELETE', credentials:'same-origin'});
  loadDrafts();
}

// Tickets
export async function submitTicket() {
  const type = document.getElementById('ticketType').value;
  const title = document.getElementById('ticketTitle').value.trim();
  const body = document.getElementById('ticketBody').value.trim();
  const image = document.getElementById('ticketImage').value.trim();
  const st = document.getElementById('ticketStatus');
  if (!title) { st.textContent = 'กรุณาใส่หัวข้อ'; st.className = 'toast err'; return; }
  if (!body) { st.textContent = 'กรุณาใส่รายละเอียด'; st.className = 'toast err'; return; }
  try {
    const r = await fetch('/api/tickets', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, body, image_url: image || null }) });
    const d = await r.json();
    if (d.ok) {
      st.textContent = 'ส่ง ticket สำเร็จ!'; st.className = 'toast ok';
      document.getElementById('ticketTitle').value = '';
      document.getElementById('ticketBody').value = '';
      document.getElementById('ticketImage').value = '';
      loadTickets();
    } else { st.textContent = d.error || 'Error'; st.className = 'toast err'; }
  } catch(e) { st.textContent = 'Error: ' + e.message; st.className = 'toast err'; }
}

// === Insights Dashboard ===
var insData = {};



export function showInsSkeleton() {
  ['insImpressions','insEngaged','insFanAdds','insPostsToday'].forEach(function(id) {
    document.getElementById(id).innerHTML = '<div class="ins-skel" style="width:50px;height:24px;margin:0 auto"></div>';
  });
  document.getElementById('insTopPosts').innerHTML = '<div class="ins-skel" style="height:40px;margin:4px 0"></div><div class="ins-skel" style="height:40px;margin:4px 0"></div><div class="ins-skel" style="height:40px;margin:4px 0"></div>';
}

export function insShowError(msg) {
  var el = document.getElementById('insError');
  if (msg) { el.textContent = msg; el.style.display = ''; }
  else { el.style.display = 'none'; }
}
export function insShowTimestamp(ts) {
  var el = document.getElementById('insTimestamp');
  if (ts) { el.textContent = 'อัพเดตล่าสุด: ' + new Date(ts).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', hour12:false }); }
  else { el.textContent = ''; }
}
export function insRenderAll() {
  renderInsStats();
  setTimeout(renderInsChart, 0);
  setTimeout(renderInsTopPosts, 0);
  setTimeout(renderInsHeatmap, 10);
}

export async function loadInsights(force) {
  var pageId = state.selectedPage ? state.selectedPage.id : '';
  if (!pageId) { insShowError('กรุณาเลือกเพจจาก sidebar ก่อน'); return; }
  insShowError(null);
  var cacheKey = 'ins:' + pageId;
  if (!force) {
    try {
      var cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        insData = JSON.parse(cached);
        insShowTimestamp(insData.ts);
        insRenderAll();
        return;
      }
    } catch(e) { /* ignore */ }
  }
  showInsSkeleton();
  try {
    var r = await fetch('/api/insights-bundle/' + pageId, { credentials: 'same-origin' });
    var d = await r.json();
    if (d.error) {
      var msg = d.error === 'token_expired' ? 'Token หมดอายุ — กรุณา login ใหม่' :
                d.error === 'fb_api_error' ? 'Facebook API error: ' + (d.detail || 'ลองใหม่อีกครั้ง') :
                d.error === 'Page not found' ? 'ไม่พบเพจนี้' : d.error;
      insShowError(msg);
      ['insImpressions','insEngaged','insFanAdds','insPostsToday'].forEach(function(id) { document.getElementById(id).textContent = '—'; });
      return;
    }
    insData = d;
    try { sessionStorage.setItem(cacheKey, JSON.stringify(d)); } catch(e) { /* ignore */ }
    insShowTimestamp(d.ts);
    insRenderAll();
  } catch(e) {
    insShowError('โหลดข้อมูลไม่สำเร็จ — ลองกด ↻ อีกครั้ง');
    ['insImpressions','insEngaged','insFanAdds','insPostsToday'].forEach(function(id) { document.getElementById(id).textContent = '—'; });
  }
}

export async function insRefreshAndLoad() {
  var pageId = state.selectedPage ? state.selectedPage.id : '';
  if (!pageId) return;
  var btn = document.getElementById('insRefreshBtn');
  btn.textContent = '⏳';
  btn.disabled = true;
  insShowError(null);
  try {
    await fetch('/api/analytics/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: pageId }) });
  } catch(e) { /* ignore, still reload */ }
  try { sessionStorage.removeItem('ins:' + pageId); } catch(e) { /* ignore */ }
  await loadInsights(true);
  btn.textContent = '↻';
  btn.disabled = false;
}

export async function insSyncPosts() {
  var pageId = state.selectedPage ? state.selectedPage.id : '';
  if (!pageId) { insShowError('กรุณาเลือกเพจก่อน'); return; }
  var btn = document.getElementById('insSyncBtn');
  btn.textContent = '⏳ Syncing...';
  btn.disabled = true;
  insShowError(null);
  try {
    var r = await fetch('/api/analytics/sync-posts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: pageId }) });
    var d = await r.json();
    if (d.error) { insShowError(d.error); }
    else { try { sessionStorage.removeItem('ins:' + pageId); } catch(e) {} await loadInsights(true); }
  } catch(e) { insShowError('Sync ไม่สำเร็จ — ลองใหม่'); }
  btn.textContent = 'Sync โพส';
  btn.disabled = false;
}

export function insFmtNum(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export function renderInsDelta(elId, cur, prev) {
  var el = document.getElementById(elId);
  if (!el || !prev) return;
  var pct = Math.round((cur - prev) / prev * 100);
  el.textContent = (pct >= 0 ? '+' : '') + pct + '%';
  el.className = 'ins-stat-delta ' + (pct >= 0 ? 'up' : 'down');
}

export function insGetMetric(name) {
  var arr = insData.insights || [];
  for (var i = 0; i < arr.length; i++) { if (arr[i].name === name) return arr[i]; }
  return null;
}
export function insMetricTotal(name) {
  var m = insGetMetric(name);
  if (!m || !m.values) return 0;
  return m.values.reduce(function(a, v) { return a + (v.value || 0); }, 0);
}
export function renderInsStats() {
  var impTotal = insMetricTotal('page_views_total');
  var engTotal = insMetricTotal('page_post_engagements');
  var fanTotal = insMetricTotal('page_daily_follows');
  document.getElementById('insImpressions').textContent = insFmtNum(impTotal);
  document.getElementById('insEngaged').textContent = insFmtNum(engTotal);
  document.getElementById('insFanAdds').textContent = insFmtNum(fanTotal);
  var stats = insData.stats || {};
  document.getElementById('insPostsToday').textContent = stats.posts || 0;
}

export function renderInsChart() {
  var canvas = document.getElementById('insChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.clientWidth;
  var h = 200;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  var impMetric = insGetMetric('page_views_total');
  var engMetric = insGetMetric('page_post_engagements');
  var impVals = (impMetric && impMetric.values) ? impMetric.values.map(function(v) { return v.value || 0; }) : [];
  var engVals = (engMetric && engMetric.values) ? engMetric.values.map(function(v) { return v.value || 0; }) : [];
  var labels = (impMetric && impMetric.values) ? impMetric.values.map(function(v) { return (v.end_time || '').slice(0, 10); }) : [];
  if (!impVals.length && !engVals.length) {
    ctx.fillStyle = '#555';
    ctx.font = '13px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('ไม่มีข้อมูล', w / 2, h / 2);
    return;
  }
  var all = impVals.concat(engVals);
  var maxVal = Math.max(1, Math.max.apply(null, all));
  var padL = 45, padR = 10, padT = 20, padB = 30;
  var chartW = w - padL - padR;
  var chartH = h - padT - padB;
  var n = Math.max(impVals.length, engVals.length, 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  var g, gy;
  for (g = 0; g <= 4; g++) {
    gy = padT + chartH - (g / 4) * chartH;
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke();
    ctx.fillStyle = '#555'; ctx.font = '10px Inter'; ctx.textAlign = 'right';
    ctx.fillText(insFmtNum(Math.round(maxVal * g / 4)), padL - 6, gy + 3);
  }
  function insDrawLine(vals, color) {
    if (!vals.length) return;
    var i, x, y;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (i = 0; i < vals.length; i++) {
      x = padL + (i / (n - 1)) * chartW;
      y = padT + chartH - (vals[i] / maxVal) * chartH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = color;
    for (i = 0; i < vals.length; i++) {
      x = padL + (i / (n - 1)) * chartW;
      y = padT + chartH - (vals[i] / maxVal) * chartH;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  insDrawLine(impVals, '#4f6ef7');
  insDrawLine(engVals, '#22c55e');
  ctx.fillStyle = '#555'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
  var i, x, lbl;
  for (i = 0; i < n; i++) {
    x = padL + (i / (n - 1)) * chartW;
    lbl = labels[i] || '';
    if (lbl.length > 5) lbl = lbl.slice(5);
    ctx.fillText(lbl, x, h - 8);
  }
  ctx.fillStyle = '#4f6ef7'; ctx.fillRect(padL, 4, 10, 3);
  ctx.fillStyle = '#8b8fa3'; ctx.font = '10px Inter'; ctx.textAlign = 'left';
  ctx.fillText('Page Views', padL + 14, 9);
  ctx.fillStyle = '#22c55e'; ctx.fillRect(padL + 85, 4, 10, 3);
  ctx.fillStyle = '#8b8fa3'; ctx.fillText('Engagements', padL + 99, 9);
}

export function renderInsTopPosts() {
  var el = document.getElementById('insTopPosts');
  var perf = insData.performance || {};
  var posts = perf.top || [];
  if (!posts.length) { el.innerHTML = '<div class="empty-state">ไม่มีโพส</div>'; return; }
  var sorted = posts.slice().sort(function(a, b) {
    return ((b.likes || 0) + (b.comments || 0) + (b.shares || 0)) - ((a.likes || 0) + (a.comments || 0) + (a.shares || 0));
  }).slice(0, 5);
  el.innerHTML = sorted.map(function(p, i) {
    var msg = insEsc((p.message || '').substring(0, 60)) || '(ไม่มีข้อความ)';
    var date = insEsc((p.created_at || '').slice(0, 10));
    return '<div class="ins-post"><div class="ins-post-rank">' + (i + 1) + '</div><div class="ins-post-body"><div class="ins-post-msg">' + msg + '</div><div class="ins-post-meta">' + (p.likes || 0) + ' likes · ' + (p.comments || 0) + ' comments · ' + (p.shares || 0) + ' shares — ' + date + '</div></div></div>';
  }).join('');
}

export function renderInsHeatmap() {
  var el = document.getElementById('insHeatmap');
  var bt = insData.bestTime || {};
  var raw = bt.heatmap || [];
  var days = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  // Build 7x24 grid from [{d,h,eng}] array
  var grid = [];
  var d, h, maxHeat = 1;
  for (d = 0; d < 7; d++) { grid[d] = []; for (h = 0; h < 24; h++) grid[d][h] = 0; }
  for (var i = 0; i < raw.length; i++) {
    var r = raw[i];
    var rd = parseInt(r.d), rh = parseInt(r.h);
    if (rd >= 0 && rd < 7 && rh >= 0 && rh < 24 && grid[rd]) {
      grid[rd][rh] = Number(r.eng) || 0;
      if (grid[rd][rh] > maxHeat) maxHeat = grid[rd][rh];
    }
  }
  var html = '<div class="ins-hm-label"></div>';
  for (h = 0; h < 24; h++) {
    html += '<div class="ins-hm-hr">' + (h % 3 === 0 ? h : '') + '</div>';
  }
  for (d = 0; d < 7; d++) {
    html += '<div class="ins-hm-label">' + days[d] + '</div>';
    for (h = 0; h < 24; h++) {
      var v = grid[d][h];
      var intensity = v / maxHeat;
      var bg = intensity === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(79,110,247,' + (0.1 + intensity * 0.7).toFixed(2) + ')';
      html += '<div class="ins-hm-cell" style="background:' + bg + '" title="' + days[d] + ' ' + h + ':00 — ' + Math.round(v) + '"></div>';
    }
  }
  if (bt.tip) html += '<div style="grid-column:1/-1;text-align:center;font-size:0.72rem;color:var(--accent);margin-top:8px">' + insEsc(bt.tip) + '</div>';
  el.innerHTML = html;
}

// Trend category filter
// === Challenge Dashboard ===
var CH_COLORS = {follows:'#4f6ef7',posts:'#22c55e',reels:'#a855f7',engagements:'#f59e0b',views:'#ec4899'};
var CH_DETAILS = {
  follows:['โพสเนื้อหาที่คนอยาก share ให้เพื่อน','ใช้ CTA เช่น "กด Follow เพื่อไม่พลาด"','โพสสม่ำเสมอ ให้คนเห็นบ่อย'],
  posts:['โพสอย่างน้อยวันละ 1 โพส','ใช้รูปจริง ไม่ใช่ stock — engagement สูงกว่า 3x','โพสช่วง 18:00-20:00 ได้ reach สูงสุด'],
  reels:['Reels สั้น 15-30 วิ ได้ views สูงกว่า','ใช้เพลงที่กำลัง trending','ถ่ายแนวตั้ง 9:16 เท่านั้น'],
  engagements:['ตอบ comment ภายใน 1 ชม.','ถามคำถามท้ายโพส เพิ่ม comment','ใช้ poll/quiz ใน Stories'],
  views:['แชร์โพสไป Group ที่เกี่ยวข้อง','ใช้ hashtag ไทยที่กำลัง trending','โพส video สั้นๆ ได้ views เยอะกว่ารูป']
};
export function toggleChDetail(idx){var cards=document.querySelectorAll('.ch-card');if(cards[idx])cards[idx].classList.toggle('expanded');}
var CH_BG = {follows:'rgba(79,110,247,0.1)',posts:'rgba(34,197,94,0.1)',reels:'rgba(168,85,247,0.1)',engagements:'rgba(245,158,11,0.1)',views:'rgba(236,72,153,0.1)'};
var CH_ACTIONS = {
  follows:{tab:null,tip:'โพสเนื้อหาที่ได้ share เยอะ จะเพิ่มผู้ติดตาม'},
  posts:{tab:'compose',label:'เขียนโพส →',tip:'โพสช่วง 18:00-20:00 ได้ reach สูงสุด'},
  reels:{tab:'compose',label:'สร้าง Reels →',tip:'Reels สั้น 15-30 วิ ได้ views สูงกว่า'},
  engagements:{tab:'history',label:'ดู comments →',tip:'ตอบ comment ภายใน 1 ชม. เพิ่ม interaction เร็ว'},
  views:{tab:'insights',label:'ดู Insights →',tip:'ใช้รูปจริง ไม่ใช่ stock — engagement สูงกว่า 3x'}
};

export async function loadChallenges(force) {
  var pageId = state.selectedPage ? state.selectedPage.id : '';
  if (!pageId) { document.getElementById('chList').innerHTML = '<div class="empty-state">เลือกเพจจาก sidebar ก่อน</div>'; return; }
  var el = document.getElementById('chList');
  var cacheKey = 'ch:' + pageId;
  if (!force) {
    try { var cached = sessionStorage.getItem(cacheKey); if (cached) { var cd = JSON.parse(cached); renderChCards(cd); return; } } catch(e) {}
  }
  el.innerHTML = [1,2,3,4,5].map(function(){return '<div class="ch-card" style="pointer-events:none"><div class="ins-skel" style="width:36px;height:36px;border-radius:10px;flex-shrink:0"></div><div class="ch-body"><div class="ins-skel" style="height:12px;width:50%;margin-bottom:6px"></div><div class="ins-skel" style="height:6px;width:100%"></div></div></div>';}).join('');
  try {
    var r = await fetch('/api/challenges/' + pageId, { credentials: 'same-origin' });
    if (!r.ok) { el.innerHTML = '<div class="empty-state">API error ' + r.status + ' — ลองกด ↻</div>'; return; }
    var d = await r.json();
    try { sessionStorage.setItem(cacheKey, JSON.stringify(d)); } catch(e) {}
    if (d.error) { el.innerHTML = '<div class="empty-state">' + insEsc(d.error) + '</div>'; return; }
    renderChCards(d);
  } catch(e) { document.getElementById('chList').innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ — ' + insEsc(e.message || 'ลองกด ↻') + '</div>'; }
}

export function renderChCards(d) {
  var el = document.getElementById('chList');
  var challenges = d.challenges || [];
  if (!challenges.length) { el.innerHTML = '<div class="empty-state">ไม่มี challenge</div>'; return; }
  var periodEl = document.getElementById('chPeriod');
  if (periodEl && d.period) periodEl.textContent = '(' + d.period + ')';
  el.innerHTML = challenges.map(function(c, idx) {
    var pct = Math.min(100, c.percent || 0);
    var done = pct >= 100;
    var color = CH_COLORS[c.id] || 'var(--accent)';
    var bg = CH_BG[c.id] || 'rgba(79,110,247,0.1)';
    var statusText = done ? '✓ สำเร็จ' : c.current + '/' + c.target;
    var statusStyle = done ? 'color:#22c55e;background:rgba(34,197,94,0.1)' : 'color:var(--text-secondary);background:var(--bg-input)';
    var act = CH_ACTIONS[c.id] || {};
    var actionBtn = (!done && act.tab) ? '<button class="ch-action" onclick="event.stopPropagation();window.switchTab(\'' + act.tab + '\')">' + insEsc(act.label) + '</button>' : '';
    var remaining = Math.max(0, c.target - c.current);
    var boostBtn = (!done && (c.id === 'posts' || c.id === 'reels') && remaining > 0) ? '<button class="ch-boost" onclick="event.stopPropagation();boostChallenge(\'' + c.id + '\',' + remaining + ',this)">🤖 AI</button>' : '';
    var tipHtml = !done && act.tip ? '<div class="ch-tip">💡 ' + insEsc(act.tip) + '</div>' : '';
    var details = CH_DETAILS[c.id] || [];
    var detailHtml = details.length ? '<div class="ch-detail">' + details.map(function(t){return '<div class="ch-detail-item">💡 ' + insEsc(t) + '</div>';}).join('') + '</div>' : '';
    return '<div class="ch-card' + (done ? ' completed' : '') + '" onclick="toggleChDetail(' + idx + ')">' +
      '<div class="ch-icon" style="background:' + bg + '">' + insEsc(c.icon || '🎯') + '</div>' +
      '<div class="ch-body">' +
        '<div class="ch-title">' + insEsc(c.name) + ' <span class="ch-expand-icon">▼</span></div>' +
        '<div class="ch-desc">' + c.current + ' / ' + c.target + ' (' + Math.round(pct) + '%)</div>' +
        '<div class="ch-bar"><div class="ch-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
        tipHtml + '<div style="display:flex;gap:4px;flex-wrap:wrap">' + actionBtn + boostBtn + '</div>' +
        detailHtml +
      '</div>' +
      '<div class="ch-status" style="' + statusStyle + '">' + statusText + '</div>' +
    '</div>';
  }).join('');
}


export async function boostChallenge(challengeId, count, btn) {
  var pageId = state.selectedPage ? state.selectedPage.id : '';
  if (!pageId) return;
  if (btn.dataset.confirmed !== 'yes') {
    btn.textContent = '⚠️ กดอีกครั้งเพื่อยืนยัน';
    btn.dataset.confirmed = 'yes';
    setTimeout(function() { btn.textContent = '🤖 AI'; btn.dataset.confirmed = ''; }, 3000);
    return;
  }
  btn.dataset.confirmed = '';
  btn.disabled = true;
  btn.textContent = '⏳ กำลังสร้าง...';
  try {
    var r = await fetch('/api/challenges/' + pageId + '/boost', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_id: challengeId, count: Math.min(count, 5), types: ['photo', 'question', 'link'] }) });
    var d = await r.json();
    if (d.ok) {
      showNotify('สร้างโพส ' + (d.generated || count) + ' อัน + schedule แล้ว!');
      loadChallenges(true);
    } else {
      btn.textContent = '❌ ' + insEsc(d.error || 'ไม่สำเร็จ');
      setTimeout(function() { btn.textContent = '🤖 AI ช่วยทำ'; btn.disabled = false; }, 3000);
    }
  } catch(e) {
    btn.textContent = '❌ ลองใหม่';
    setTimeout(function() { btn.textContent = '🤖 AI ช่วยทำ'; btn.disabled = false; }, 3000);
  }
}

// === API Keys Settings ===
export async function saveApiKey(keyName, inputId) {
  var val = document.getElementById(inputId).value.trim();
  if (!val) { toast('err', 'กรุณากรอก API key'); return; }
  try {
    var body = {};
    body[keyName] = val;
    var r = await fetch('/api/settings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var d = await r.json();
    if (d.ok) { showNotify('บันทึก ' + keyName + ' สำเร็จ!'); document.getElementById(inputId).value = ''; loadApiKeyStatus(); }
    else { toast('err', d.error || 'บันทึกไม่สำเร็จ'); }
  } catch(e) { toast('err', 'เกิดข้อผิดพลาด'); }
}

export async function loadApiKeyStatus() {
  try {
    var r = await fetch('/api/settings', { credentials: 'same-origin' });
    var d = await r.json();
    var keys = [['has_apify_key','apifyStatus','Shopee/Apify'],['has_gemini_key','geminiStatus','Gemini'],['has_fal_key','falStatus','FAL.ai']];
    keys.forEach(function(k) {
      var el = document.getElementById(k[1]);
      if (!el) return;
      if (d[k[0]]) { el.textContent = '✅ ' + k[2] + ' configured'; el.style.color = 'var(--success)'; }
      else { el.textContent = '⚠️ ยังไม่ได้ตั้งค่า'; el.style.color = 'var(--text-muted)'; }
    });
  } catch(e) { /* ignore */ }
}

export function filterTrends(cat) {
  document.querySelectorAll('.trend-filter').forEach(b=>{b.style.background='var(--bg-input)';b.style.color='var(--text-secondary)';});
  event.target.style.background='var(--accent)';event.target.style.color='#fff';
  document.querySelectorAll('.trend-card').forEach(el=>{
    if(cat==='all'||el.dataset.cat===cat) el.style.display='';
    else el.style.display='none';
  });
}

