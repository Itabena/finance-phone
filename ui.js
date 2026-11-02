// The phone app's own screens (PLAN-44). Drawn from payload.phone (finance/sync/phone_data.py), never from PC pages.
// Rule: every tab fits on one screen; anything longer opens in a bottom sheet.
let D = null, C = null;               // data, context from app.js
const $ = (sel, root = document) => root.querySelector(sel);

// ---------------------------------------------------------------- small helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const ils = (v, sign = false) => v == null ? "—" : (v < 0 ? "−" : sign && v > 0 ? "+" : "") + "₪" + Math.round(Math.abs(v)).toLocaleString("en-US");
const SYM = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
const money = (v, cur) => v == null ? "—" : (SYM[cur || "ILS"] || (cur + " ")) + Math.round(v).toLocaleString("en-US");
const pct = (v, d = 0) => v == null ? "—" : (v * 100).toFixed(d) + "%";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymLabel = ym => ym ? `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : "—";
const bdi = t => h("bdi", {}, t || "");
const GROUP_COLOR = { need: "var(--need)", want: "var(--want)", saving: "var(--save)" };
const ICON = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
  budget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15z"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19h16M6 16V10M10 16V7M14 16v-5M18 16V5"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
};

// ---------------------------------------------------------------- bottom sheets
const sheets = [];
export function sheet(title, build, opts = {}) {
  const root = $("#sheet-root");
  const back = h("div", { class: "backdrop" });
  const body = h("div", { class: "body" });
  const close = () => { back.remove(); panel.remove(); sheets.splice(sheets.indexOf(api), 1); opts.onclose && opts.onclose(); };
  const panel = h("section", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "grab" }),
    h("header", {}, h("h2", {}, title), h("button", { class: "icon-btn", "aria-label": "Close", onclick: close }, "✕")),
    body);
  back.addEventListener("click", close);
  // swipe down on the grab bar or header closes it
  let y0 = null;
  panel.addEventListener("touchstart", e => { if (body.scrollTop <= 0 && !e.target.closest("input, select")) y0 = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener("touchmove", e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) panel.style.transform = `translateY(${dy}px)`; }, { passive: true });
  panel.addEventListener("touchend", e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (dy > 90) close(); else panel.style.transform = ""; });
  root.append(back, panel);
  const api = { close, body, panel };
  sheets.push(api);
  build(body, api);
  return api;
}
export function closeAllSheets() { while (sheets.length) sheets[sheets.length - 1].close(); }

// ---------------------------------------------------------------- tabs
const TABS = [["today", "Today"], ["budget", "Budget"], ["review", "Review"], ["money", "Money"], ["send", "Send"]];
let current = "today";
let budgetMonth = null;

export function mount(data, ctx) {
  D = data; C = ctx;
  if (!budgetMonth || !(D.months || []).includes(budgetMonth)) budgetMonth = (D.months || []).slice(-1)[0] || null;
  const tabbar = $("#tabbar"); tabbar.innerHTML = "";
  for (const [id, label] of TABS) {
    const b = h("button", { "data-tab": id, onclick: () => go(id), "aria-label": label }, h("span", { html: ICON[id] }), label);
    if (id === "review") b.append(h("span", { class: "badge", id: "review-badge", hidden: true }));
    tabbar.append(b);
  }
  const views = $("#views"); views.innerHTML = "";
  for (const [id] of TABS) views.append(h("div", { class: "view", id: `v-${id}`, hidden: true }));
  const t = D.turtle || {};
  if (t.img && t.img[t.mood || "calm"]) $("#turtle").src = t.img[t.mood || "calm"];
  renderAll();
  go(current);
}
function go(id) {
  current = id; closeAllSheets();
  for (const [t] of TABS) {
    $(`#v-${t}`).hidden = t !== id;
    $(`#tabbar [data-tab="${t}"]`).classList.toggle("on", t === id);
  }
  $(`#v-${id}`).scrollTop = 0;
}
function renderAll() { renderToday(); renderBudget(); renderReview(); renderMoney(); renderSend(); }

// ================================================================ TODAY
function renderToday() {
  const v = $("#v-today"); v.innerHTML = "";
  const ym = (D.months || []).slice(-1)[0];
  const m = ym && D.budget[ym];
  const t = D.turtle || {};
  if (t.says) v.append(h("div", { class: "says small muted" }, t.says));
  if (m) {
    const out = m.spending || 0, inc = m.income || 0, commit = m.commitment || 0;
    const plan = Math.max(inc - commit, 1);
    const left = inc - commit - out;
    v.append(h("div", { class: "card tap", onclick: () => { budgetMonth = ym; go("budget"); } },
      h("div", { class: "kicker" }, ym === thisMonth() ? "This month so far" : `Last full month · ${ymLabel(ym)}`),
      h("div", { class: "donut-row", style: "grid-template-columns:96px 1fr;margin-top:6px" },
        ring(out / plan, left < 0),
        h("div", {},
          h("div", { class: "muted small" }, left >= 0 ? "Left after saving" : "Over plan by"),
          h("div", { class: "big num" }, ils(Math.abs(left))),
          h("div", { class: "small muted num", style: "margin-top:4px" }, `Spent ${ils(out)} of ${ils(plan)}`)))));
    // over-cap chips
    const over = [];
    for (const g of m.groups) for (const c of g.cats) if (c.cap && c.value > c.cap) over.push({ ...c, group: g.id });
    over.sort((a, b) => (b.value - b.cap) - (a.value - a.cap));
    // savings line
    const met = (m.saving || 0) >= (commit || 0) && commit > 0;
    v.append(h("div", { class: "card" },
      h("div", { class: "row", style: "min-height:auto" },
        h("span", { class: "grow" }, h("div", { class: "kicker" }, "Saved"), h("div", { class: "mid num" }, ils(m.saving))),
        commit ? h("span", { class: met ? "pill" : "pill warn" }, met ? `✓ commitment ${ils(commit)}` : `commitment ${ils(commit)}`) : null),
      over.length ? h("div", { class: "chips one-line", style: "margin-top:10px" },
        over.slice(0, 3).map(c => h("button", { class: "chip warn", onclick: () => categorySheet(ym, c.name) },
          bdi(c.name), h("span", { class: "num" }, ils(c.value - c.cap, true))))) : null));
  } else {
    v.append(h("div", { class: "card" }, h("div", { class: "kicker" }, "This month"), h("p", { class: "muted" }, "No spending imported yet — import a bank or card export on the PC.")));
  }
  // routine: next 3
  const r = D.routine;
  if (r) {
    const all = [...r.tasks.month, ...r.tasks.quarter, ...r.tasks.year];
    const open = all.filter(x => !x.done && !C.isTicked(x.key));
    const card = h("div", { class: "card" },
      h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "kicker grow" }, "Routine"),
        h("span", { class: open.length ? "pill warn" : "pill" }, open.length ? `${open.length} left` : "all done")));
    const list = h("div", { class: "list" });
    for (const x of open.slice(0, 3)) list.append(routineRow(x));
    if (!open.length) list.append(h("div", { class: "row muted small" }, "Nothing left this month, quarter or year."));
    card.append(list, h("button", { class: "see-all", onclick: routineSheet }, "See the whole routine"));
    v.append(card);
  }
  // waiting for the PC
  const todo = D.pc_todo || [];
  if (todo.length) v.append(h("button", { class: "big-btn", onclick: pcSheet },
    h("div", { class: "row", style: "min-height:auto" },
      h("span", { class: "grow" }, "Waiting for the PC", h("div", { class: "small muted", style: "font-weight:400" }, `${todo.length} thing(s), about ${todo.reduce((s, t) => s + (t.minutes || 0), 0)} min`)),
      h("span", { class: "muted" }, "›"))));
}
function thisMonth() { return (D.today || "").slice(0, 7); }
function ring(frac, over) {
  const r = 46, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
  return h("div", { class: "ring", html: `<svg viewBox="0 0 110 110" width="96" height="96" role="img" aria-label="${Math.round(f * 100)}% of the plan spent">
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="var(--line)" stroke-width="12"/>
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="${over ? "var(--warn)" : "var(--accent)"}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 55 55)"/>
    <text x="55" y="61" text-anchor="middle" font-size="19" font-weight="800" fill="var(--ink)">${Math.round((frac || 0) * 100)}%</text></svg>` });
}
function routineRow(x) {
  const ticked = x.done || C.isTicked(x.key);
  const btn = h("button", { class: "tick" + (ticked ? " done" : "") + (x.auto && !x.done ? " auto" : ""), "aria-label": ticked ? "Done" : "Mark done" }, ticked ? "✓" : "");
  const title = h("div", { class: "t" + (ticked ? " done-t" : "") }, x.title);
  if (x.auto) btn.addEventListener("click", () => C.toast("This one ticks itself when the data shows it is done."));
  else if (!ticked) btn.addEventListener("click", async () => {
    btn.classList.add("done"); btn.textContent = "✓"; title.classList.add("done-t");
    await C.tick(x.key);
  });
  return h("div", { class: "row" }, btn, h("div", { class: "grow" }, title,
    h("div", { class: "small muted t" }, `${x.minutes} min · ${x.auto ? "ticks itself" : x.period}`)));
}
function routineSheet() {
  sheet("Your routine", body => {
    const r = D.routine;
    for (const cad of ["month", "quarter", "year"]) {
      if (!r.tasks[cad] || !r.tasks[cad].length) continue;
      body.append(h("div", { class: "kicker" }, `${cad === "month" ? "This month" : cad === "quarter" ? "This quarter" : "This year"} · ${r.labels[cad]}`));
      body.append(h("div", { class: "card list", style: "padding:4px 14px" }, r.tasks[cad].map(routineRow)));
    }
    body.append(h("p", { class: "small muted" }, "Ticks made here reach the PC with the next sync. Dashed boxes tick themselves when the PC sees the data."));
  });
}
function pcSheet() {
  sheet("Waiting for the PC", body => {
    body.append(h("p", { class: "small muted" }, "These need files or settings on the PC. Open the app there to do them."));
    body.append(h("div", { class: "card list", style: "padding:4px 14px" }, (D.pc_todo || []).map(t =>
      h("div", { class: "row" }, h("div", { class: "grow" }, h("div", {}, t.title),
        h("div", { class: "small muted" }, [t.minutes ? `~${t.minutes} min` : null, t.unlocks ? `unlocks ${t.unlocks}` : null].filter(Boolean).join(" · ")))))));
  });
}

// ================================================================ BUDGET
function renderBudget() {
  const v = $("#v-budget"); v.innerHTML = "";
  const ms = D.months || [];
  if (!budgetMonth) { v.append(h("div", { class: "card muted" }, "No months imported yet.")); return; }
  const i = ms.indexOf(budgetMonth), m = D.budget[budgetMonth];
  const prev = h("button", { class: "arrow", "aria-label": "Previous month", disabled: i <= 0, onclick: () => { budgetMonth = ms[i - 1]; renderBudget(); } }, "‹");
  const next = h("button", { class: "arrow", "aria-label": "Next month", disabled: i >= ms.length - 1, onclick: () => { budgetMonth = ms[i + 1]; renderBudget(); } }, "›");
  v.append(h("div", { class: "switcher" }, prev,
    h("div", { style: "text-align:center" }, h("div", { class: "label" }, ymLabel(budgetMonth)),
      h("div", { class: "small muted" }, m.complete ? "full month" : "month so far")),
    h("div", { style: "display:flex;gap:6px" }, next, h("button", { class: "arrow", "aria-label": "Search transactions", onclick: () => searchSheet(), html: ICON.search }))));
  // swipe left/right on the view switches month
  swipe(v, dir => { const j = i + dir; if (j >= 0 && j < ms.length) { budgetMonth = ms[j]; renderBudget(); } });

  const left = m.left_over || 0;
  v.append(h("div", { class: "card" }, h("div", { class: "donut-row" }, donut(m),
    h("div", { class: "split", style: "grid-template-columns:1fr" },
      kv("Came in", ils(m.income)), kv("Spent", ils(m.spending)), kv("Saved", ils(m.saving), "var(--save)"),
      kv(left >= 0 ? "Left over" : "From the buffer", ils(Math.abs(left)), left >= 0 ? null : "var(--warn)")))));

  const cats = [];
  for (const g of m.groups) if (g.id !== "saving") for (const c of g.cats) cats.push({ ...c, group: g.id });
  cats.sort((a, b) => b.value - a.value);
  const top = Math.max(1, ...cats.map(c => Math.max(c.value, c.cap || 0)));
  const card = h("div", { class: "card list", style: "padding:6px 14px" });
  for (const c of cats.slice(0, 5)) card.append(catRow(c, top));
  card.append(h("button", { class: "see-all", onclick: () => allCatsSheet() }, `All ${cats.length} categories`));
  v.append(card);
  if (m.uncategorised_n) v.append(h("div", { class: "small muted" }, `${m.uncategorised_n} transaction(s) still without a category — see Review.`));
}
function kv(k, val, color) {
  return h("div", { class: "row", style: "min-height:auto;justify-content:space-between" }, h("span", { class: "small muted" }, k),
    h("span", { class: "num", style: `font-weight:700${color ? ";color:" + color : ""}` }, val));
}
function catRow(c, top) {
  const over = c.cap && c.value > c.cap;
  return h("button", { class: "row", style: "width:100%;border:0;background:none;text-align:left;padding:6px 0", onclick: () => categorySheet(budgetMonth, c.name) },
    h("span", { class: "dot", style: `background:${GROUP_COLOR[c.group] || "var(--muted)"}` }),
    h("div", { class: "grow" },
      h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow t" }, bdi(c.name)),
        h("span", { class: "num", style: `font-weight:700${over ? ";color:var(--warn)" : ""}` }, ils(c.value))),
      h("div", { class: "bar", style: "margin-top:5px" },
        h("i", { style: `width:${(100 * c.value / top).toFixed(1)}%;background:${over ? "var(--warn)" : GROUP_COLOR[c.group] || "var(--muted)"}` }),
        c.cap ? h("b", { style: `left:${(100 * c.cap / top).toFixed(1)}%` }) : null)));
}
function donut(m) {
  const segs = [];
  for (const g of m.groups) if (g.value > 0) segs.push({ v: g.value, color: GROUP_COLOR[g.id] || "var(--muted)" });
  if ((m.left_over || 0) > 0) segs.push({ v: m.left_over, color: "var(--left)" });
  const total = segs.reduce((s, x) => s + x.v, 0) || 1;
  const r = 52, cx = 66, cy = 66, c = 2 * Math.PI * r;
  let acc = 0, arcs = "";
  for (const s of segs) {
    const len = c * s.v / total;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="20" stroke-dasharray="${Math.max(0, len - 1.5).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-acc).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    acc += len;
  }
  const rate = m.income ? Math.round(100 * (m.spending || 0) / m.income) : 0;
  return h("div", { html: `<svg viewBox="0 0 132 132" role="img" aria-label="Where the money went">${arcs}
    <text x="66" y="64" text-anchor="middle" font-size="22" font-weight="800" fill="var(--ink)">${rate}%</text>
    <text x="66" y="82" text-anchor="middle" font-size="11" fill="var(--muted)">spent</text></svg>` });
}
function swipe(el, cb) {
  let x0 = null, y0 = null;
  el.ontouchstart = e => { if (e.target.closest(".pots")) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; };
  el.ontouchend = e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) cb(dx < 0 ? 1 : -1);
  };
}
function allCatsSheet() {
  const m = D.budget[budgetMonth];
  sheet(`Categories · ${ymLabel(budgetMonth)}`, body => {
    for (const g of m.groups) {
      if (!g.cats.length) continue;
      const top = Math.max(1, ...g.cats.map(c => Math.max(c.value, c.cap || 0)));
      body.append(h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "dot", style: `background:${GROUP_COLOR[g.id] || "var(--muted)"}` }),
        h("span", { class: "kicker grow" }, g.name), h("span", { class: "num", style: "font-weight:700" }, ils(g.value))));
      body.append(h("div", { class: "card list", style: "padding:6px 14px" }, [...g.cats].sort((a, b) => b.value - a.value).map(c => catRow({ ...c, group: g.id }, top))));
    }
  });
}

// transactions of the snapshot, unpacked once
let TX = null;
function tx() {
  if (TX) return TX;
  const cols = D.tx.cols, idx = Object.fromEntries(cols.map((c, i) => [c, i]));
  TX = D.tx.rows.map(r => ({ date: r[idx.date], desc: r[idx.description], amount: r[idx.amount], cat: r[idx.category], acc: (D.accounts || [])[r[idx.account]] }));
  return TX;
}
function txList(rows, pageSize = 20) {
  const wrap = h("div", {});
  const list = h("div", { class: "card list", style: "padding:2px 14px" });
  let shown = 0;
  const more = h("button", { class: "see-all", onclick: () => page() });
  function page() {
    for (const t of rows.slice(shown, shown + pageSize)) list.append(h("div", { class: "row" },
      h("div", { class: "grow" }, h("div", { class: "t" }, bdi(t.desc)),
        h("div", { class: "small muted t" }, `${t.date.slice(8, 10)} ${MONTHS[+t.date.slice(5, 7) - 1]}${t.cat ? " · " : ""}`, t.cat ? bdi(t.cat) : "")),
      h("span", { class: "num", style: `font-weight:700${t.amount > 0 ? ";color:var(--good)" : ""}` }, ils(t.amount, true))));
    shown += pageSize;
    more.hidden = shown >= rows.length;
    more.textContent = `Show ${Math.min(pageSize, rows.length - shown)} more of ${rows.length - shown}`;
  }
  if (!rows.length) list.append(h("div", { class: "row muted small" }, "No transactions."));
  wrap.append(list, more); page();
  return wrap;
}
function categorySheet(ym, name) {
  const m = D.budget[ym];
  let cat = null, group = null;
  for (const g of m.groups) for (const c of g.cats) if (c.name === name) { cat = c; group = g.id; }
  if (!cat) return;
  sheet(name, body => {
    body.append(h("div", { class: "card" },
      h("div", { class: "kicker" }, ymLabel(ym)), h("div", { class: "big num" }, ils(cat.value)),
      h("div", { class: "small muted", style: "margin-top:4px" },
        [cat.cap ? `soft cap ${ils(cat.cap)}` : "no soft cap", cat.median != null ? `usual month ${ils(cat.median)}` : null].filter(Boolean).join(" · "))));
    if (group !== "saving" && cat.value > 0) body.append(trimCalc(m, cat));
    const rows = tx().filter(t => t.cat === name && t.date.startsWith(ym));
    body.append(h("div", { class: "kicker" }, `${rows.length} transaction(s)`), txList(rows));
  });
}
// What-if (ported from the PC's budget what-if): trim one category, see the month and the year change.
function trimCalc(m, cat) {
  const out = h("div", { class: "answer" });
  const range = h("input", { type: "range", min: "0", max: "50", step: "5", value: "20", "aria-label": "Trim by percent" });
  const draw = () => {
    const p = +range.value / 100, saved = cat.value * p, left = (m.left_over || 0) + saved;
    out.innerHTML = "";
    out.append(h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow", style: "font-weight:700" }, `What if ${range.value}% less?`),
      h("span", { class: "num", style: "font-weight:800" }, ils(saved, true) + "/mo")),
      range,
      h("div", { class: "small" }, `Left over that month: ${ils(left)}. Over a year: `, h("b", { class: "num" }, ils(saved * 12, true)), "."));
    range.focus({ preventScroll: true });
  };
  range.addEventListener("input", draw); draw();
  return out;
}
function searchSheet() {
  sheet("Search transactions", body => {
    const input = h("input", { type: "search", placeholder: "Shop, category or amount", "aria-label": "Search", enterkeyhint: "search" });
    const res = h("div", {});
    const run = () => {
      const q = input.value.trim().toLowerCase();
      res.innerHTML = "";
      if (!q) { res.append(h("p", { class: "small muted" }, `Searches ${tx().length} transactions from ${ymLabel(D.months[0])} to ${ymLabel(D.months.slice(-1)[0])}.`)); return; }
      const num = parseFloat(q.replace(/[₪,]/g, ""));
      const rows = tx().filter(t => (t.desc || "").toLowerCase().includes(q) || (t.cat || "").toLowerCase().includes(q) ||
        (!isNaN(num) && Math.abs(Math.abs(t.amount) - num) < 1));
      const sum = rows.reduce((s, t) => s + t.amount, 0);
      res.append(h("div", { class: "kicker", style: "margin-bottom:8px" }, `${rows.length} found · total ${ils(sum)}`), txList(rows));
    };
    let timer; input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 150); });
    body.append(input, res); run(); setTimeout(() => input.focus(), 250);
  });
}

// ================================================================ REVIEW
function reviewOpen() { return ((D.review && D.review.queue) || []).filter(g => !C.isAnswered(g.description)); }
function renderReview() {
  const v = $("#v-review"); v.innerHTML = "";
  const q = reviewOpen();
  const badge = $("#review-badge");
  if (badge) { badge.hidden = !q.length; badge.textContent = q.length; }
  if (!q.length) {
    const img = D.turtle && D.turtle.img && (D.turtle.img.pleased || D.turtle.img.calm);
    v.append(h("div", { class: "empty" }, img ? h("img", { src: img, alt: "" }) : null,
      h("div", { class: "mid" }, "Nothing to review"),
      h("p", { class: "small", style: "margin:0" }, "When an import brings transactions the app is unsure of, they wait here — one card each.")));
    return;
  }
  const g = q[0], all = D.review.queue.length, done = all - q.length;
  const cats = D.review.categories || {};
  const main = [...(cats.need || []), ...(cats.want || []), ...(cats.saving || [])];
  const other = [...(cats.income || []), ...(cats.transfer || [])];
  let remember = !g.p2p;
  const rememberBtn = h("button", { class: "seg", style: "grid-auto-columns:auto;padding:3px", "aria-pressed": String(remember) });
  const drawRemember = () => { rememberBtn.innerHTML = ""; rememberBtn.append(h("span", { class: remember ? "chip on" : "chip", style: "min-height:32px;border:0" }, remember ? "Yes" : "No")); };
  rememberBtn.addEventListener("click", () => { remember = !remember; rememberBtn.setAttribute("aria-pressed", String(remember)); drawRemember(); });
  drawRemember();
  const answer = cat => {
    const fields = [["description", g.description], ["category", cat]];
    if (remember) fields.push(["make_rule", "1"]);
    C.answer(g.description, fields, () => renderReview());
    renderReview();
  };
  const card = h("div", { class: "card rv" },
    h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "kicker grow" }, `${done + 1} of ${all}`),
      h("span", { class: "num", style: `font-weight:800;${g.total > 0 ? "color:var(--good)" : ""}` }, ils(g.total, true))),
    h("div", { class: "desc" }, bdi(g.description)),
    h("div", { class: "small muted" }, `${g.n} transaction(s) · ${g.first === g.last ? g.first : `${g.first} – ${g.last}`}`,
      g.variants.length > 1 ? h("div", {}, "also as ", g.variants.slice(1).map((x, i) => [i ? ", " : "", bdi(x)])) : null),
    g.suggestion ? h("button", { class: "big-btn suggest", onclick: () => answer(g.suggestion) },
      h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow" }, bdi(g.suggestion)),
        h("span", { class: "small" }, g.confidence != null ? `${Math.round(g.confidence * 100)}% sure` : "suggested"))) : null,
    h("div", { class: "cat-grid" }, main.filter(c => c !== g.suggestion).slice(0, g.suggestion ? 6 : 8).map(c => h("button", { class: "big-btn", onclick: () => answer(c) }, bdi(c)))),
    h("button", { class: "see-all", onclick: () => sheet("All categories", (body, s) => {
      for (const [k, label] of [["need", "Needs"], ["want", "Wants"], ["saving", "Saving"], ["income", "Income"], ["transfer", "Transfers"]]) {
        if (!(cats[k] || []).length) continue;
        body.append(h("div", { class: "kicker" }, label), h("div", { class: "cat-grid" }, cats[k].map(c => h("button", { class: "big-btn", onclick: () => { s.close(); answer(c); } }, bdi(c)))));
      }
    }) }, "Another category…"),
    h("div", { class: "switch-row" }, h("span", { class: "small" }, "Remember this shop for next time"), rememberBtn));
  v.append(card);
}

// ================================================================ MONEY
function renderMoney() {
  const v = $("#v-money"); v.innerHTML = "";
  const M = D.money;
  if (!M) { v.append(h("div", { class: "card muted" }, "No holdings imported yet.")); return; }
  const nw = M.networth;
  v.append(h("div", { class: "card" },
    h("div", { class: "kicker" }, nw ? "Net worth" : "You own"),
    h("div", { class: "big num" }, ils(nw ? nw.net_worth : M.total)),
    h("div", { class: "small muted num", style: "margin-top:4px" },
      nw ? `Savings ${ils(M.total)} · home ${ils(nw.homes)} · debt ${ils(nw.debts)}` : `${ils(M.reach)} within reach · ${ils(M.locked)} locked`)));
  // pots carousel
  const pots = h("div", { class: "pots" });
  for (const p of M.pots) {
    const share = M.total ? p.value / M.total : 0;
    pots.append(h("button", { class: "card pot tap", style: "text-align:left", onclick: () => potSheet(p) },
      h("div", { class: "kicker t" }, bdi(p.name)), h("div", { class: "mid num", style: "margin-top:4px" }, ils(p.value)),
      h("div", { class: "bar", style: "margin-top:10px" }, h("i", { style: `width:${(share * 100).toFixed(1)}%` })),
      h("div", { class: "small muted", style: "margin-top:6px" }, `${pct(share)} · ${p.holdings.length} holding(s) ›`)));
  }
  v.append(pots);
  // next shekel
  const nx = M.next;
  if (nx && nx.amount) {
    const legs = nx.legs || [];
    v.append(h("button", { class: "big-btn", onclick: () => nextSheet(nx) },
      h("div", { class: "row", style: "min-height:auto" },
        h("span", { class: "grow" }, h("div", { class: "kicker" }, "This month's savings go to"),
          h("div", { class: "t", style: "margin-top:2px" }, legs.length ? [bdi(legs[0].to), legs.length > 1 ? ` + ${legs.length - 1} more` : ""] : (nx.why || "—"))),
        h("span", { class: "num", style: "font-weight:800" }, ils(nx.amount)), h("span", { class: "muted" }, " ›"))));
  }
  // goals
  const G = D.goals || [];
  const card = h("div", { class: "card list", style: "padding:4px 14px" },
    h("div", { class: "row", style: "min-height:44px" }, h("span", { class: "kicker grow" }, "Goals"),
      h("button", { class: "chip", onclick: savingsSheet }, "Savings what-if ›")));
  for (const g of G.slice(0, 2)) card.append(goalRow(g));
  if (!G.length) card.append(h("div", { class: "small muted", style: "padding:6px 0 10px" }, "No goals yet — add them on the PC."));
  if (G.length > 2) card.append(h("button", { class: "see-all", onclick: () => sheet("Goals", b => b.append(h("div", { class: "card list", style: "padding:6px 14px" }, G.map(goalRow)))) }, `All ${G.length} goals`));
  v.append(card);
}
function goalRow(g) {
  const frac = g.amount && g.start != null ? Math.min(1, g.start / g.amount) : null;
  const prob = g.probability;
  return h("div", { style: "padding:8px 0" },
    h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow t", style: "font-weight:700" }, bdi(g.name)),
      prob != null ? h("span", { class: prob >= 0.8 ? "pill" : "pill warn" }, `${Math.round(prob * 100)}% likely`) : null),
    frac != null ? h("div", { class: "bar", style: "margin-top:6px" }, h("i", { style: `width:${(frac * 100).toFixed(1)}%` })) : null,
    h("div", { class: "small muted", style: "margin-top:4px" },
      `${g.start != null ? money(g.start, g.currency) + " of " : ""}${money(g.amount, g.currency)} by ${ymLabel(g.target_date)}`
      + (g.required_monthly ? ` · needs ${ils(g.required_monthly)}/mo` : "")));
}
function potSheet(p) {
  sheet(p.name, body => {
    body.append(h("div", { class: "card" }, h("div", { class: "big num" }, ils(p.value)), p.note ? h("div", { class: "small muted", style: "margin-top:6px" }, p.note) : null));
    if (p.id === "reach" && D.money.meters && D.money.meters.length) {
      body.append(h("div", { class: "kicker" }, "Strategy zone"));
      body.append(h("div", { class: "card", style: "display:flex;flex-direction:column;gap:14px" }, D.money.meters.map(meter)));
    }
    body.append(h("div", { class: "kicker" }, "Holdings"));
    body.append(h("div", { class: "card list", style: "padding:2px 14px" }, p.holdings.map(x => h("div", { class: "row" },
      h("div", { class: "grow" }, h("div", { class: "t" }, bdi(x.name)),
        h("div", { class: "small muted t" }, [x.account, x.fee != null ? `fee ${(x.fee * 100).toFixed(2)}%` : null, x.legacy ? "legacy" : null].filter(Boolean).join(" · "))),
      h("span", { class: "num", style: "font-weight:700" }, ils(x.value))))));
    body.append(h("p", { class: "small muted" }, "Classifying holdings and linking funds to the regulator is done on the PC."));
  });
}
function meter(m) {
  const pos = v => `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
  const state = m.state === "inside" ? "pill" : "pill warn";
  return h("div", {},
    h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow small", style: "font-weight:700" }, m.label),
      h("span", { class: state }, `${pct(m.value)} · ${m.state === "inside" ? "in the zone" : m.state}`)),
    h("div", { class: "bar", style: "margin-top:8px;height:10px" },
      h("i", { style: `left:${pos(m.lo)};width:calc(${pos(m.hi)} - ${pos(m.lo)});background:var(--accent-soft)` }),
      h("b", { style: `left:${pos(m.value)};width:4px;background:var(--ink);opacity:1;border-radius:2px` })),
    h("div", { class: "small muted", style: "margin-top:4px" }, `zone ${pct(m.lo)}–${pct(m.hi)}, aim ${pct(m.aim)} — ${m.of || ""}`));
}
function nextSheet(nx) {
  sheet("This month's savings", body => {
    body.append(h("div", { class: "card" }, h("div", { class: "kicker" }, "Amount"), h("div", { class: "big num" }, ils(nx.amount))));
    body.append(h("div", { class: "card list", style: "padding:2px 14px" }, (nx.legs || []).map(l => h("div", { class: "row", style: "padding:6px 0" },
      h("div", { class: "grow" }, h("div", { style: "font-weight:700" }, bdi(l.to)), h("div", { class: "small muted" }, l.how || l.account || "")),
      h("span", { class: "num", style: "font-weight:800" }, ils(l.amount))))));
    body.append(h("p", { class: "small muted" }, "Worked out on the PC from your strategy zone. After you buy, press “I did it” on the PC’s Next ₪ page."));
  });
}
// Savings what-if (ported): future value of a monthly deposit, in today's shekels, at the PC's expected returns.
function savingsSheet() {
  const E = D.expect || { global_eq: 0.065, israel_eq: 0.065, bonds: 0.04, cash: 0.03, inflation: 0.02 };
  const MIX = { stocks: { label: "All stocks", eq: 1, bonds: 0, cash: 0 }, balanced: { label: "Balanced", eq: 0.6, bonds: 0.3, cash: 0.1 }, safe: { label: "Safe", eq: 0.1, bonds: 0.5, cash: 0.4 } };
  const commit = (D.budget[(D.months || []).slice(-1)[0]] || {}).commitment || 2000;
  const st = { monthly: commit, years: 10, mix: "balanced", start: false };
  sheet("Savings what-if", body => {
    const amt = h("input", { type: "number", inputmode: "numeric", value: String(st.monthly), min: "0", step: "100", "aria-label": "Monthly amount" });
    const yrs = h("input", { type: "range", min: "1", max: "35", value: String(st.years), "aria-label": "Years" });
    const yLab = h("label", {});
    const seg = h("div", { class: "seg" });
    const startBtn = h("button", { class: "chip" });
    const outBox = h("div", { class: "answer" });
    const draw = () => {
      st.monthly = Math.max(0, parseFloat(amt.value) || 0); st.years = +yrs.value;
      yLab.textContent = `Years: ${st.years}`;
      seg.innerHTML = "";
      for (const [k, mx] of Object.entries(MIX)) seg.append(h("button", { class: st.mix === k ? "on" : "", onclick: () => { st.mix = k; draw(); } }, mx.label));
      const reach = (D.money && D.money.investable) || 0;
      startBtn.className = "chip" + (st.start ? " on" : ""); startBtn.textContent = `${st.start ? "✓ " : ""}Include today's ${ils(reach)}`;
      const mx = MIX[st.mix], eq = (E.global_eq + E.israel_eq) / 2;
      const nominal = mx.eq * eq + mx.bonds * E.bonds + mx.cash * E.cash;
      const real = (1 + nominal) / (1 + E.inflation) - 1;
      const mr = Math.pow(1 + real, 1 / 12) - 1, n = st.years * 12;
      const fvDeposits = mr ? st.monthly * (Math.pow(1 + mr, n) - 1) / mr : st.monthly * n;
      const fvStart = st.start ? reach * Math.pow(1 + mr, n) : 0;
      const put = st.monthly * n + (st.start ? reach : 0), total = fvDeposits + fvStart;
      outBox.innerHTML = "";
      outBox.append(h("div", { class: "kicker" }, `In ${st.years} years, in today's ₪`), h("div", { class: "big num" }, ils(total)),
        h("div", { class: "small", style: "margin-top:6px" }, `You put in ${ils(put)}; growth adds ${ils(total - put)}. Assumes ${pct(nominal, 1)} a year before inflation (${pct(E.inflation, 1)}), from Settings on the PC. A typical outcome, not a promise.`));
    };
    amt.addEventListener("input", draw); yrs.addEventListener("input", draw);
    startBtn.addEventListener("click", () => { st.start = !st.start; draw(); });
    body.append(h("div", { class: "field" }, h("label", {}, "Every month (₪)"), amt), h("div", { class: "field" }, yLab, yrs),
      h("div", { class: "field" }, h("label", {}, "Invested as"), seg), h("div", {}, startBtn), outBox);
    draw();
  });
}

// ================================================================ SEND (uploads)
function renderSend() {
  const v = $("#v-send"); v.innerHTML = "";
  const file = h("input", { type: "file", accept: ".xlsx,.xls,.xlsm,.csv,.html,.htm,.pdf,.txt", id: "upload-file", style: "font-size:15px" });
  const msg = h("p", { class: "small", style: "margin:0" });
  const btn = h("button", { class: "primary" }, "Send to the PC");
  btn.addEventListener("click", async () => {
    const f = file.files[0];
    if (!f) { msg.textContent = "Pick a file first."; return; }
    btn.disabled = true; msg.textContent = "Encrypting and sending…";
    try { await C.upload(f); msg.textContent = `Sent ${f.name}. The PC imports it the next time it runs.`; file.value = ""; }
    catch (e) { msg.textContent = "Not sent: " + e.message; }
    finally { btn.disabled = false; }
  });
  v.append(h("div", { class: "card", style: "display:flex;flex-direction:column;gap:12px" },
    h("div", { class: "mid" }, "Send a file to the PC"),
    h("p", { class: "small muted", style: "margin:0" }, "A bank or card export, a מסלקה report or a fund's quarterly PDF downloaded on this phone. It goes to your Drive encrypted; the PC puts it in the inbox and imports it."),
    file, btn, msg));
  const pend = C.pendingCount();
  v.append(h("div", { class: "card" }, h("div", { class: "kicker" }, "Changes made on the phone"),
    h("p", { class: "small", style: "margin:6px 0 0" }, pend ? `${pend} waiting to be sent — tap ⋯ → Get latest.` : "All sent. The PC applies them within a minute while it runs.")));
}
export function refreshBadges() { renderReview(); renderSend(); }
