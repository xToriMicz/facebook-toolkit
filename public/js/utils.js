// Utility functions — no dependencies on other modules
import state from './state.js';

export function toast(type, msg) {
  const el = document.getElementById('status');
  el.className = 'toast ' + type;
  el.textContent = msg;
  const dur = type === 'err' ? 15000 : 5000;
  setTimeout(() => { el.className = 'toast'; }, dur);
}

export function handleApiError(status, fallback) {
  const errors = {
    429: 'คุณใช้งานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
    401: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
    403: 'คุณไม่มีสิทธิ์ดำเนินการนี้',
    500: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่',
    503: 'ระบบกำลังปรับปรุง กรุณารอสักครู่',
  };
  return errors[status] || fallback || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}

export function insEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function showNotify(msg) {
  const el = document.createElement("div");
  el.textContent = "✅ " + msg;
  Object.assign(el.style, { position: "fixed", top: "16px", right: "16px", zIndex: "200", padding: "14px 20px", borderRadius: "12px", fontSize: "0.9rem", fontWeight: "600", background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)", backdropFilter: "blur(8px)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", transform: "translateX(120%)", transition: "transform 0.3s ease", fontFamily: "Inter,sans-serif" });
  document.body.appendChild(el);
  requestAnimationFrame(function () { el.style.transform = "translateX(0)"; });
  setTimeout(function () { el.style.transform = "translateX(120%)"; setTimeout(function () { el.remove(); }, 400); }, 3000);
}

export function formatBytes(b) {
  return b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(0) + 'KB' : (b / 1048576).toFixed(1) + 'MB';
}

export function showProgress(id) {
  var el = document.getElementById(id); if (!el) return;
  el.classList.add('active');
  var bar = el.querySelector('.bar'); if (!bar) return;
  bar.classList.remove('done'); bar.style.width = '0%';
  var pct = 0; clearInterval(state._progressTimers[id]);
  state._progressTimers[id] = setInterval(function () {
    if (pct < 30) pct += 3; else if (pct < 60) pct += 1.5; else if (pct < 85) pct += 0.5; else if (pct < 95) pct += 0.1;
    bar.style.width = Math.min(pct, 95) + '%';
  }, 300);
}

export function hideProgress(id, success) {
  clearInterval(state._progressTimers[id]);
  var el = document.getElementById(id); if (!el) return;
  var bar = el.querySelector('.bar');
  if (bar && success) { bar.style.width = '100%'; bar.classList.add('done'); setTimeout(function () { el.classList.remove('active'); bar.style.width = '0%'; bar.classList.remove('done'); }, 2000); }
  else { el.classList.remove('active'); if (bar) bar.style.width = '0%'; }
}
