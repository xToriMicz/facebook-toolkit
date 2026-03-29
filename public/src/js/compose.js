// Compose post, AI writing, image generation, templates, history, drafts, comments
import state from './state.js';
import { toast, insEsc, showNotify, formatBytes, showProgress, hideProgress } from './utils.js';

// --- File Upload ---
export function initCompose() {
  document.getElementById('message').addEventListener('input', e => updateCharColor());
  const dz = document.getElementById('dropZone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; });
  dz.addEventListener('drop', e => { e.preventDefault(); dz.style.borderColor = ''; if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
}

function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onerror = () => { URL.revokeObjectURL(objUrl); resolve({ blob: file, thumbUrl: URL.createObjectURL(file), origSize: file.size, compSize: file.size }); };
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > state.MAX_IMG_PX || h > state.MAX_IMG_PX) { const ratio = Math.min(state.MAX_IMG_PX / w, state.MAX_IMG_PX / h); w = Math.round(w * ratio); h = Math.round(h * ratio); }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(objUrl);
        if (!blob) { resolve({ blob: file, thumbUrl: URL.createObjectURL(file), origSize: file.size, compSize: file.size }); return; }
        resolve({ blob, thumbUrl: URL.createObjectURL(blob), origSize: file.size, compSize: blob.size });
      }, 'image/jpeg', state.COMPRESS_Q);
    };
    img.src = objUrl;
  });
}

export async function handleFiles(files) {
  if (!files || !files.length) return;
  const total = files.length;
  let done = 0;
  const dz = document.getElementById('dropZone');
  dz.classList.add('has-file');
  for (const file of files) {
    done++;
    const isVideo = file.type.startsWith('video/');
    dz.textContent = '⏳ กำลังอัพโหลด ' + done + '/' + total + '...';
    let blob, thumbUrl, origSize, compSize, sizeInfo;
    if (isVideo) {
      if (file.size > 100 * 1024 * 1024) { toast('err', 'วิดีโอใหญ่เกินไป (max 100MB)'); continue; }
      blob = file; thumbUrl = URL.createObjectURL(file); origSize = file.size; compSize = file.size;
      sizeInfo = formatBytes(origSize) + ' (video)';
    } else {
      const c = await compressImage(file);
      blob = c.blob; thumbUrl = c.thumbUrl; origSize = c.origSize; compSize = c.compSize;
      sizeInfo = formatBytes(origSize) + '→' + formatBytes(compSize);
    }
    state.uploadedImages.push({ data: thumbUrl, name: file.name, url: null, sizeInfo, isVideo });
    renderImagePreviews();
    const form = new FormData();
    form.append('file', new File([blob], file.name, { type: isVideo ? file.type : 'image/jpeg' }));
    try {
      const r = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: form });
      const d = await r.json();
      if (d.ok) { const img = state.uploadedImages.find(i => i.name === file.name); if (img) { img.url = d.url; img.data = isVideo ? thumbUrl : d.url; state.uploadedImageUrl = d.url; } renderImagePreviews(); }
      else { toast('err', d.error || 'อัพโหลดไม่สำเร็จ'); }
    } catch (e) { toast('err', 'อัพโหลดไม่สำเร็จ: ' + (e.message || '')); }
  }
  const vidCount = state.uploadedImages.filter(i => i.isVideo).length;
  const imgCount = state.uploadedImages.length - vidCount;
  dz.textContent = '✅ ' + (imgCount ? imgCount + ' รูป' : '') + (imgCount && vidCount ? ' + ' : '') + (vidCount ? vidCount + ' วิดีโอ' : '');
}

export async function handleFile(file) { if (file) await handleFiles([file]); }

export function renderImagePreviews() {
  const el = document.getElementById('imagePreview');
  el.innerHTML = state.uploadedImages.map((img, i) => {
    const media = img.isVideo
      ? '<video src="' + img.data + '" style="width:80px;height:80px;object-fit:cover;border-radius:6px" muted></video><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:1.2rem">▶</div>'
      : '<img loading="lazy" src="' + img.data + '" style="width:80px;height:80px;object-fit:cover">';
    return '<div class="multi-thumb" style="position:relative">' + media + '<button class="multi-thumb-remove" onclick="removeImage(' + i + ')">×</button>' + (img.sizeInfo ? '<div style="font-size:0.55rem;color:var(--text-muted);text-align:center;margin-top:2px">' + img.sizeInfo + '</div>' : '') + '</div>';
  }).join('');
  state.uploadedImageData = state.uploadedImages.length ? state.uploadedImages[0].data : null;
}

export function removeImage(idx) {
  if (state.uploadedImages[idx] && state.uploadedImages[idx].data.startsWith('blob:')) URL.revokeObjectURL(state.uploadedImages[idx].data);
  state.uploadedImages.splice(idx, 1); renderImagePreviews();
  const dz = document.getElementById('dropZone');
  if (!state.uploadedImages.length) { dz.classList.remove('has-file'); dz.textContent = '📷 คลิกเพื่อเลือกรูปหรือวิดีโอ หรือลากไฟล์มาวาง'; state.uploadedImageUrl = null; state.uploadedImageData = null; }
  else { dz.textContent = '✅ ' + state.uploadedImages.length + ' รูป'; state.uploadedImageUrl = state.uploadedImages[0].url; }
}

// --- Submit Post ---
export async function submitPost() {
  const msg = document.getElementById('message').value.trim();
  if (!msg && !state.uploadedImageUrl) { toast('err', 'เขียนข้อความหรืออัพโหลดรูป/วิดีโอ'); return; }
  if (!state.selectedPage) { toast('err', 'กรุณาเลือกเพจก่อน'); return; }
  const btn = document.getElementById('postBtn'); btn.disabled = true; btn.innerHTML = '⏳ กำลังโพส...';
  showProgress('postProgress');
  try {
    const videoFile = state.uploadedImages.find(i => i.isVideo && i.url);
    const imageFiles = state.uploadedImages.filter(i => !i.isVideo && i.url);
    let r;
    if (videoFile) {
      r = await fetch('/api/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ message: msg, video_url: videoFile.url, page_id: state.selectedPage.id }) });
    } else {
      const imageUrls = imageFiles.map(i => i.url);
      const body = imageUrls.length > 1
        ? { message: msg, image_urls: imageUrls, page_id: state.selectedPage.id }
        : { message: msg, image_url: imageUrls[0] || null, page_id: state.selectedPage.id };
      r = await fetch('/api/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    }
    const d = await r.json();
    if (d.ok) { hideProgress('postProgress', true); toast('ok', 'โพสสำเร็จ!'); showNotify('โพสลงเพจเรียบร้อย!'); document.getElementById('message').value = ''; document.getElementById('imagePreview').innerHTML = ''; const dz = document.getElementById('dropZone'); dz.classList.remove('has-file'); dz.textContent = '📷 คลิกเพื่อเลือกรูปหรือวิดีโอ หรือลากไฟล์มาวาง'; state.uploadedImageUrl = null; state.uploadedImageData = null; state.uploadedImages = []; document.getElementById('charCount').textContent = '0'; window.loadHistory(); }
    else { hideProgress('postProgress'); const detail = d.photo_errors ? ' (' + d.photo_errors.join(', ') + ')' : ''; toast('err', (d.error || 'โพสไม่สำเร็จ') + detail); }
  } catch (e) { hideProgress('postProgress'); toast('err', 'Error: ' + e.message); }
  btn.disabled = false; btn.innerHTML = '📤 โพสลงเพจ';
}

// --- Preview ---
export function showPreview() {
  const msg = document.getElementById('message').value.trim();
  if (!msg && !state.uploadedImageUrl) { toast('err', 'Nothing to preview'); return; }
  document.getElementById('prevPagePic').src = state.selectedPage?.picture || '';
  document.getElementById('prevPageName').textContent = state.selectedPage?.name || 'Your Page';
  document.getElementById('prevMsg').textContent = msg;
  const img = document.getElementById('prevImg'); if (state.uploadedImageData) { img.src = state.uploadedImageData; img.classList.remove('hidden'); } else img.classList.add('hidden');
  document.getElementById('previewModal').classList.add('open');
}
export function closePreview() { document.getElementById('previewModal').classList.remove('open'); }
export async function confirmPost() { closePreview(); await submitPost(); }

// --- History ---
export async function loadHistory() {
  const el = document.getElementById('historyList');
  const pageFilter = document.getElementById('historyPageFilter');
  const filterVal = pageFilter ? pageFilter.value : '';
  try {
    const url = '/api/posts?engagement=1' + (filterVal ? '&page_id=' + filterVal : '');
    const r = await fetch(url, { credentials: 'same-origin' }); const d = await r.json(); const posts = d.posts || []; window.renderEngagementChart(posts);
    if (pageFilter && d.pages && pageFilter.options.length <= 1) {
      d.pages.forEach(pg => { const o = document.createElement('option'); o.value = pg.page_id; o.textContent = pg.page_name || pg.page_id; pageFilter.appendChild(o); });
    }
    if (!posts.length) { el.innerHTML = '<div class="empty-state">ยังไม่มีประวัติการโพส</div>'; return; }
    el.innerHTML = posts.map(p => {
      const dt = new Date(p.created_at || p.ts).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
      const badge = p.status === 'posted' ? '<span class="hist-badge ok">Posted</span>' : '<span class="hist-badge wait">Pending</span>';
      const thumb = p.image_url ? `<img loading="lazy" class="hist-thumb" src="${p.image_url}">` : '<div class="hist-thumb">📝</div>';
      const pageImg = p.page_picture ? '<img loading="lazy" src="' + p.page_picture + '" style="width:16px;height:16px;border-radius:4px;vertical-align:middle;margin-right:3px">' : '';
      const pageName = `<span style="font-size:0.7rem;color:${p.page_name ? 'var(--accent)' : 'var(--text-muted)'};margin-right:4px;display:inline-flex;align-items:center;gap:3px">${pageImg}${p.page_name || 'ไม่ระบุเพจ'}</span>`;
      const eng = p.engagement ? `<div style="display:flex;gap:10px;margin-top:4px;font-size:0.72rem;color:var(--text-secondary)"><span>❤️ ${p.engagement.likes}</span><span>💬 ${p.engagement.comments}</span><span>🔄 ${p.engagement.shares}</span></div>` : '';
      const cmtBtn = p.fb_post_id ? ` <button onclick="showComments('${p.fb_post_id}')" style="font-size:0.7rem;color:var(--accent);background:none;border:none;cursor:pointer;padding:0">💬 comments</button>` : '';
      return `<div class="hist-row">${thumb}<div class="hist-body"><div class="hist-msg">${(p.message || '').replace(/</g, '&lt;')}</div>${eng}<div class="hist-meta">${pageName}${dt} ${badge}${cmtBtn}</div></div></div>`;
    }).join('');
  } catch { el.innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ</div>'; }
}

// --- Templates ---
export async function loadComposeTemplates() {
  try {
    const r = await fetch('/api/templates', { credentials: 'same-origin' }); const d = await r.json(); const tpls = d.templates || [];
    const sel = document.getElementById('tplSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">📑 เลือกแม่แบบ...</option>' + tpls.map(t => '<option value="' + ((t.template_text || '').replace(/"/g, '&quot;')) + '">' + t.title + ' (' + t.category + ')</option>').join('');
  } catch { }
}

export function applyTemplate() {
  const sel = document.getElementById('tplSelect');
  if (sel && sel.value) { document.getElementById('message').value = sel.value; document.getElementById('charCount').textContent = sel.value.length; sel.selectedIndex = 0; }
}

export async function loadTemplates() {
  const el = document.getElementById('templateList');
  try {
    const r = await fetch('/api/templates', { credentials: 'same-origin' }); const d = await r.json(); const tpls = d.templates || [];
    if (!tpls.length) { el.innerHTML = '<div class="empty-state">ยังไม่มีแม่แบบ</div>'; return; }
    el.innerHTML = tpls.map(t => `<div class="tpl-item" onclick="useTemplate(this)" data-msg="${(t.template_text || '').replace(/"/g, '&quot;')}"><div class="tpl-name">${t.title || 'Template'}</div><div class="tpl-preview">${(t.template_text || '').replace(/</g, '&lt;')}</div><span class="tpl-use">ใช้แม่แบบนี้ →</span></div>`).join('');
  } catch { el.innerHTML = '<div class="empty-state">โหลดไม่สำเร็จ</div>'; }
}

export function useTemplate(el) {
  const msg = el.dataset.msg; document.getElementById('message').value = msg; document.getElementById('charCount').textContent = msg.length;
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  ['tabCompose', 'tabHistory', 'tabTemplates'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('tabCompose').classList.remove('hidden');
  window.loadAiImageTemplates();
}

// --- Style Guide & Char Counter ---
export const STYLE_GUIDE = {
  general: { min: 100, ideal: 500, max: 800, tips: '💡 แนะนำ: ไม่เกิน 800 ตัวอักษร, เขียนอิสระ', prompt: 'เขียนโพส Facebook ภาษาไทย สไตล์อิสระ เขียนแบบไหนก็ได้ที่เหมาะกับหัวข้อ อ่านง่าย น่าสนใจ ไม่เกิน 250 คำ' },
  professional: { min: 800, ideal: 1500, max: 2500, tips: '💡 แนะนำ: 800-2,500 ตัวอักษร, Hook แรง → เนื้อหาลึก → Takeaway', prompt: 'เขียนโพส Facebook ให้ความรู้แบบ SEO ภาษาไทย 300-500 คำ เริ่มด้วย hook 2 บรรทัดที่ทำให้คนต้องกด "ดูเพิ่มเติม" จากนั้นให้ความรู้ลึกๆ แบ่งเป็นหัวข้อย่อย ใช้ emoji เป็น bullet points มีสถิติหรือ fact ปิดด้วย takeaway ที่ปฏิบัติได้ + ถามคำถามให้คนคอมเมนต์' },
};

export function onStyleChange() {
  const style = document.getElementById('aiTone').value;
  const guide = STYLE_GUIDE[style];
  if (guide) document.getElementById('styleHint').textContent = guide.tips;
  updateCharColor();
}

export function updateCharColor() {
  const len = document.getElementById('message').value.length;
  const style = document.getElementById('aiTone').value;
  const guide = STYLE_GUIDE[style] || STYLE_GUIDE.general;
  const countEl = document.getElementById('charCount');
  const hintEl = document.getElementById('charHint');
  countEl.textContent = len;
  if (len === 0) { countEl.style.color = 'var(--text-muted)'; hintEl.textContent = ''; }
  else if (len <= guide.ideal) { countEl.style.color = '#22c55e'; hintEl.textContent = '✓ ดี'; hintEl.style.color = '#22c55e'; }
  else if (len <= guide.max) { countEl.style.color = '#f59e0b'; hintEl.textContent = '⚠ ยาวไปนิด'; hintEl.style.color = '#f59e0b'; }
  else { countEl.style.color = '#ef4444'; hintEl.textContent = '✗ ยาวเกิน'; hintEl.style.color = '#ef4444'; }
}

// --- Inline Drafts (compose) ---
export async function saveDraftFromCompose() {
  const msg = document.getElementById('message').value.trim();
  if (!msg) { toast('err', 'กรุณาเขียนข้อความก่อนบันทึก'); return; }
  try {
    const r = await fetch('/api/drafts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, image_url: state.uploadedImageUrl || null }) });
    const d = await r.json();
    if (d.ok) { toast('ok', 'บันทึกร่างแล้ว'); showNotify('บันทึกฉบับร่างสำเร็จ!'); loadComposeDrafts(); }
    else toast('err', d.error || 'บันทึกไม่สำเร็จ');
  } catch { toast('err', 'เกิดข้อผิดพลาด'); }
}

export async function loadComposeDrafts() {
  const el = document.getElementById('composeDrafts');
  try {
    const r = await fetch('/api/drafts', { credentials: 'same-origin' });
    const d = await r.json();
    const drafts = d.drafts || [];
    if (!drafts.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);font-weight:500;margin-bottom:6px">📝 ฉบับร่าง (' + drafts.length + ')</div>' +
      drafts.slice(0, 5).map(dr => {
        const preview = (dr.message || '').substring(0, 60);
        const time = new Date(dr.created_at || dr.ts).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
        return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-input);border-radius:8px;margin-bottom:4px;font-size:0.78rem;border:1px solid var(--border);cursor:pointer" onclick="loadDraftToCompose(' + dr.id + ')">' +
          '<span style="flex:1;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + preview + '</span>' +
          '<span style="color:var(--text-muted);font-size:0.68rem;white-space:nowrap">' + time + '</span>' +
          '<button onclick="event.stopPropagation();deleteDraftInline(' + dr.id + ',this)" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.8rem;padding:2px 4px">×</button></div>';
      }).join('');
  } catch { el.innerHTML = ''; }
}

export async function loadDraftToCompose(id) {
  try {
    const r = await fetch('/api/drafts', { credentials: 'same-origin' });
    const d = await r.json();
    const draft = (d.drafts || []).find(x => x.id === id);
    if (draft) { document.getElementById('message').value = draft.message || ''; document.getElementById('charCount').textContent = (draft.message || '').length; toast('ok', 'โหลดร่างแล้ว แก้ไขได้เลย'); }
  } catch { }
}

export async function deleteDraftInline(id) {
  await fetch('/api/drafts/' + id, { method: 'DELETE', credentials: 'same-origin' });
  loadComposeDrafts();
}

// --- AI Writer ---
export async function generateAI() {
  const ta = document.getElementById('message');
  const topic = ta.value.trim() || 'general social media content';
  const btn = document.getElementById('aiGenBtn');
  btn.disabled = true; btn.textContent = '⏳ กำลังเขียน...';
  showProgress('aiWriteProgress');
  try {
    const r = await fetch('/api/ai-write', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ topic, tone: document.getElementById('aiTone').value, format: 'ปานกลาง', style_prompt: (STYLE_GUIDE[document.getElementById('aiTone').value] || {}).prompt })
    });
    const d = await r.json();
    if (d.error) { hideProgress('aiWriteProgress'); toast('err', d.error); btn.disabled = false; btn.textContent = '✨ AI เขียนให้'; return; }
    hideProgress('aiWriteProgress', true);
    const text = d.text || '';
    const tags = (d.hashtags || []).join(' ');
    ta.value = text + (tags ? '\n\n' + tags : '');
    document.getElementById('charCount').textContent = ta.value.length;
    updateCharColor();
    savePromptLog('text', topic, text, d.provider || '', document.getElementById('aiTone').value);
  } catch (e) { hideProgress('aiWriteProgress'); toast('err', 'AI error: ' + e.message); }
  btn.disabled = false; btn.textContent = '✨ AI เขียนให้';
}

// --- Affiliate ---
export function toggleAffiliate() {
  const on = document.getElementById('affiliateMode').checked;
  document.getElementById('affiliateSection').style.display = on ? 'block' : 'none';
  if (on) {
    const ta = document.getElementById('message');
    if (!ta.value.includes('#ad')) ta.value = ta.value.trim() + '\n\n#ad #affiliate';
    document.getElementById('charCount').textContent = ta.value.length;
  }
}

// --- Algorithm Tips ---
const algoTips = [
  'Reels < 90 วินาที ได้ algorithm boost 50% (อัพเดต 2025)',
  'โพสที่ได้ comment ภายใน 1 ชม. จะถูก boost อย่างมาก',
  '98% ของโพสที่ได้ reach สูง ไม่มี external link',
  'โพส 2-5 ครั้ง/สัปดาห์ ได้ engagement 5 เท่า',
  'ตอบ comment ภายใน 24 ชม. = algorithm ให้คะแนนสูง',
  'รูปภาพได้ engagement 0.12% vs ค่าเฉลี่ย 0.07%',
  'ห้าม engagement bait เช่น "กดไลค์ถ้าเห็นด้วย" → ถูก demote',
];

export function initAlgoTips() {
  setInterval(() => {
    state.tipIdx = (state.tipIdx + 1) % algoTips.length;
    const el = document.getElementById('tipText');
    if (el) el.textContent = algoTips[state.tipIdx];
  }, 8000);
}

// --- Comments ---
export async function showComments(postId) {
  state.currentCommentPostId = postId;
  state.replyTargetId = null;
  document.getElementById('commentsModal').classList.add('open');
  const el = document.getElementById('commentsList');
  el.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    const r = await fetch('/api/posts/' + postId + '/comments', { credentials: 'same-origin' });
    const d = await r.json();
    if (d.error) { el.innerHTML = '<div class="empty-state">' + d.error + '</div>'; return; }
    const comments = d.comments || [];
    if (!comments.length) { el.innerHTML = '<div class="empty-state">No comments yet</div>'; return; }
    el.innerHTML = comments.map(c => '<div style="padding:10px;border-bottom:1px solid var(--border)"><div style="font-size:0.75rem;color:var(--accent);font-weight:600">' + (c.from?.name || 'Unknown') + '</div><div style="font-size:0.85rem;color:var(--text);margin:4px 0">' + (c.message || '').replace(/</g, '&lt;') + '</div><div style="font-size:0.7rem;color:var(--text-secondary)">' + new Date(c.created_time).toLocaleString('th-TH') + '</div><button onclick="setReplyTarget(\'' + c.id + '\')" style="font-size:0.7rem;color:var(--accent);background:none;border:none;cursor:pointer;padding:2px 0">Reply</button></div>').join('');
  } catch (e) { el.innerHTML = '<div class="empty-state">Error loading comments</div>'; }
}

export function setReplyTarget(commentId) { state.replyTargetId = commentId; document.getElementById('replyInput').focus(); document.getElementById('replyInput').placeholder = 'Reply to comment...'; }

export async function sendReply() {
  const msg = document.getElementById('replyInput').value.trim();
  const targetId = state.replyTargetId || state.currentCommentPostId;
  if (!msg || !targetId) return;
  try {
    const r = await fetch('/api/posts/' + targetId + '/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ message: msg }) });
    const d = await r.json();
    if (d.ok) { toast('ok', 'Reply sent!'); document.getElementById('replyInput').value = ''; state.replyTargetId = null; showComments(state.currentCommentPostId); }
    else toast('err', d.error || 'Reply failed');
  } catch (e) { toast('err', e.message); }
}

// --- Prompt Logs ---
export function togglePromptLogs() {
  var el = document.getElementById('promptLogsSection');
  var show = el.style.display === 'none';
  el.style.display = show ? '' : 'none';
  if (show) loadPromptLogs('all');
}

export async function loadPromptLogs(type, btn) {
  var el = document.getElementById('promptLogsList');
  var btns = document.querySelectorAll('.log-filter-btn');
  btns.forEach(function (b) { b.classList.remove('active'); b.style.background = 'var(--bg)'; b.style.color = 'var(--text-secondary)'; });
  if (btn) { btn.classList.add('active'); btn.style.background = 'var(--accent)'; btn.style.color = '#fff'; }
  else { var first = document.querySelector('.log-filter-btn'); if (first) { first.classList.add('active'); first.style.background = 'var(--accent)'; first.style.color = '#fff'; } }
  try {
    var url = '/api/prompt-logs?limit=20';
    if (type && type !== 'all') url += '&type=' + type;
    var r = await fetch(url, { credentials: 'same-origin' });
    var d = await r.json();
    if (!d.logs || !d.logs.length) { el.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:20px">ยังไม่มี logs</div>'; return; }
    el.innerHTML = d.logs.map(function (log) {
      var icon = log.type === 'image' ? '🎨' : '✍️';
      var time = new Date(log.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
      var promptFull = log.prompt || '';
      var promptPreview = promptFull.slice(0, 120) + (promptFull.length > 120 ? '...' : '');
      var resultPreview = (log.result || '').slice(0, 100) + (log.result && log.result.length > 100 ? '...' : '');
      var thumb = log.image_url ? '<img src="' + insEsc(log.image_url) + '" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.style.display=\'none\'">' : '';
      var meta = [log.model, log.tone, log.aspect_ratio].filter(Boolean).join(' · ');
      var overlayBadge = log.overlay_text ? '<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:rgba(139,92,246,0.15);color:#a78bfa;font-size:0.62rem;margin-left:4px">+ text</span>' : '';
      return '<div class="log-item" data-prompt="' + insEsc(promptFull).replace(/"/g, '&quot;') + '">' +
        '<div style="display:flex;gap:10px;align-items:start">' + thumb +
        '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<span style="font-size:0.72rem;color:var(--text-muted)">' + icon + ' ' + time + overlayBadge + '</span>' +
        '<button onclick="copyLogFull(this)" style="padding:3px 10px;border:1px solid var(--border);border-radius:6px;background:none;color:var(--text-secondary);font-size:0.68rem;cursor:pointer;transition:all 0.2s" onmouseover="this.style.borderColor=\'var(--accent)\';this.style.color=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.color=\'var(--text-secondary)\'">📋 Copy</button>' +
        '</div>' +
        '<div style="font-size:0.78rem;color:var(--text);word-break:break-word;line-height:1.4">' + insEsc(promptPreview) + '</div>' +
        (resultPreview ? '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;line-height:1.3">→ ' + insEsc(resultPreview) + '</div>' : '') +
        (meta ? '<div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;opacity:0.7">' + insEsc(meta) + '</div>' : '') +
        '</div></div></div>';
    }).join('');
  } catch (e) { el.innerHTML = '<div style="color:var(--danger);font-size:0.75rem">Error loading logs</div>'; }
}

export async function savePromptLog(type, prompt, result, model, tone, aspect_ratio, overlay_text, image_url) {
  try { await fetch('/api/prompt-logs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, prompt, result, model, tone, aspect_ratio, overlay_text, image_url }) }); } catch (e) { }
}

export function copyLogFull(btn) {
  var logEl = btn.closest('.log-item');
  var fullPrompt = logEl.getAttribute('data-prompt');
  navigator.clipboard.writeText(fullPrompt).then(function () { btn.textContent = '✓ Copied'; setTimeout(function () { btn.textContent = '📋 Copy'; }, 1500); toast('ok', 'Copied prompt!'); });
}

// --- Text Overlay ---
export function toggleTextOverlay() {
  var checked = document.getElementById('aiTextOverlay').checked;
  document.getElementById('aiTextOverlayArea').style.display = checked ? '' : 'none';
  document.getElementById('aiTextOverlayNote').style.display = checked ? '' : 'none';
}

export function getOverlayText() {
  if (!document.getElementById('aiTextOverlay').checked) return null;
  return document.getElementById('aiOverlayText').value.trim() || null;
}

// --- AI Image Generation ---
export async function generateAiImageAuto() {
  var msg = document.getElementById('message').value.trim();
  if (!msg) { toast('err', 'เขียนข้อความก่อนแล้วค่อยสร้างรูป'); return; }
  var ratio = document.getElementById('aiImageRatio').value;
  var wantOverlay = document.getElementById('aiTextOverlay').checked;
  var overlayText = wantOverlay ? (document.getElementById('aiOverlayText').value.trim() || 'auto') : null;
  var statusEl = document.getElementById('aiImageStatus');
  statusEl.style.display = 'block';
  statusEl.textContent = wantOverlay ? '⏳ AI กำลังสร้างรูป + วาดตัวหนังสือ...' : '⏳ AI กำลังสร้างรูป...';
  showProgress('aiImageProgress');
  try {
    var r = await fetch('/api/ai-image/generate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg, aspect_ratio: ratio, mode: 'auto', overlay_text: overlayText }) });
    var d = await r.json();
    if (d.ok && d.image_url) {
      hideProgress('aiImageProgress', true);
      addAiImageToPreview(d.image_url);
      statusEl.textContent = '✅ สร้างรูปสำเร็จ!';
      setTimeout(function () { statusEl.style.display = 'none'; }, 3000);
      savePromptLog('image', d.prompt || msg, null, d.model || '', null, ratio, overlayText, d.image_url);
    } else { hideProgress('aiImageProgress'); statusEl.textContent = ''; statusEl.style.display = 'none'; toast('err', d.error || 'สร้างรูปไม่สำเร็จ'); }
  } catch (e) { statusEl.style.display = 'none'; toast('err', 'เกิดข้อผิดพลาด: ' + e.message); }
}

export async function generateAiImageSemi() {
  var msg = document.getElementById('message').value.trim();
  if (!msg) { toast('err', 'เขียนข้อความก่อนแล้วค่อยสร้างรูป'); return; }
  var statusEl = document.getElementById('aiImageStatus');
  var promptArea = document.getElementById('aiImagePromptArea');
  statusEl.style.display = 'block';
  statusEl.textContent = '⏳ AI กำลังสร้าง prompt...';
  try {
    var r = await fetch('/api/ai-image/prompt', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg }) });
    var d = await r.json();
    if (d.ok && d.prompt) {
      document.getElementById('aiImagePrompt').value = d.prompt;
      promptArea.style.display = 'block';
      statusEl.textContent = '✏️ แก้ prompt ได้เลย แล้วกด "สร้างรูปจาก Prompt นี้"';
    } else { statusEl.style.display = 'none'; toast('err', d.error || 'สร้าง prompt ไม่สำเร็จ'); }
  } catch (e) { statusEl.style.display = 'none'; toast('err', 'เกิดข้อผิดพลาด: ' + e.message); }
}

export async function confirmGenerateImage() {
  var prompt = document.getElementById('aiImagePrompt').value.trim();
  if (!prompt) { toast('err', 'กรุณาใส่ prompt'); return; }
  var ratio = document.getElementById('aiImageRatio').value;
  var statusEl = document.getElementById('aiImageStatus');
  var btn = document.getElementById('aiImageConfirmBtn');
  btn.disabled = true; btn.textContent = '⏳ กำลังสร้างรูป...';
  statusEl.textContent = '⏳ Gemini กำลังสร้างรูป...';
  try {
    var r = await fetch('/api/ai-image/generate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, aspect_ratio: ratio, mode: 'direct', overlay_text: getOverlayText() }) });
    var d = await r.json();
    if (d.ok && d.image_url) {
      addAiImageToPreview(d.image_url);
      statusEl.textContent = '✅ สร้างรูปสำเร็จ!';
      document.getElementById('aiImagePromptArea').style.display = 'none';
      setTimeout(function () { statusEl.style.display = 'none'; }, 3000);
    } else { toast('err', d.error || 'สร้างรูปไม่สำเร็จ'); }
  } catch (e) { toast('err', 'เกิดข้อผิดพลาด: ' + e.message); }
  btn.disabled = false; btn.textContent = '🎨 สร้างรูปจาก Prompt นี้';
}

function addAiImageToPreview(imageUrl) { showAiImagePreview(imageUrl); }

function showAiImagePreview(imageUrl) {
  var overlay = document.createElement('div');
  overlay.id = 'aiPreviewOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  overlay.innerHTML = '<div style="max-width:500px;width:100%">' +
    '<img id="aiPreviewImg" src="' + insEsc(imageUrl) + '" style="width:100%;max-height:60vh;object-fit:contain;border-radius:12px;border:2px solid rgba(255,255,255,0.1)">' +
    '<div id="aiImgInfo" style="margin-top:8px;text-align:center;font-size:0.72rem;color:rgba(255,255,255,0.5)">กำลังโหลดข้อมูลรูป...</div>' +
    '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
    '<button onclick="acceptAiImage(\'' + insEsc(imageUrl) + '\')" style="flex:1;min-width:100px;padding:10px 16px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-size:0.85rem;font-weight:600;cursor:pointer">✅ ใช้รูปนี้</button>' +
    '<button onclick="rejectAiImage()" style="flex:1;min-width:100px;padding:10px 16px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:8px;font-size:0.85rem;font-weight:600;cursor:pointer">🔄 สร้างใหม่</button>' +
    '<button onclick="closeAiPreview()" style="flex:1;min-width:80px;padding:10px 16px;background:rgba(239,68,68,0.2);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:8px;font-size:0.85rem;font-weight:600;cursor:pointer">✕ ไม่ใช้</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
  overlay.onclick = function (e) { if (e.target === overlay) window.closeAiPreview(); };
  var img = new Image();
  img.onload = function () {
    fetch(imageUrl, { method: 'HEAD' }).then(function (r) {
      var size = r.headers.get('content-length');
      var sizeStr = size ? (size > 1048576 ? (size / 1048576).toFixed(1) + ' MB' : (size / 1024).toFixed(0) + ' KB') : '';
      var el = document.getElementById('aiImgInfo');
      if (el) el.textContent = img.naturalWidth + ' x ' + img.naturalHeight + ' px' + (sizeStr ? ' | ' + sizeStr : '');
    }).catch(function () {
      var el = document.getElementById('aiImgInfo');
      if (el) el.textContent = img.naturalWidth + ' x ' + img.naturalHeight + ' px';
    });
  };
  img.src = imageUrl;
}

export function acceptAiImage(imageUrl) {
  state.uploadedImages.push({ data: imageUrl, name: 'ai-generated.jpg', url: imageUrl, sizeInfo: 'AI', isVideo: false });
  renderImagePreviews();
  state.uploadedImageUrl = imageUrl;
  var dz = document.getElementById('dropZone');
  dz.classList.add('has-file');
  var imgCount = state.uploadedImages.filter(function (i) { return !i.isVideo; }).length;
  var vidCount = state.uploadedImages.filter(function (i) { return i.isVideo; }).length;
  dz.textContent = '✅ ' + (imgCount ? imgCount + ' รูป' : '') + (imgCount && vidCount ? ' + ' : '') + (vidCount ? vidCount + ' วิดีโอ' : '');
  window.closeAiPreview();
}

export function rejectAiImage() { window.closeAiPreview(); generateAiImageAuto(); }
export function closeAiPreview() { var el = document.getElementById('aiPreviewOverlay'); if (el) el.remove(); }

// --- AI Image Templates ---
export async function loadAiImageTemplates() {
  var sel = document.getElementById('aiImageTemplate');
  if (!sel || sel.dataset.loaded === 'yes') return;
  sel.dataset.loaded = 'yes';
  try {
    var templates = [];
    try { var r1 = await fetch('/api/ai-image/snapmingle', { credentials: 'same-origin' }); var d1 = await r1.json(); templates = d1.prompts || d1.templates || []; } catch (e) { }
    if (!templates.length) { try { var r2 = await fetch('/api/ai-image/templates', { credentials: 'same-origin' }); var d2 = await r2.json(); templates = d2.templates || []; } catch (e) { } }
    if (templates.length) { sel.innerHTML = '<option value="">เลือกสไตล์...</option>'; } else { return; }
    templates.forEach(function (t) { var o = document.createElement('option'); o.value = t.id || t.slug || t.name; o.textContent = t.name || t.title; o.title = t.desc || t.prompt || ''; sel.appendChild(o); });
  } catch (e) { }
}

// --- Legacy ---
export async function copyAiPrompt() {
  var msg = document.getElementById('message').value.trim();
  var prompt = msg;
  if (!prompt) { toast('err', 'กรอก keyword ก่อน'); return; }
  var text = prompt;
  try {
    var body = { prompt: prompt.substring(0, 200), generate: false };
    var r = await fetch('/api/ai-image', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { var d = await r.json(); text = d.prompt || prompt; }
  } catch (e) { }
  var pv = document.getElementById('aiPromptPreview');
  pv.textContent = text;
  pv.style.display = 'block';
  try { await navigator.clipboard.writeText(text); showNotify('Copy prompt แล้ว — วางใน Nana Banana Pro ได้เลย!'); } catch (e) { toast('err', 'Copy ไม่สำเร็จ — กด Ctrl+C เอง'); }
}
