"use strict";
import p from "./state.js";
import { insEsc as f, showNotify as h } from "./utils.js";
var k = {
    all: "\u0E15\u0E2D\u0E1A\u0E17\u0E38\u0E01 comment",
    random: "\u0E15\u0E2D\u0E1A 60-80% (\u0E2A\u0E38\u0E48\u0E21)",
    question_only:
      "\u0E15\u0E2D\u0E1A\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E04\u0E33\u0E16\u0E32\u0E21",
    off: "\u0E1B\u0E34\u0E14",
  },
  z = {
    formal: "\u{1F3A9} \u0E2A\u0E38\u0E20\u0E32\u0E1E",
    casual:
      "\u{1F60A} \u0E40\u0E1B\u0E47\u0E19\u0E01\u0E31\u0E19\u0E40\u0E2D\u0E07",
    custom: "\u270F\uFE0F \u0E01\u0E33\u0E2B\u0E19\u0E14\u0E40\u0E2D\u0E07",
  },
  S = {
    question: "\u2753",
    praise: "\u{1F44D}",
    experience: "\u{1F4AC}",
    disagree: "\u{1F914}",
    tag_friend: "\u{1F465}",
    emoji: "\u{1F60A}",
    spam: "\u{1F6AB}",
    unclear: "\u2754",
    complaint: "\u{1F4E2}",
    greeting: "\u{1F44B}",
    short_reaction: "\u2728",
    other: "\u{1F4AC}",
    unknown: "\u{1F4AC}",
  },
  F = {
    question: "\u0E16\u0E32\u0E21\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25",
    praise: "\u0E0A\u0E21",
    experience:
      "\u0E41\u0E0A\u0E23\u0E4C\u0E1B\u0E23\u0E30\u0E2A\u0E1A\u0E01\u0E32\u0E23\u0E13\u0E4C",
    disagree:
      "\u0E44\u0E21\u0E48\u0E40\u0E2B\u0E47\u0E19\u0E14\u0E49\u0E27\u0E22",
    tag_friend:
      "\u0E41\u0E17\u0E47\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E19",
    emoji: "emoji",
    spam: "spam",
    unclear: "\u0E44\u0E21\u0E48\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19",
    complaint: "\u0E23\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19",
    greeting: "\u0E17\u0E31\u0E01\u0E17\u0E32\u0E22",
    short_reaction: "\u0E42\u0E15\u0E49\u0E15\u0E2D\u0E1A\u0E2A\u0E31\u0E49\u0E19\u0E46",
    other: "\u0E2D\u0E37\u0E48\u0E19\u0E46",
    unknown: "\u0E2D\u0E37\u0E48\u0E19\u0E46",
  };
export async function loadAutoReplySettings() {
  var t = document.getElementById("autoReplyPageList");
  if (!p.selectedPage) {
    t.innerHTML =
      '<div style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:16px">\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E1E\u0E08\u0E01\u0E48\u0E2D\u0E19</div>';
    return;
  }
  try {
    var e = await fetch(
        "/api/auto-reply/settings?page_id=" + p.selectedPage.id,
        { credentials: "same-origin" },
      ),
      E = await e.json(),
      A = [{ id: p.selectedPage.id, name: p.selectedPage.name }],
      b = {};
    ((b[E.page_id || p.selectedPage.id] = E),
      (t.innerHTML = A.map(function (c) {
        var o = c.id || c.page_id,
          _ = c.name || c.page_name || o,
          r = b[o] || {},
          l = r.enabled === 1 || r.enabled === !0,
          m = r.reply_mode || "all",
          x = r.reply_tone || "formal",
          d = r.skip_greeting === 1 || r.skip_greeting === !0;
        return (
          '<div style="padding:10px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:10px"><div style="display:flex;justify-content:space-between;align-items:center"><div style="min-width:0;flex:1"><div style="font-size:0.82rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          f(_) +
          '</div><div style="font-size:0.65rem;color:var(--text-muted);margin-top:1px">' +
          (l
            ? "\u{1F7E2} " + k[m]
            : "\u26AB \u0E1B\u0E34\u0E14\u0E2D\u0E22\u0E39\u0E48") +
          '</div></div><label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;flex-shrink:0;margin-left:8px"><input type="checkbox" ' +
          (l ? "checked" : "") +
          ` onchange="toggleAutoReplyPage('` +
          o +
          `',this.checked)" style="opacity:0;width:0;height:0"><span style="position:absolute;inset:0;background:` +
          (l ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)") +
          ';border-radius:24px;transition:all 0.3s;border:1px solid var(--border)"></span><span style="position:absolute;top:2px;left:' +
          (l ? "22px" : "2px") +
          ";width:20px;height:20px;border-radius:50%;background:" +
          (l ? "var(--success)" : "var(--text-muted)") +
          ';transition:all 0.3s"></span></label></div>' +
          (l
            ? `<div style="margin-top:6px"><select onchange="changeAutoReplyMode('` +
              o +
              `',this.value)" style="width:100%;padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.72rem;font-family:inherit;color-scheme:dark">` +
              ["all", "random", "question_only", "off"]
                .map(function (i) {
                  return (
                    '<option value="' +
                    i +
                    '"' +
                    (i === m ? " selected" : "") +
                    ">" +
                    k[i] +
                    "</option>"
                  );
                })
                .join("") +
              '</select></div><div style="margin-top:6px"><div style="font-size:0.65rem;color:var(--text-muted);margin-bottom:3px">\u{1F3AD} Tone \u0E01\u0E32\u0E23\u0E15\u0E2D\u0E1A</div><select id="arTone_' +
              o +
              `" onchange="changeAutoReplyTone('` +
              o +
              `',this.value)" style="width:100%;padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.72rem;font-family:inherit;color-scheme:dark">` +
              ["formal", "casual", "custom"]
                .map(function (i) {
                  return (
                    '<option value="' +
                    i +
                    '"' +
                    (i === x ? " selected" : "") +
                    ">" +
                    z[i] +
                    "</option>"
                  );
                })
                .join("") +
              '</select></div><div id="arCustomTone_' +
              o +
              '" style="margin-top:4px;display:' +
              (x === "custom" ? "block" : "none") +
              '"><textarea id="arCustomToneText_' +
              o +
              `" placeholder="\u0E40\u0E0A\u0E48\u0E19: \u0E15\u0E2D\u0E1A\u0E41\u0E1A\u0E1A\u0E19\u0E48\u0E32\u0E23\u0E31\u0E01 \u0E43\u0E0A\u0E49\u0E04\u0E33\u0E25\u0E07\u0E17\u0E49\u0E32\u0E22\u0E27\u0E48\u0E32 \u0E04\u0E48\u0E32~ \u0E43\u0E2A\u0E48 emoji \u0E40\u0E22\u0E2D\u0E30\u0E46" onchange="saveCustomTone('` +
              o +
              `')" style="width:100%;padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.72rem;font-family:inherit;resize:vertical;min-height:50px">` +
              f(r.custom_tone || "") +
              '</textarea></div><div style="margin-top:8px;display:flex;align-items:center;gap:8px"><label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;flex-shrink:0"><input type="checkbox" ' +
              (d ? "checked" : "") +
              ` onchange="toggleSkipGreeting('` +
              o +
              `',this.checked)" style="opacity:0;width:0;height:0"><span style="position:absolute;inset:0;background:` +
              (d ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.1)") +
              ';border-radius:20px;transition:all 0.3s;border:1px solid var(--border)"></span><span style="position:absolute;top:2px;left:' +
              (d ? "18px" : "2px") +
              ";width:16px;height:16px;border-radius:50%;background:" +
              (d ? "var(--warning)" : "var(--text-muted)") +
              ';transition:all 0.3s"></span></label><span style="font-size:0.72rem;color:var(--text-secondary)">\u{1F6AB} \u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A greeting (\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35/\u0E17\u0E31\u0E01\u0E17\u0E32\u0E22)</span></div>'
            : "") +
          "</div>"
        );
      }).join("")),
      loadAutoReplyHistory());
  } catch {
    t.innerHTML =
      '<div style="color:var(--danger);font-size:0.72rem">\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08</div>';
  }
}
export async function toggleAutoReplyPage(t, e) {
  try {
    (await fetch("/api/auto-reply/settings", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page_id: t,
        enabled: e,
        reply_mode: e ? "all" : "off",
      }),
    }),
      h(
        e
          ? "\u0E40\u0E1B\u0E34\u0E14 Auto Reply \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08!"
          : "\u0E1B\u0E34\u0E14 Auto Reply \u0E41\u0E25\u0E49\u0E27",
      ),
      loadAutoReplySettings());
  } catch {}
}
export async function changeAutoReplyMode(t, e) {
  try {
    (await fetch("/api/auto-reply/settings", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: t, enabled: e !== "off", reply_mode: e }),
    }),
      h(
        "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19 mode \u0E40\u0E1B\u0E47\u0E19 " +
          k[e],
      ),
      loadAutoReplySettings());
  } catch {}
}
export async function changeAutoReplyTone(t, e) {
  var E = document.getElementById("arCustomTone_" + t);
  E && (E.style.display = e === "custom" ? "block" : "none");
  try {
    (await fetch("/api/auto-reply/settings", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: t, reply_tone: e }),
    }),
      h(
        "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19 tone \u0E40\u0E1B\u0E47\u0E19 " +
          z[e],
      ));
  } catch {}
}
export async function saveCustomTone(t) {
  var e = document.getElementById("arCustomToneText_" + t);
  if (e)
    try {
      (await fetch("/api/auto-reply/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_id: t, custom_tone: e.value }),
      }),
        h(
          "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01 custom tone \u0E41\u0E25\u0E49\u0E27",
        ));
    } catch {}
}
export async function toggleSkipGreeting(t, e) {
  try {
    (await fetch("/api/auto-reply/settings", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: t, skip_greeting: e }),
    }),
      h(
        e
          ? "\u0E1B\u0E34\u0E14\u0E15\u0E2D\u0E1A greeting \u0E41\u0E25\u0E49\u0E27"
          : "\u0E40\u0E1B\u0E34\u0E14\u0E15\u0E2D\u0E1A greeting \u0E41\u0E25\u0E49\u0E27",
      ));
  } catch {}
}
export async function loadAutoReplyHistory() {
  loadAutoReplyStats();
  var t = document.getElementById("autoReplyHistoryList");
  if (!p.selectedPage) {
    t.innerHTML =
      '<div style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:16px">\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E1E\u0E08\u0E01\u0E48\u0E2D\u0E19</div>';
    return;
  }
  try {
    var e = document.getElementById("arDateFilter"),
      E = e ? e.value : "",
      A = "/api/auto-reply/history?limit=50" + (E ? "&date=" + E : ""),
      b = await fetch(A, { credentials: "same-origin" }),
      c = await b.json(),
      o = (c.replies || []).filter(function (u) {
        return u.page_id === p.selectedPage.id;
      }),
      _ = new Date(),
      r = _.toISOString().slice(0, 10),
      l = new Date(_.getTime() - 7 * 864e5).toISOString(),
      m = o.filter(function (u) {
        return u.status === "replied";
      }),
      x = document.getElementById("arStatTotal"),
      d = document.getElementById("arStatToday"),
      i = document.getElementById("arStatWeek");
    if (
      (x && (x.textContent = m.length),
      d &&
        (d.textContent = m.filter(function (u) {
          return (u.created_at || "").startsWith(r);
        }).length),
      i &&
        (i.textContent = m.filter(function (u) {
          return (u.created_at || "") >= l;
        }).length),
      !o.length)
    ) {
      t.innerHTML =
        '<div style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:16px">\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34</div>';
      return;
    }
    var w = {},
      B = [];
    o.forEach(function (u) {
      var g = (u.created_at || "").slice(0, 10);
      w[g] || ((w[g] = { posts: {}, postOrder: [] }), B.push(g));
      var n = u.post_id || "unknown",
        y = w[g];
      (y.posts[n] ||
        ((y.posts[n] = {
          post_id: n,
          post_message: u.post_message || "",
          post_date: u.post_created_at || "",
          items: [],
        }),
        y.postOrder.push(n)),
        y.posts[n].items.push(u));
    });
    var j = 0;
    t.innerHTML = B.map(function (u, g) {
      var n = w[u],
        y = new Date(u + "T00:00:00").toLocaleDateString("th-TH", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        O = n.postOrder.reduce(function (v, s) {
          return v + n.posts[s].items.length;
        }, 0),
        T = "arDate" + g;
      return (
        `<div style="margin-bottom:10px"><div onclick="var c=document.getElementById('` +
        T +
        `');var a=this.querySelector('.ar-arrow');if(c.style.display==='none'){c.style.display='block';a.textContent='\u25BC'}else{c.style.display='none';a.textContent='\u25B6'}" style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;border-bottom:1px solid var(--border)"><span class="ar-arrow" style="font-size:0.6rem;color:var(--text-muted)">\u25BC</span><span style="font-size:0.82rem;font-weight:700;color:var(--text)">\u{1F4C5} ` +
        y +
        '</span><span style="font-size:0.62rem;color:var(--text-muted)">' +
        O +
        " \u0E04\u0E2D\u0E21\u0E40\u0E21\u0E49\u0E19 \xB7 " +
        n.postOrder.length +
        ' \u0E42\u0E1E\u0E2A</span></div><div id="' +
        T +
        '">' +
        n.postOrder
          .map(function (v) {
            var s = n.posts[v],
              P = s.post_message
                ? f(s.post_message.slice(0, 50)) +
                  (s.post_message.length > 50 ? "..." : "")
                : "\u0E42\u0E1E\u0E2A",
              D = s.post_date
                ? new Date(s.post_date).toLocaleDateString("th-TH", {
                    day: "numeric",
                    month: "short",
                  })
                : "",
              H =
                v !== "unknown"
                  ? '<a href="https://facebook.com/' +
                    v +
                    '" target="_blank" rel="noopener" style="font-size:0.65rem;color:var(--accent);text-decoration:none;flex-shrink:0;padding:2px 8px;border:1px solid var(--accent);border-radius:6px" onclick="event.stopPropagation()">\u{1F517} \u0E14\u0E39\u0E42\u0E1E\u0E2A</a>'
                  : "",
              C = "arGroup" + j++;
            return (
              `<div style="margin:6px 0 6px 12px;border:1px solid var(--border);border-radius:8px;overflow:hidden"><div onclick="var c=document.getElementById('` +
              C +
              `');var a=this.querySelector('.ar-arrow');if(c.style.display==='none'){c.style.display='block';a.textContent='\u25BC'}else{c.style.display='none';a.textContent='\u25B6'}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:rgba(255,255,255,0.02);cursor:pointer"><div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1"><span class="ar-arrow" style="font-size:0.55rem;color:var(--text-muted);flex-shrink:0">\u25BC</span><span style="font-size:0.72rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u{1F4DD} ` +
              P +
              '</span><span style="font-size:0.6rem;color:var(--text-muted);flex-shrink:0">' +
              s.items.length +
              " \u0E04\u0E2D\u0E21\u0E40\u0E21\u0E49\u0E19" +
              (D ? " | \u{1F4C5} " + D : "") +
              "</span></div>" +
              H +
              '</div><div id="' +
              C +
              '" style="padding:0 10px 6px">' +
              s.items
                .map(function (a) {
                  var I = S[a.comment_type] || "\u{1F4AC}",
                    L = F[a.comment_type] || a.comment_type,
                    R = new Date(a.created_at).toLocaleString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: !1,
                    }),
                    M =
                      a.status === "replied"
                        ? '<span style="color:var(--success);font-size:0.62rem">\u2705</span>'
                        : a.status === "hidden"
                          ? '<span style="color:var(--warning);font-size:0.62rem">\u{1F6AB}</span>'
                          : a.status === "already_replied"
                            ? '<span style="color:var(--text-muted);font-size:0.62rem">\u2705</span>'
                            : a.status === "skipped"
                              ? '<span style="color:var(--text-muted);font-size:0.62rem">\u23ED\uFE0F</span>'
                              : '<span style="color:var(--danger);font-size:0.62rem">\u274C</span>';
                  return (
                    '<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.75rem"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px"><span style="font-size:0.66rem;color:var(--text-muted)">' +
                    I +
                    " " +
                    L +
                    " \u2014 " +
                    (a.comment_from ||
                      "\u0E44\u0E21\u0E48\u0E17\u0E23\u0E32\u0E1A") +
                    '</span><span style="font-size:0.62rem;color:var(--text-muted)">' +
                    R +
                    " " +
                    M +
                    '</span></div><div style="color:var(--text-secondary);font-size:0.7rem;margin-bottom:2px">\u{1F4AD} ' +
                    f((a.comment_text || "").slice(0, 100)) +
                    "</div>" +
                    (a.reply_text
                      ? '<div style="color:var(--text);font-size:0.7rem;padding:3px 8px;background:rgba(79,110,247,0.06);border-radius:6px;margin-top:2px">\u2192 ' +
                        f(a.reply_text.slice(0, 150)) +
                        "</div>"
                      : "") +
                    "</div>"
                  );
                })
                .join("") +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      );
    }).join("");
  } catch {
    t.innerHTML =
      '<div style="color:var(--danger);font-size:0.72rem">\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08</div>';
  }
}

export async function loadAutoReplyStats() {
  var card = document.getElementById("arReportsCard");
  if (!p.selectedPage) {
    if (card) card.style.display = "none";
    return;
  }
  try {
    var res = await fetch("/api/auto-reply/stats?page_id=" + p.selectedPage.id, { credentials: "same-origin" });
    if (!res.ok) {
      if (card) card.style.display = "none";
      return;
    }
    var data = await res.json();
    if (card) card.style.display = "block";

    // 1. Process Daily Stacked Column Chart
    var dailyChart = document.getElementById("arDailyChart");
    var totalProcessedEl = document.getElementById("arTotalProcessed");
    if (dailyChart) {
      var days = [];
      for (var i = 6; i >= 0; i--) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
      }

      var maxTotal = 0;
      var dailyData = days.map(function (date) {
        var replied = 0, skipped = 0, failed = 0;
        (data.daily || []).forEach(function (row) {
          if (row.date === date) {
            if (row.status === "replied") replied = row.count;
            else if (row.status === "skipped") skipped = row.count;
            else if (row.status === "failed") failed = row.count;
          }
        });
        var total = replied + skipped + failed;
        if (total > maxTotal) maxTotal = total;
        return { date: date, replied: replied, skipped: skipped, failed: failed, total: total };
      });

      var grandTotal = dailyData.reduce(function (acc, val) { return acc + val.total; }, 0);
      if (totalProcessedEl) {
        totalProcessedEl.textContent = "ประมวลผล " + grandTotal + " รายการ";
      }

      var dailyHtml = dailyData.map(function (d) {
        var formattedDate = d.date.slice(8, 10) + "/" + d.date.slice(5, 7); // e.g. 02/07
        var height = maxTotal > 0 ? (d.total / maxTotal) * 80 : 0; // scale up to 80px max

        var pReplied = d.total > 0 ? (d.replied / d.total) * 100 : 0;
        var pSkipped = d.total > 0 ? (d.skipped / d.total) * 100 : 0;
        var pFailed = d.total > 0 ? (d.failed / d.total) * 100 : 0;

        var barStyle = "height:" + height + "px;width:24px;background:rgba(255,255,255,0.03);border-radius:4px 4px 0 0;overflow:hidden;display:flex;flex-direction:column-reverse;margin-bottom:4px;";

        var segments = "";
        if (d.replied > 0) segments += '<div style="height:' + pReplied + '%;background:#22c55e;" title="ตอบกลับ: ' + d.replied + '"></div>';
        if (d.skipped > 0) segments += '<div style="height:' + pSkipped + '%;background:#eab308;" title="ข้าม: ' + d.skipped + '"></div>';
        if (d.failed > 0) segments += '<div style="height:' + pFailed + '%;background:#ef4444;" title="ล้มเหลว: ' + d.failed + '"></div>';

        return (
          '<div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;position:relative;">' +
          '<div class="chart-bar-val" style="font-size:0.6rem;font-weight:700">' + (d.total > 0 ? d.total : "") + "</div>" +
          '<div style="' + barStyle + '">' + segments + "</div>" +
          '<div style="font-size:0.55rem;color:var(--text-muted);margin-top:2px;">' + formattedDate + "</div>" +
          "</div>"
        );
      }).join("");

      dailyChart.innerHTML = dailyHtml;
    }

    // 2. Process Comment Type Distribution List
    var typesList = document.getElementById("arTypesList");
    if (typesList) {
      var types = data.types || [];
      var maxTypeCount = types.length > 0 ? types[0].count : 0;
      var totalTypeCount = types.reduce(function (acc, val) { return acc + val.count; }, 0);

      var typesHtml = "";
      if (types.length === 0) {
        typesHtml = '<div style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:16px">ไม่มีข้อมูลประเภทคอมเมนต์</div>';
      } else {
        typesHtml = types.map(function (t) {
          var pct = totalTypeCount > 0 ? ((t.count / totalTypeCount) * 100).toFixed(0) : 0;
          var barWidth = maxTypeCount > 0 ? (t.count / maxTypeCount) * 100 : 0;
          var icon = S[t.comment_type] || "💬";
          var name = F[t.comment_type] || t.comment_type;

          return (
            '<div style="display:flex;flex-direction:column;gap:3px;font-size:0.7rem;">' +
            '<div style="display:flex;justify-content:space-between;color:var(--text-secondary);font-weight:600">' +
            "<span>" + icon + " " + name + "</span>" +
            "<span>" + t.count + " ครั้ง (" + pct + "%)</span>" +
            "</div>" +
            '<div style="height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden">' +
            '<div style="height:100%;width:' + barWidth + '%;background:var(--accent);border-radius:3px"></div>' +
            "</div>" +
            "</div>"
          );
        }).join("");
      }
      typesList.innerHTML = typesHtml;
    }
  } catch (err) {
    if (card) card.style.display = "none";
  }
}
