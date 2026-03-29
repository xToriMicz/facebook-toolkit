"use strict";
import d from "./state.js";
import { toast as c, insEsc as p, showNotify as l } from "./utils.js";
var g = {
    formal: "\u{1F3A9} \u0E2A\u0E38\u0E20\u0E32\u0E1E",
    casual:
      "\u{1F60A} \u0E40\u0E1B\u0E47\u0E19\u0E01\u0E31\u0E19\u0E40\u0E2D\u0E07",
    custom: "\u270F\uFE0F \u0E01\u0E33\u0E2B\u0E19\u0E14\u0E40\u0E2D\u0E07",
  },
  m = {
    pending: "\u23F3 \u0E23\u0E2D approve",
    approved: "\u2705 approved",
    sent: "\u{1F4E4} \u0E2A\u0E48\u0E07\u0E41\u0E25\u0E49\u0E27",
    failed: "\u274C \u0E25\u0E49\u0E21\u0E40\u0E2B\u0E25\u0E27",
    skipped: "\u23ED\uFE0F \u0E02\u0E49\u0E32\u0E21",
    rejected: "\u{1F6AB} \u0E44\u0E21\u0E48\u0E2A\u0E48\u0E07",
  },
  v = {
    pending: "var(--warning)",
    approved: "var(--accent)",
    sent: "var(--success)",
    failed: "var(--danger)",
    skipped: "var(--text-muted)",
    rejected: "var(--text-muted)",
  };
export async function addTargetPage() {
  var t = document.getElementById("outTargetInput"),
    a = (t.value || "").trim();
  if (!a) {
    c(
      "err",
      "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48 URL \u0E2B\u0E23\u0E37\u0E2D Page ID",
    );
    return;
  }
  if (!d.selectedPage) {
    c(
      "err",
      "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E1E\u0E08\u0E01\u0E48\u0E2D\u0E19",
    );
    return;
  }
  var i = a;
  try {
    var o = new URL(a),
      e = o.pathname.replace(/^\//, "").replace(/\/$/, "");
    e && (i = e);
  } catch {}
  var r = document.getElementById("outTargetStatus");
  ((r.textContent =
    "\u23F3 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E1E\u0E34\u0E48\u0E21..."),
    (r.className = "toast"));
  try {
    var s = await fetch("/api/outbound/targets", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_id: d.selectedPage.id, target_page_id: i }),
      }),
      n = await s.json();
    n.ok
      ? ((r.textContent = ""),
        (r.className = "toast"),
        (t.value = ""),
        l(
          "\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E40\u0E1E\u0E08\u0E40\u0E1B\u0E49\u0E32\u0E2B\u0E21\u0E32\u0E22\u0E41\u0E25\u0E49\u0E27!",
        ),
        loadTargetPages())
      : ((r.textContent =
          n.error ||
          "\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08"),
        (r.className = "toast err"));
  } catch (u) {
    ((r.textContent = "Error: " + u.message), (r.className = "toast err"));
  }
}
export async function loadTargetPages() {
  var t = document.getElementById("outTargetList");
  if (!d.selectedPage) {
    t.innerHTML =
      '<div class="empty-state">\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E1E\u0E08\u0E01\u0E48\u0E2D\u0E19</div>';
    return;
  }
  try {
    var a = await fetch("/api/outbound/targets?page_id=" + d.selectedPage.id, {
        credentials: "same-origin",
      }),
      i = await a.json(),
      o = i.targets || [];
    if (!o.length) {
      t.innerHTML =
        '<div class="empty-state">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E40\u0E1E\u0E08\u0E40\u0E1B\u0E49\u0E32\u0E2B\u0E21\u0E32\u0E22</div>';
      return;
    }
    t.innerHTML = o
      .map(function (e) {
        var r = e.comment_tone || "casual",
          s = e.enabled === 1 || e.enabled === !0;
        return (
          '<div style="padding:10px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:10px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:center"><div style="min-width:0;flex:1"><div style="font-size:0.82rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u{1F3AF} ' +
          p(e.target_page_name || e.target_page_id) +
          '</div><div style="font-size:0.65rem;color:var(--text-muted);margin-top:1px">' +
          (s
            ? "\u{1F7E2} " +
              ({"all":"\u0E17\u0E38\u0E01\u0E42\u0E1E\u0E2A","random":"\u0E1A\u0E32\u0E07\u0E42\u0E1E\u0E2A","one":"\u0E42\u0E1E\u0E2A\u0E40\u0E14\u0E35\u0E22\u0E27/\u0E27\u0E31\u0E19"}[e.reply_mode||"all"] || "\u0E17\u0E38\u0E01\u0E42\u0E1E\u0E2A")
            : "\u26AB \u0E1B\u0E34\u0E14\u0E2D\u0E22\u0E39\u0E48") +
          (e.last_commented_at
            ? " \xB7 \u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14: " +
              new Date(e.last_commented_at).toLocaleDateString("th-TH", {
                day: "numeric",
                month: "short",
              })
            : "") +
          '</div></div><div style="display:flex;gap:6px;align-items:center;flex-shrink:0"><label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer"><input type="checkbox" ' +
          (s ? "checked" : "") +
          ' onchange="toggleTargetPage(' +
          e.id +
          ',this.checked)" style="opacity:0;width:0;height:0"><span style="position:absolute;inset:0;background:' +
          (s ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)") +
          ';border-radius:20px;transition:all 0.3s;border:1px solid var(--border)"></span><span style="position:absolute;top:2px;left:' +
          (s ? "18px" : "2px") +
          ";width:16px;height:16px;border-radius:50%;background:" +
          (s ? "var(--success)" : "var(--text-muted)") +
          ';transition:all 0.3s"></span></label><button onclick="removeTargetPage(' +
          e.id +
          ')" style="background:none;border:1px solid rgba(239,68,68,0.3);color:#ef4444;padding:3px 8px;border-radius:6px;font-size:0.68rem;cursor:pointer">\u2715</button></div></div>' +
          (s
            ? '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><select onchange="updateTargetMode(' +
              e.id +
              ',this.value)" style="padding:4px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.7rem;font-family:inherit;color-scheme:dark">' +
              [["all","\u0E17\u0E38\u0E01\u0E42\u0E1E\u0E2A"],["random","\u0E1A\u0E32\u0E07\u0E42\u0E1E\u0E2A"],["one","\u0E42\u0E1E\u0E2A\u0E40\u0E14\u0E35\u0E22\u0E27/\u0E27\u0E31\u0E19"]]
                .map(function (n) {
                  return (
                    '<option value="' +
                    n[0] +
                    '"' +
                    (n[0] === (e.reply_mode || "all") ? " selected" : "") +
                    ">" +
                    n[1] +
                    "</option>"
                  );
                })
                .join("") +
              "</select></div>"
            : "") +
          "</div>"
        );
      })
      .join("");
  } catch {
    t.innerHTML =
      '<div class="empty-state">\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08</div>';
  }
}
export async function toggleTargetPage(t, a) {
  try {
    (await fetch("/api/outbound/targets/" + t, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: a }),
    }),
      loadTargetPages());
  } catch {}
}
export async function removeTargetPage(t) {
  try {
    (await fetch("/api/outbound/targets/" + t, {
      method: "DELETE",
      credentials: "same-origin",
    }),
      l(
        "\u0E25\u0E1A\u0E40\u0E1E\u0E08\u0E40\u0E1B\u0E49\u0E32\u0E2B\u0E21\u0E32\u0E22\u0E41\u0E25\u0E49\u0E27",
      ),
      loadTargetPages());
  } catch {}
}
export async function updateTargetTone(t, a) {
  try {
    await fetch("/api/outbound/targets/" + t, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment_tone: a }),
    });
  } catch {}
}
export async function updateTargetMaxDay(t, a) {
  try {
    await fetch("/api/outbound/targets/" + t, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_per_day: parseInt(a) }),
    });
  } catch {}
}
export async function updateTargetMode(t, a) {
  try {
    await fetch("/api/outbound/targets/" + t, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply_mode: a }),
    });
    loadTargetPages();
  } catch {}
}
export async function loadOutboundQueue() {
  var t = document.getElementById("outApprovalQueue");
  if (!d.selectedPage) {
    t.innerHTML =
      '<div class="empty-state">\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E1E\u0E08\u0E01\u0E48\u0E2D\u0E19</div>';
    return;
  }
  try {
    var a = await fetch(
        "/api/outbound/queue?page_id=" + d.selectedPage.id + "&status=pending",
        { credentials: "same-origin" },
      ),
      i = await a.json(),
      o = i.comments || [];
    if (!o.length) {
      t.innerHTML =
        '<div class="empty-state">\u0E44\u0E21\u0E48\u0E21\u0E35 comment \u0E23\u0E2D approve</div>';
      return;
    }
    t.innerHTML = o
      .map(function (e) {
        var r = new Date(e.created_at).toLocaleString("th-TH", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: !1,
        });
        return (
          '<div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:var(--bg-input)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:0.72rem;color:var(--accent);font-weight:600">\u{1F3AF} ' +
          p(e.target_page_name || e.target_page_id) +
          '</span><span style="font-size:0.65rem;color:var(--text-muted)">' +
          r +
          '</span></div><div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;padding:4px 8px;background:var(--bg);border-radius:4px">\u{1F4DD} \u0E42\u0E1E\u0E2A: ' +
          p((e.post_message || "").slice(0, 80)) +
          '</div><div style="margin-bottom:8px"><textarea id="outEdit_' +
          e.id +
          '" style="width:100%;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.82rem;font-family:inherit;resize:vertical;min-height:50px">' +
          p(e.comment_text) +
          '</textarea></div><div style="display:flex;gap:6px"><button onclick="approveOutbound(' +
          e.id +
          ')" class="btn btn-accent" style="padding:6px 14px;font-size:0.78rem">\u2705 Approve</button><button onclick="rejectOutbound(' +
          e.id +
          ')" style="padding:6px 14px;border:1px solid rgba(239,68,68,0.3);color:#ef4444;background:none;border-radius:8px;font-size:0.78rem;cursor:pointer">\u{1F6AB} \u0E44\u0E21\u0E48\u0E2A\u0E48\u0E07</button></div></div>'
        );
      })
      .join("");
  } catch {
    t.innerHTML =
      '<div class="empty-state">\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08</div>';
  }
}
export async function approveOutbound(t) {
  var a = document.getElementById("outEdit_" + t),
    i = a ? a.value.trim() : "";
  try {
    var o = await fetch("/api/outbound/queue/" + t + "/approve", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment_text: i || void 0 }),
      }),
      e = await o.json();
    e.ok
      ? (l(
          "Approve \u0E41\u0E25\u0E49\u0E27 \u2014 \u0E08\u0E30\u0E2A\u0E48\u0E07 comment \u0E43\u0E19 cron \u0E16\u0E31\u0E14\u0E44\u0E1B",
        ),
        loadOutboundQueue())
      : c("err", e.error || "Error");
  } catch (r) {
    c("err", r.message);
  }
}
export async function rejectOutbound(t) {
  try {
    (await fetch("/api/outbound/queue/" + t + "/reject", {
      method: "POST",
      credentials: "same-origin",
    }),
      l(
        "\u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18 comment \u0E41\u0E25\u0E49\u0E27",
      ),
      loadOutboundQueue());
  } catch {}
}
export async function loadOutboundHistory() {
  var t = document.getElementById("outHistoryList");
  if (!d.selectedPage) {
    t.innerHTML =
      '<div class="empty-state">\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E1E\u0E08\u0E01\u0E48\u0E2D\u0E19</div>';
    return;
  }
  try {
    var a = await fetch("/api/outbound/history?page_id=" + d.selectedPage.id, {
        credentials: "same-origin",
      }),
      i = await a.json(),
      o = i.comments || [];
    if (!o.length) {
      t.innerHTML =
        '<div class="empty-state">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34</div>';
      return;
    }
    t.innerHTML = o
      .map(function (e) {
        var r = new Date(e.created_at).toLocaleString("th-TH", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: !1,
          }),
          s = v[e.status] || "var(--text-muted)",
          n = m[e.status] || e.status;
        return (
          '<div style="padding:8px 10px;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px"><span style="font-size:0.72rem;color:var(--accent)">\u{1F3AF} ' +
          p(e.target_page_name || e.target_page_id) +
          '</span><span style="font-size:0.62rem;color:' +
          s +
          '">' +
          n +
          '</span></div><div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:2px">\u{1F4AD} ' +
          p((e.post_message || "").slice(0, 60)) +
          '</div><div style="font-size:0.75rem;color:var(--text);padding:3px 8px;background:rgba(79,110,247,0.06);border-radius:6px">\u2192 ' +
          p((e.comment_text || "").slice(0, 120)) +
          '</div><div style="font-size:0.62rem;color:var(--text-muted);margin-top:2px">' +
          r +
          "</div></div>"
        );
      })
      .join("");
  } catch {
    t.innerHTML =
      '<div class="empty-state">\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08</div>';
  }
}
export function initOutbound() {
  (loadTargetPages(), loadOutboundQueue(), loadOutboundHistory());
}
