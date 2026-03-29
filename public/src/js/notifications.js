"use strict";
import "./state.js";
import { insEsc as c } from "./utils.js";
var f = {
    login: "\u{1F511}",
    logout: "\u{1F534}",
    post_created: "\u{1F4DD}",
    post_scheduled: "\u23F0",
    draft_saved: "\u{1F4BE}",
    ai_write: "\u{1F916}",
    page_switched: "\u{1F4C4}",
    settings_changed: "\u2699\uFE0F",
    auto_reply: "\u{1F4AC}",
    auto_hide_spam: "\u{1F6AB}",
    outbound_comment: "\u{1F3AF}",
  },
  v = null;
export function initNotifications() {
  var t = document.getElementById("navUser");
  if (!(!t || document.getElementById("notifBell"))) {
    var e = document.createElement("button");
    ((e.id = "notifBell"),
      (e.className = "nav-btn"),
      (e.style.cssText =
        "position:relative;font-size:1.1rem;padding:6px 10px;cursor:pointer;background:none;border:none;color:var(--text)"),
      (e.innerHTML =
        '\u{1F514}<span id="notifBadge" style="display:none;position:absolute;top:2px;right:2px;min-width:16px;height:16px;border-radius:8px;background:#ef4444;color:#fff;font-size:0.6rem;font-weight:700;text-align:center;line-height:16px;padding:0 4px"></span>'),
      (e.onclick = m));
    var o = t.querySelector(".nav-btn");
    o ? t.insertBefore(e, o) : t.appendChild(e);
    var n = document.createElement("div");
    ((n.id = "notifPanel"),
      (n.style.cssText =
        "display:none;position:fixed;top:56px;right:12px;width:min(360px,calc(100vw - 24px));max-height:70vh;background:var(--bg-card,#1a1a2e);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.5);z-index:150;overflow:hidden"),
      (n.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)"><span style="font-size:0.85rem;font-weight:600;color:var(--text)">\u{1F514} \u0E01\u0E32\u0E23\u0E41\u0E08\u0E49\u0E07\u0E40\u0E15\u0E37\u0E2D\u0E19</span><button id="notifMarkRead" onclick="markNotifRead()" style="font-size:0.7rem;color:var(--accent);background:none;border:none;cursor:pointer;padding:4px 8px">\u0E2D\u0E48\u0E32\u0E19\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14</button></div><div id="notifList" style="max-height:calc(70vh - 50px);overflow-y:auto;padding:4px 0"></div>'),
      document.body.appendChild(n),
      document.addEventListener("click", function (a) {
        var i = document.getElementById("notifPanel"),
          r = document.getElementById("notifBell");
        i &&
          i.style.display !== "none" &&
          !i.contains(a.target) &&
          !r.contains(a.target) &&
          (i.style.display = "none");
      }),
      loadNotifications(),
      (v = setInterval(loadNotifications, 6e4)));
  }
}
function m() {
  var t = document.getElementById("notifPanel");
  if (t) {
    var e = t.style.display === "none";
    ((t.style.display = e ? "block" : "none"), e && loadNotifications());
  }
}
export async function loadNotifications() {
  try {
    var t = await fetch("/api/notifications?limit=20", {
        credentials: "same-origin",
      }),
      e = await t.json(),
      o = e.notifications || [],
      n = e.unread || 0,
      a = document.getElementById("notifBadge");
    a &&
      (n > 0
        ? ((a.textContent = n > 99 ? "99+" : String(n)), (a.style.display = ""))
        : (a.style.display = "none"));
    var i = document.getElementById("notifList");
    if (!i) return;
    if (!o.length) {
      i.innerHTML =
        '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.8rem">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E01\u0E32\u0E23\u0E41\u0E08\u0E49\u0E07\u0E40\u0E15\u0E37\u0E2D\u0E19</div>';
      return;
    }
    i.innerHTML = o
      .map(function (r) {
        var l = f[r.action] || "\u{1F4CC}",
          d = !r.read_at,
          s = g(r.created_at),
          p = c((r.detail || "").slice(0, 80));
        return (
          '<div style="padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.03);' +
          (d ? "background:rgba(79,110,247,0.04)" : "") +
          '"><div style="display:flex;gap:10px;align-items:start"><span style="font-size:1rem;flex-shrink:0;margin-top:2px">' +
          l +
          '</span><div style="flex:1;min-width:0"><div style="font-size:0.78rem;color:var(--text);line-height:1.4' +
          (d ? ";font-weight:600" : "") +
          '">' +
          p +
          '</div><div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">' +
          s +
          "</div></div>" +
          (d
            ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:6px"></span>'
            : "") +
          "</div></div>"
        );
      })
      .join("");
  } catch {}
}
export async function markNotifRead() {
  try {
    await fetch("/api/notifications/read", {
      method: "POST",
      credentials: "same-origin",
    });
    var t = document.getElementById("notifBadge");
    (t && (t.style.display = "none"), loadNotifications());
  } catch {}
}
function g(t) {
  var e = Date.now(),
    o = new Date(t).getTime(),
    n = Math.floor((e - o) / 1e3);
  return n < 60
    ? "\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E2A\u0E31\u0E01\u0E04\u0E23\u0E39\u0E48"
    : n < 3600
      ? Math.floor(n / 60) +
        " \u0E19\u0E32\u0E17\u0E35\u0E17\u0E35\u0E48\u0E41\u0E25\u0E49\u0E27"
      : n < 86400
        ? Math.floor(n / 3600) +
          " \u0E0A\u0E31\u0E48\u0E27\u0E42\u0E21\u0E07\u0E17\u0E35\u0E48\u0E41\u0E25\u0E49\u0E27"
        : n < 604800
          ? Math.floor(n / 86400) +
            " \u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E41\u0E25\u0E49\u0E27"
          : new Date(t).toLocaleDateString("th-TH", {
              day: "numeric",
              month: "short",
            });
}
