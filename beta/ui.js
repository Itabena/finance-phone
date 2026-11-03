// The phone app's own screens (PLAN-44). Drawn from payload.phone (finance/sync/phone_data.py), never from PC pages.
// Rule: every tab fits on one screen; anything longer opens in a bottom sheet.
import * as calc from "./calc.js?v=18";
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
  todo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/></svg>',
  decide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>',
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
const TABS = [["today", "Today"], ["budget", "Budget"], ["money", "Money"], ["todo", "To do"], ["review", "Review"]];   // PLAN-48
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
// The phone needs fields that older PC code does not write (phone_data.DATA_VERSION). Say so instead of showing
// half-empty screens.
const NEEDS_DATA = 3;
function oldCopyNote(v) {
  if ((D.data || 0) >= NEEDS_DATA) return;
  v.append(h("div", { class: "card", style: "background:var(--warn-soft);color:var(--ink)" }, h("div", { style: "font-weight:800;color:var(--warn)" }, "This copy is from an older PC app"),
    h("div", { class: "small", style: "margin-top:4px" }, "Expanding parts and horizons, fixing transactions and holdings, and saying what a file is need a copy from the updated PC app. On the PC: close every finance app window (the app and the demo), open the one you want, then Settings → Phone → Write it now. Then reopen this app.")));
}
function renderAll() { renderToday(); renderBudget(); renderMoney(); renderTodo(); renderReview(); }

// ================================================================ TODAY
function renderToday() {
  const v = $("#v-today"); v.innerHTML = "";
  oldCopyNote(v);
  const ym = (D.months || []).slice(-1)[0];
  const m = ym && D.budget[ym];
  const t = D.turtle || {};
  const overAny = m && m.groups.some(g => g.cats.some(c => c.cap && c.value > c.cap));
  if (t.says && !overAny) v.append(h("div", { class: "says small muted" }, t.says));   // the over-cap chips already say it
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
  // what to do: the next few, across today and this month (PLAN-48)
  const T = todoModel(), soon = [...T.today, ...T.month].filter(x => !x.done);
  const card = h("div", { class: "card" },
    h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "kicker grow" }, "To do"),
      h("span", { class: soon.length ? "pill warn" : "pill" }, soon.length ? `${T.today.filter(x => !x.done).length} today · ${T.month.filter(x => !x.done).length} this month` : "all done")));
  const list = h("div", { class: "list" });
  for (const x of soon.slice(0, 3)) list.append(todoRow(x));
  if (!soon.length) list.append(h("div", { class: "row muted small" }, "Nothing left for today or this month."));
  card.append(list, h("button", { class: "see-all", onclick: () => go("todo") }, "Open To do"));
  v.append(card);
  // update the data: send a file, and what is waiting for the PC
  const todo = D.pc_todo || [], sent = C.sentFiles ? C.sentFiles() : [];
  v.append(h("div", { class: "card", style: "padding:6px 14px" },
    h("button", { class: "row", style: "width:100%;border:0;background:none;text-align:left;padding:4px 0", onclick: sendSheet },
      h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, "Update the data"),
        h("div", { class: "small muted" }, sent.length ? `${sent.length} file(s) sent, waiting for the PC` : "Send a bank, card or fund file from this phone")),
      h("span", { class: "muted" }, "›")),
    todo.length && !D.fill ? h("button", { class: "row", style: "width:100%;border:0;border-top:1px solid var(--line);background:none;text-align:left;padding:4px 0", onclick: pcSheet },
      h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, "Waiting for the PC"),
        h("div", { class: "small muted" }, `${todo.length} thing(s), about ${todo.reduce((s, t) => s + (t.minutes || 0), 0)} min`)),
      h("span", { class: "muted" }, "›")) : null));
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

// ================================================================ FILL IN WHAT IS MISSING (PLAN-47)
// The phone never changes numbers itself: each answer goes into the queue and the PC applies it through the same
// form the PC uses (same checks). Files are read only on the PC.
const sentHere = new Set();
const today = () => (D.today || new Date().toISOString().slice(0, 10));
function input(type, attrs = {}) { return h("input", Object.assign({ type, inputmode: type === "number" ? "decimal" : null }, attrs)); }
function fieldOf(label, el) { return h("div", { class: "field" }, h("label", {}, label), el); }
function sendForm(key, path, fieldsFn, button = "Save") {
  const msg = h("div", { class: "small" });
  const btn = h("button", { class: "primary" }, sentHere.has(key) ? "Sent ✓ — send again" : button);
  btn.addEventListener("click", async e => {
    e.preventDefault();
    const fields = fieldsFn(msg);
    if (!fields) return;
    btn.disabled = true;
    try { await C.send(path, fields); sentHere.add(key);
      const w = C.pendingCount ? C.pendingCount() : 0;
      msg.innerHTML = w ? '<span class="sent-ok">Saved on this phone — tap Send in the bar above when you are online (To do → Today shows it).</span>'
        : '<span class="sent-ok">Sent — the PC applies it within a minute while it runs, then writes a new copy.</span>';
      btn.textContent = "Sent ✓ — send again"; }
    catch (err) { msg.textContent = "Could not save: " + err.message; }
    btn.disabled = false;
  });
  return [btn, msg];
}
function getLinks(groups) {
  const S = ((D.fill || {}).sources || []).filter(x => !groups || groups.includes(x.group));
  if (!S.length) return h("div", { class: "small muted" }, "Choose your providers on the PC (Settings → Your providers) to get links here.");
  return h("div", { class: "list" }, S.map(x => h("div", { class: "row", style: "min-height:auto;padding:6px 0;align-items:flex-start" },
    h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, bdi(x.name)), h("div", { class: "small muted" }, x.what)),
    h("span", { class: "links" }, x.gmail ? h("a", { class: "chip", href: x.gmail, target: "_blank", rel: "noopener" }, "Gmail") : null,
      h("a", { class: "chip", href: x.url, target: "_blank", rel: "noopener" }, "Site"),
      h("button", { class: "chip on", onclick: () => sendSheet(x.key) }, "Send")))));
}
function fillSheet() {
  const F = D.fill || {}, T = F.todo || [];
  sheet("Fill in what's missing", body => {
    const la = F.last_applied;
    if (la && la.refused) body.append(h("div", { class: "card answer small" }, `Last time the PC could not apply ${la.refused} thing(s)` + (la.why ? ": " + la.why.join("; ") : ".")));
    const card = h("div", { class: "card list", style: "padding:2px 14px" });
    const row = (title, sub, fn) => card.append(h("button", { class: "row", style: "width:100%;border:0;background:none;text-align:left;padding:8px 0", onclick: fn },
      h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, title), sub ? h("div", { class: "small muted" }, sub) : null), h("span", { class: "muted" }, fn ? "›" : "")));
    for (const t of T) {
      const sub = [t.minutes ? `~${t.minutes} min` : null, t.unlocks ? `unlocks ${t.unlocks}` : null].filter(Boolean).join(" · ");
      if (t.key === "exports") row(t.title, sub, () => filesSheet(F.files.missing_groups, "Last month's files"));
      else if (t.key === "quarterly" || t.key === "holdings") row(t.title, sub, () => filesSheet(["broker", "funds"], "Fund and broker statements", true));
      else if (t.key === "cash") row(t.title, sub, cashSheet);
      else if (t.key === "commitment") row(t.title, sub, commitmentSheet);
      else if (t.key === "classify") row(t.title, sub, classifySheet);
      else if (t.key === "pots") row(t.title, sub, potsSheet);
      else if (t.key === "positions") row(t.title, sub, confirmSheet);
      else if (t.key === "review") row(t.title, sub, () => { closeAllSheets(); go("review"); });
      else if (t.key === "import") row(t.title, "The PC imports them when it next runs.", null);
      else row(t.title, (sub ? sub + " · " : "") + "on the PC", null);
    }
    if ((F.tags || []).length) row(`Check ${F.tags.length} guessed tag(s)`, "asset, market and kind — they decide which part of your mix each holding counts in", tagsSheet);
    body.append(card);
    body.append(h("div", { class: "card list", style: "padding:2px 14px" },
      h("button", { class: "row", style: "width:100%;border:0;background:none;text-align:left;padding:8px 0", onclick: sendSheet },
        h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, "Send any file"), h("div", { class: "small muted" }, "bank, card or fund file — the PC reads it")), h("span", { class: "muted" }, "›")),
      h("button", { class: "row", style: "width:100%;border:0;border-top:1px solid var(--line);background:none;text-align:left;padding:8px 0", onclick: () => balanceSheet() },
        h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, "Type a balance by hand"), h("div", { class: "small muted" }, "when you have the number but no file")), h("span", { class: "muted" }, "›"))));
  });
}
function filesSheet(groups, title, funds) {
  sheet(title, body => {
    body.append(h("p", { class: "small muted", style: "margin:0" }, "Download the file from the provider (or find it in Gmail), then send it here. The PC reads it."));
    body.append(h("div", { class: "card" }, getLinks(groups)));
    body.append(h("button", { class: "primary", onclick: sendSheet }, "Send the file"));
    body.append(h("div", { class: "card list", style: "padding:2px 14px" },
      h("div", { class: "kicker", style: "padding-top:10px" }, "No file?"),
      funds ? h("button", { class: "row", style: "width:100%;border:0;background:none;text-align:left;padding:8px 0", onclick: () => balanceSheet() },
        h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, "Type the balances by hand"), h("div", { class: "small muted" }, "from the provider's site or app")), h("span", { class: "muted" }, "›"))
        : h("button", { class: "row", style: "width:100%;border:0;background:none;text-align:left;padding:8px 0", onclick: cashSheet },
        h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, "Type the bank balance"), h("div", { class: "small muted" }, "the spending itself still needs the file")), h("span", { class: "muted" }, "›"))));
  });
}
function cashSheet() {
  const c = (D.fill || {}).cash || {};
  sheet("Bank balance", body => {
    const v = input("number", { placeholder: "₪", value: "" }), d = input("date", { value: today() }), n = input("text", { placeholder: "e.g. Leumi app" });
    body.append(h("p", { class: "small muted", style: "margin:0" }, c.value != null ? `Last: ${ils(c.value)} on ${c.as_of}.` : "Not entered yet."));
    body.append(h("div", { class: "fill-form" }, fieldOf("Balance today (₪)", v), fieldOf("Date", d), fieldOf("Where you read it", n),
      sendForm("cash", "/settings/cash", m => { if (!v.value || !n.value.trim()) { m.textContent = "The balance and where you read it are both needed."; return null; }
        return [["value", v.value], ["as_of", d.value], ["note", n.value.trim()]]; })));
  });
}
function commitmentSheet() {
  const c = (D.fill || {}).commitment || {};
  sheet("Monthly savings", body => {
    const v = input("number", { placeholder: "₪ a month", value: c.value != null ? Math.round(c.value) : "" });
    body.append(h("p", { class: "small muted", style: "margin:0" }, "What you commit to set aside each month (pay yourself first). Decide → Set aside shows what the budget allows."));
    body.append(h("div", { class: "fill-form" }, fieldOf("Each month (₪)", v),
      sendForm("commitment", "/settings/commitment", m => { if (!v.value) { m.textContent = "Type an amount."; return null; } return [["value", v.value]]; })));
  });
}
function classifySheet() {
  const L = (D.fill || {}).classify || [];
  sheet("Classify holdings", body => {
    body.append(h("p", { class: "small muted", style: "margin:0" }, "Horizon: when you may need the money — safe up to 3 years, mid 3–7, long 7+. Israel and equity shares are in the fund's factsheet."));
    if (!L.length) body.append(h("div", { class: "card muted" }, "Everything is classified."));
    for (const x of L) {
      const sl = h("select", {}, [["", "Horizon…"], ["safe", "Safe (≤3 yrs)"], ["mid", "Mid (3–7 yrs)"], ["long", "Long (7+ yrs)"], ["retirement", "Retirement"]].map(([v, t]) => h("option", { value: v }, t)));
      const il = input("number", { placeholder: "%", value: x.israel != null ? Math.round(x.israel * 100) : "" });
      const eq = input("number", { placeholder: "%", value: x.equity != null ? Math.round(x.equity * 100) : "" });
      body.append(h("div", { class: "card fill-form" }, h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow t", style: "font-weight:800" }, bdi(x.name)), h("span", { class: "num" }, ils(x.value))),
        fieldOf("Horizon", sl), h("div", { class: "two" }, fieldOf("Israel %", il), fieldOf("Equity %", eq)),
        sendForm("cls:" + x.instrument, "/hold/classify", m => { if (!sl.value) { m.textContent = "Choose a horizon."; return null; }
          const f = [["instrument", x.instrument], ["sleeve", sl.value], ["israel", il.value], ["equity", eq.value], ["leverage", String(x.leverage || 1)]];
          if (x.legacy) f.push(["legacy", "1"]); return f; })));
    }
  });
}
function potsSheet() {
  const L = (D.fill || {}).pots || [], P = D.people || {};
  sheet("Whose pension?", body => {
    for (const x of L) {
      const s = h("select", {}, h("option", { value: "pension_me" }, `${P.me || "Me"}`), h("option", { value: "pension_spouse" }, `${P.spouse || "Spouse"}`));
      body.append(h("div", { class: "card fill-form" }, h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow t", style: "font-weight:800" }, bdi(x.name)), h("span", { class: "num" }, ils(x.value))),
        fieldOf("Belongs to", s), sendForm("pot:" + x.account, "/hold/pot", () => [["account", x.account], ["pot", s.value]])));
    }
  });
}
function confirmSheet() {
  const n = (D.fill || {}).confirm || 0;
  sheet("Confirm imported holdings", body => {
    body.append(h("p", { class: "small" }, `${n} holding(s) from the last statement are waiting. Confirm if the values look like what the provider shows (Money tab).`));
    body.append(h("div", { class: "fill-form" }, sendForm("confirm", "/hold/confirm", () => [["from", "phone"]], "Confirm them")));
  });
}
function tagsSheet() {
  const F = D.fill || {}, L = F.tags || [], O = F.tag_options || {};
  sheet("Guessed tags", body => {
    body.append(h("p", { class: "small muted", style: "margin:0" }, "The app guessed these from the fund names. Keep a guess or pick the right value; they decide which part of your mix each holding counts in."));
    for (const x of L) {
      const sel = (field, opts) => h("select", {}, h("option", { value: "" }, `${x.guessed.includes(field) ? "guess" : "keep"}: ${opts[x[field]] || x[field]}`),
        Object.entries(opts).map(([v, t]) => h("option", { value: v }, t)));
      const a = sel("asset", O.asset || {}), r = sel("region", O.region || {}), k = sel("kind", O.kind || {});
      body.append(h("div", { class: "card fill-form" }, h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow t", style: "font-weight:800" }, bdi(x.name)), h("span", { class: "num" }, ils(x.value))),
        fieldOf("Asset", a), fieldOf("Market", r), fieldOf("Kind", k),
        sendForm("tag:" + x.instrument, "/mix/tags", () => [["t0_key", x.instrument], ["t0_asset", a.value || (x.guessed.includes("asset") ? "" : x.asset)],
          ["t0_region", r.value || (x.guessed.includes("region") ? "" : x.region)], ["t0_kind", k.value || (x.guessed.includes("kind") ? "" : x.kind)]])));
    }
  });
}
// One holding, everything about it editable (PLAN-48). Each part is sent on its own, through the PC's own forms.
function holdingSheet(id) {
  const F = D.fill || {}, [inst, acc] = String(id || "").split("@");
  const x = (F.holdings || []).find(q => q.instrument === inst && q.account === acc);
  if (!x) { C.toast("This holding is not in the phone copy yet — open the app on the PC once."); return; }
  const O = F.tag_options || {};
  sheet(x.name, body => {
    body.append(h("div", { class: "card" }, h("div", { class: "big num" }, ils(x.value)),
      h("div", { class: "small muted", style: "margin-top:4px" }, `${x.account_name} · statement ${x.as_of || "—"}`)));
    // value
    const v = input("number", { value: Math.round(x.value) }), d = input("date", { value: today() }), n = input("text", { placeholder: "e.g. provider app" });
    body.append(expander([h("span", { class: "grow", style: "font-weight:700" }, "Correct the value")], b => b.append(h("div", { class: "fill-form" },
      fieldOf("Value today (₪)", v), fieldOf("Date", d), fieldOf("Where you read it", n),
      h("div", { class: "small muted" }, "The other holdings of this account keep their last value. A statement on that date wins over a typed value."),
      sendForm("hv:" + id, "/hold/balance", m => { if (!n.value.trim() || !v.value) { m.textContent = "The value and where you read it are both needed."; return null; }
        return [["account", x.account], ["as_of", d.value], ["note", n.value.trim()], ["k0", x.instrument], ["v0", v.value]]; })))));
    // horizon and shares
    if (x.pot === "reach") {
      const sl = h("select", {}, [["", "No horizon"], ["safe", "Safe (≤3 yrs)"], ["mid", "Mid (3–7 yrs)"], ["long", "Long (7+ yrs)"], ["retirement", "Retirement"]].map(([val, t]) => h("option", { value: val }, t)));
      sl.value = x.sleeve || "";
      const il = input("number", { value: x.israel != null ? Math.round(x.israel * 100) : "", placeholder: "%" });
      const eq = input("number", { value: x.equity != null ? Math.round(x.equity * 100) : "", placeholder: "%" });
      const lg = h("input", { type: "checkbox" }); lg.checked = !!x.legacy;
      body.append(expander([h("span", { class: "grow", style: "font-weight:700" }, "Horizon and shares"),
          h("span", { class: "small muted" }, [x.sleeve || "no horizon", x.israel != null ? `Israel ${pct(x.israel)}` : null, x.legacy ? "legacy" : null].filter(Boolean).join(" · "))],
        b => b.append(h("div", { class: "fill-form" }, fieldOf("Horizon", sl), h("div", { class: "two" }, fieldOf("Israel %", il), fieldOf("Equity %", eq)),
          h("label", { class: "check" }, lg, " Legacy — gets no new money"),
          sendForm("hc:" + id, "/hold/classify", () => { const f = [["instrument", x.instrument], ["sleeve", sl.value], ["israel", il.value], ["equity", eq.value], ["leverage", String(x.leverage || 1)]];
            if (lg.checked) f.push(["legacy", "1"]); return f; })))));
      // tags
      const sel = (field, opts) => { const e = h("select", {}, h("option", { value: "" }, `guess from the name${x.guessed.includes(field) ? ": " + (opts[x[field]] || x[field]) : ""}`),
        Object.entries(opts).map(([val, t]) => h("option", { value: val }, t))); e.value = x.guessed.includes(field) ? "" : x[field]; return e; };
      const a = sel("asset", O.asset || {}), r = sel("region", O.region || {}), k = sel("kind", O.kind || {});
      body.append(expander([h("span", { class: "grow", style: "font-weight:700" }, "Mix tags"),
          h("span", { class: "small muted" }, `${(O.asset || {})[x.asset] || x.asset} · ${(O.region || {})[x.region] || x.region}`)],
        b => b.append(h("div", { class: "fill-form" }, fieldOf("Asset", a), fieldOf("Market", r), fieldOf("Kind", k),
          sendForm("ht:" + id, "/mix/tags", () => [["t0_key", x.instrument], ["t0_asset", a.value], ["t0_region", r.value], ["t0_kind", k.value]])))));
    }
    // pot (the whole account)
    const P = F.pot_names || {};
    const ps = h("select", {}, Object.entries(P).map(([val, t]) => h("option", { value: val }, t))); ps.value = x.pot;
    body.append(expander([h("span", { class: "grow", style: "font-weight:700" }, "Which pot"), h("span", { class: "small muted" }, P[x.pot] || x.pot)],
      b => b.append(h("div", { class: "fill-form" }, fieldOf("The whole account belongs to", ps),
        sendForm("hp:" + id, "/hold/pot", () => [["account", x.account], ["pot", ps.value]])))));
    body.append(h("p", { class: "small muted" }, "Each change is sent on its own; the PC applies it the next time it runs."));
  });
}
function balanceSheet() {
  const B = (D.fill || {}).balances || [];
  sheet("Type a balance by hand", body => {
    body.append(h("p", { class: "small muted", style: "margin:0" }, "For when there is no file: the value the provider's site or app shows today. Holdings you leave as they are keep their last value."));
    for (const b of B) body.append(expander([h("span", { class: "grow", style: "min-width:0" }, h("div", { class: "t", style: "font-weight:700" }, bdi(b.name)),
        h("div", { class: "small muted" }, `last statement ${b.as_of || "—"}`))],
      x => {
        const rows = b.holdings.map(hd => ({ hd, el: input("number", { value: Math.round(hd.value) }) }));
        const d = input("date", { value: today() }), n = input("text", { placeholder: "e.g. Meitav app" });
        x.append(h("div", { class: "fill-form" }, rows.map(({ hd, el }) => fieldOf(hd.name, el)), fieldOf("Date", d), fieldOf("Where you read it", n),
          sendForm("bal:" + b.account, "/hold/balance", m => {
            if (!n.value.trim()) { m.textContent = "Say where you read it — it is kept with the number."; return null; }
            const f = [["account", b.account], ["as_of", d.value], ["note", n.value.trim()]];
            rows.forEach(({ hd, el }, i) => { f.push([`k${i}`, hd.instrument], [`v${i}`, el.value]); });
            return f; })));
      }));
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
    h("div", { style: "display:flex;gap:6px" }, next, h("button", { class: "arrow", "aria-label": "Search transactions", onclick: () => searchSheet(), html: ICON.search }),
      D.fill ? h("button", { class: "arrow", "aria-label": "Add a transaction by hand", onclick: () => addTxSheet(), style: "font-size:22px;font-weight:700" }, "+") : null)));
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
  if (D.fill) v.append(h("div", { class: "small muted" }, "Something wrong? Open a category or search, then tap the transaction to fix it. + adds one by hand."));
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
  TX = D.tx.rows.map(r => ({ date: r[idx.date], desc: r[idx.description], amount: r[idx.amount], cat: r[idx.category], acc: (D.accounts || [])[r[idx.account]],
    id: idx.id != null ? r[idx.id] : null, flag: idx.flag != null ? r[idx.flag] || "" : "", note: idx.note != null ? r[idx.note] : null, was: idx.was != null ? r[idx.was] : null }));
  return TX;
}
function txList(rows, pageSize = 20) {
  const wrap = h("div", {});
  const list = h("div", { class: "card list", style: "padding:2px 14px" });
  let shown = 0;
  const more = h("button", { class: "see-all", onclick: () => page() });
  function page() {
    for (const t of rows.slice(shown, shown + pageSize)) {
      const tags = [t.flag.includes("h") ? "hidden" : null, t.flag.includes("c") ? "corrected" : null, t.flag.includes("m") ? "by hand" : null,
        sentHere.has("tx:" + t.id) ? "fix sent" : null].filter(Boolean).join(" · ");
      list.append(h(t.id != null ? "button" : "div", { class: "row", style: (t.id != null ? "width:100%;border:0;background:none;text-align:left;" : "") + (t.flag.includes("h") ? "opacity:.55" : ""),
          onclick: t.id != null ? () => txSheet(t) : null },
        h("div", { class: "grow" }, h("div", { class: "t", style: t.flag.includes("h") ? "text-decoration:line-through" : null }, bdi(t.desc)),
          h("div", { class: "small muted t" }, `${t.date.slice(8, 10)} ${MONTHS[+t.date.slice(5, 7) - 1]}${t.cat ? " · " : ""}`, t.cat ? bdi(t.cat) : "", tags ? ` · ${tags}` : "")),
        h("span", { class: "num", style: `font-weight:700${t.amount > 0 ? ";color:var(--good)" : ""}` }, ils(t.amount, true))));
    }
    shown += pageSize;
    more.hidden = shown >= rows.length;
    more.textContent = `Show ${Math.min(pageSize, rows.length - shown)} more of ${rows.length - shown}`;
  }
  if (!rows.length) list.append(h("div", { class: "row muted small" }, "No transactions."));
  wrap.append(list, more); page();
  return wrap;
}
// Fixing one transaction (PLAN-48). Every option goes through the PC's own form; nothing changes here until it runs.
function allCats() { const R = (D.review || {}).categories || {}; return Object.values(R).flat(); }
function catSelect(current) {
  const R = (D.review || {}).categories || {}, label = { income: "Income", need: "Needs", want: "Wants", saving: "Saving", transfer: "Not spending (transfers)" };
  const sel = h("select", {}, Object.entries(R).map(([k, names]) => h("optgroup", { label: label[k] || k }, names.map(n => h("option", { value: n }, n)))));
  if (current && allCats().includes(current)) sel.value = current;
  return sel;
}
function txSheet(t) {
  const hidden = t.flag.includes("h"), byHand = t.flag.includes("m");
  sheet("Fix this transaction", body => {
    body.append(h("div", { class: "card" }, h("div", { class: "t", style: "font-weight:800" }, bdi(t.desc)),
      h("div", { class: "row", style: "min-height:auto;margin-top:6px" }, h("span", { class: "grow small muted" }, `${t.date} · ${t.acc || ""}`),
        h("span", { class: "big num", style: t.amount > 0 ? "color:var(--good)" : "" }, ils(t.amount, true))),
      t.cat ? h("div", { class: "small" }, "Category: ", bdi(t.cat)) : h("div", { class: "small warn" }, "No category yet"),
      t.note ? h("div", { class: "small muted" }, "✎ " + t.note) : null,
      t.was ? h("div", { class: "small muted" }, (hidden ? "Was filed under: " : "The file says: ") + t.was) : null));
    if (hidden) {
      body.append(h("div", { class: "fill-form" }, h("p", { class: "small", style: "margin:0" }, "Hidden: kept on record, left out of the budget."),
        sendForm("tx:" + t.id, "/tx/hide", () => [["id", String(t.id)], ["undo", "1"]], "Show it again")));
      return;
    }
    const cs = catSelect(t.cat), same = h("input", { type: "checkbox" });
    body.append(expander([h("span", { class: "grow", style: "font-weight:700" }, "Change the category"), h("span", { class: "small muted" }, "incl. income or transfer")],
      b => b.append(h("div", { class: "fill-form" }, fieldOf("Category", cs),
        h("label", { class: "check" }, same, " Every transaction with this description (like Review)"),
        sendForm("tx:" + t.id, "/tx/category", () => { const f = [["id", String(t.id)], ["category", cs.value]]; if (same.checked) f.push(["same", "1"]); return f; })))));
    const a = input("number", { placeholder: String(t.amount) }), d = input("date", { value: t.date }), n1 = input("text", { placeholder: "what was wrong" });
    body.append(expander([h("span", { class: "grow", style: "font-weight:700" }, "Correct the amount or date"), h("span", { class: "small muted" }, "the file's values are kept")],
      b => b.append(h("div", { class: "fill-form" }, h("div", { class: "two" }, fieldOf("Amount (− out, + in)", a), fieldOf("Date", d)), fieldOf("What was wrong", n1),
        sendForm("tx:" + t.id, "/tx/fix", m => { if (!n1.value.trim()) { m.textContent = "Say what was wrong — it is kept with the correction."; return null; }
          if (!a.value && d.value === t.date) { m.textContent = "Change the amount or the date."; return null; }
          return [["id", String(t.id)], ["amount", a.value], ["day", d.value !== t.date ? d.value : ""], ["note", n1.value.trim()]]; }),
        t.flag.includes("c") ? sendForm("txu:" + t.id, "/tx/fix", () => [["id", String(t.id)], ["undo", "1"]], "Back to the file's values") : null))));
    if (byHand) body.append(h("div", { class: "fill-form" }, sendForm("tx:" + t.id, "/tx/remove", () => [["id", String(t.id)]], "Remove — I added it by mistake")));
    else {
      const n2 = input("text", { placeholder: "e.g. charged twice, refunded" });
      body.append(expander([h("span", { class: "grow", style: "font-weight:700" }, "Hide it — not counted"), h("span", { class: "small muted" }, "wrong or duplicate")],
        b => b.append(h("div", { class: "fill-form" }, fieldOf("Why", n2), h("div", { class: "small muted" }, "It stays in the list, struck through, and can be shown again."),
          sendForm("tx:" + t.id, "/tx/hide", m => { if (!n2.value.trim()) { m.textContent = "Say why — it is kept with it."; return null; } return [["id", String(t.id)], ["note", n2.value.trim()]]; })))));
    }
  });
}
function addTxSheet() {
  sheet("Add a transaction by hand", body => {
    body.append(h("p", { class: "small muted", style: "margin:0" }, "For what no file has: cash you paid, income or a transfer from an account you don't import."));
    const dir = h("select", {}, h("option", { value: "out" }, "Money out (spent)"), h("option", { value: "in" }, "Money in (income)"));
    const a = input("number", { placeholder: "₪" }), d = input("date", { value: today() }), ds = input("text", { placeholder: "e.g. market, babysitter" });
    const cs = catSelect(null), n = input("text", { placeholder: "e.g. paid cash" });
    const RC = (D.review || {}).categories || {};
    const first = k => (RC[k] || [])[0];
    cs.value = first("need") || first("want") || cs.value;
    dir.addEventListener("change", () => { cs.value = (dir.value === "in" ? first("income") : first("need") || first("want")) || cs.value; });
    body.append(h("div", { class: "fill-form" }, fieldOf("Direction", dir), h("div", { class: "two" }, fieldOf("Amount (₪)", a), fieldOf("Date", d)),
      fieldOf("What it was", ds), fieldOf("Category", cs), fieldOf("Where it comes from", n),
      sendForm("txadd:" + Date.now(), "/tx/add", m => { if (!a.value || !ds.value.trim() || !n.value.trim()) { m.textContent = "Amount, what it was and where it comes from are needed."; return null; }
        return [["direction", dir.value], ["amount", a.value], ["day", d.value], ["description", ds.value.trim()], ["category", cs.value], ["note", n.value.trim()]]; }, "Add it")));
  });
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
  oldCopyNote(v);
  const M = D.money;
  if (!M) { v.append(h("div", { class: "card muted" }, "No holdings imported yet.")); return; }
  const nw = M.networth;
  v.append(h("div", { class: "card" },
    h("div", { class: "kicker" }, nw ? "Net worth" : "You own"),
    h("div", { class: "big num" }, ils(nw ? nw.net_worth : M.total)),
    h("div", { class: "small muted num", style: "margin-top:4px" },
      nw ? `Savings ${ils(M.total)} · home ${ils(nw.homes)} · debt ${ils(nw.debts)}` : `${ils(M.reach)} within reach · ${ils(M.locked)} locked`)));
  strategyCard(v);                                     // PLAN-48: the strategy lives with the money
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
  // next shekel: now under To do → this month, when the decision data is there
  const nx = M.next;
  if (nx && nx.amount && !D.decide) {
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
    body.append(h("div", { class: "card list", style: "padding:2px 14px" }, p.holdings.map(x => h(D.fill ? "button" : "div",
      { class: "row", style: D.fill ? "width:100%;border:0;background:none;text-align:left" : null, onclick: D.fill ? () => holdingSheet(x.id) : null },
      h("div", { class: "grow" }, h("div", { class: "t" }, bdi(x.name)),
        h("div", { class: "small muted t" }, [x.account, x.fee != null ? `fee ${(x.fee * 100).toFixed(2)}%` : null, x.legacy ? "legacy" : null].filter(Boolean).join(" · "))),
      h("span", { class: "num", style: "font-weight:700" }, ils(x.value)), D.fill ? h("span", { class: "muted" }, " ›") : null))));
    if (D.fill) body.append(h("p", { class: "small muted", style: "margin:0" }, "Tap a holding to correct its value, horizon, shares, tags or pot."));
    if (D.fill) body.append(h("button", { class: "ghost", onclick: () => balanceSheet() }, "Type a balance by hand"));
    body.append(h("p", { class: "small muted" }, D.fill ? "Linking funds to the regulator is done on the PC." : "Classifying holdings and linking funds to the regulator is done on the PC."));
  });
}
function meter(m) {
  const pos = v => `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
  const state = m.state === "inside" ? "pill" : "pill warn";
  return h("div", {},
    h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow small", style: "font-weight:700" }, m.label),
      h("span", { class: state }, `${pct(m.value)} · ${m.state === "inside" ? "in the zone" : m.state}`)),
    h("div", { class: "bar", style: "margin-top:8px;height:10px" },
      h("i", { class: "band", style: `left:${pos(m.lo)};width:calc(${pos(m.hi)} - ${pos(m.lo)})` }),
      h("b", { style: `left:${pos(m.value)};width:4px;background:var(--ink);opacity:1;border-radius:2px` })),
    h("div", { class: "small muted", style: "margin-top:4px" }, `zone ${pct(m.lo)}–${pct(m.hi)}, aim ${pct(m.aim)} — ${m.of || ""}`));
}
function nextSheet(nx) {
  sheet("This month's savings", body => {
    body.append(h("div", { class: "card" }, h("div", { class: "kicker" }, "Amount"), h("div", { class: "big num" }, ils(nx.amount))));
    body.append(h("div", { class: "card list", style: "padding:2px 14px" }, (nx.legs || []).map(l => h("div", { class: "row", style: "padding:6px 0" },
      h("div", { class: "grow" }, h("div", { style: "font-weight:700" }, bdi(l.to)), h("div", { class: "small muted" }, [l.label, l.how || l.account].filter(Boolean).join(" · "))),
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
// What a sent file is (PLAN-48): your providers, then the generic kinds. The PC keeps it in an inbox folder of that
// name, so you can always see what it was meant to be; the PC still reads the file by its content.
function whatOptions(preset) {
  const S = (D.fill || {}).sources || [];
  const G = { bank: "Bank", cards: "Card", broker: "Broker", funds: "Fund" };
  const sel = h("select", { "aria-label": "What is this file?" },
    h("option", { value: "" }, "What is this file? (optional)"),
    S.map(x => h("option", { value: x.key }, `${G[x.group] || ""} · ${x.name}`)),
    h("option", { value: "maslaka" }, "מסלקה report (all funds)"),
    h("option", { value: "fund-report" }, "Fund quarterly / yearly report"),
    h("option", { value: "broker-holdings" }, "Broker holdings export"),
    h("option", { value: "other" }, "Something else"));
  if (preset) sel.value = preset;
  return sel;
}
function sendSheet(preset) {
  sheet("Update the data", body => {
    const what = whatOptions(typeof preset === "string" ? preset : "");
    const file = h("input", { type: "file", accept: ".xlsx,.xls,.xlsm,.csv,.html,.htm,.pdf,.txt", id: "upload-file", style: "font-size:15px" });
    const msg = h("p", { class: "small", style: "margin:0" });
    const btn = h("button", { class: "primary" }, "Send to the PC");
    const list = h("div", {});
    const drawList = () => {
      list.innerHTML = "";
      const sent = C.sentFiles ? C.sentFiles() : [];
      if (sent.length) list.append(h("div", { class: "kicker" }, "Sent, waiting for the PC"),
        h("div", { class: "card list", style: "padding:2px 14px" }, sent.map(f => h("div", { class: "row" },
          h("span", { class: "grow t" }, bdi(f.name), f.what ? h("div", { class: "small muted" }, f.what) : null), h("span", { class: "small muted" }, f.at.slice(5, 16).replace("T", " "))))),
        h("p", { class: "small muted" }, "The PC imports them the next time it runs and writes a new copy; then they disappear from this list."));
    };
    btn.addEventListener("click", async () => {
      const f = file.files[0];
      if (!f) { msg.textContent = "Pick a file first."; return; }
      btn.disabled = true; msg.textContent = "Encrypting and sending…";
      try { await C.upload(f, what.value); msg.textContent = `Sent ${f.name}.`; file.value = ""; drawList(); renderToday(); }
      catch (e) { msg.textContent = "Not sent: " + e.message; }
      finally { btn.disabled = false; }
    });
    body.append(h("p", { class: "small muted", style: "margin:0" }, "A bank or card export, a מסלקה report or a fund's quarterly PDF downloaded on this phone. It goes to your Drive encrypted; the PC puts it in the inbox and imports it."),
      fieldOf("What is it", what), file, btn, msg, list);
    drawList();
  });
}
export function refreshBadges() { renderReview(); renderToday(); renderTodo(); }

// ================================================================ DECIDE (PLAN-45)
// Every answer here was worked out by the PC's engine; the calculators use calc.js, a mirror of that engine.
const firstSentence = t => (t || "").split(/(?<=\.)\s/)[0];
function strategyCard(v) {
  const X = D.decide;
  if (!X) return;
  const st = X.strategy || {}, meters = (D.money || {}).meters || [], mx = st.mix;
  const off = meters.filter(m => m.state !== "inside");
  if (mx && mx.drift != null) {
    const bad = mx.out.length, color = mx.drift <= mx.drift_ok ? "var(--good)" : "var(--warn)";
    v.append(h("button", { class: "card tap", style: "text-align:left", onclick: strategySheet, "aria-label": "Your plan: how far you are from it" },
      h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "kicker grow" }, "Off your plan"),
        h("span", { class: bad ? "pill warn" : "pill" }, bad ? `${bad} of ${mx.rows.length} parts outside` : "every part inside")),
      h("div", { class: "row", style: "min-height:auto;gap:12px;align-items:flex-end" },
        h("div", {}, h("div", { class: "big num", style: `color:${color}` }, pct(mx.drift, 1)),
          h("div", { class: "small muted" }, bad ? (mx.months ? `new money fixes it in ~${mx.months} mo` : "new money alone: 20+ yrs") : "close to plan")),
        h("div", { class: "grow", html: driftSvg(mx.hist, mx.drift_ok, 180, 54, false) }))));
  } else
  v.append(h("button", { class: "card tap", style: "text-align:left", onclick: strategySheet },
    h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "kicker grow" }, "Your strategy"),
      h("span", { class: off.length ? "pill warn" : "pill" }, off.length ? `${off.length} outside the zone` : "on track")),
    h("div", { class: "mid", style: "margin-top:4px" }, off.length ? `${off[0].label}: ${pct(off[0].value)}` : "Inside the zone"),
    h("div", { class: "small muted", style: "margin-top:2px" }, off.length ? `zone ${pct(off[0].lo)}–${pct(off[0].hi)}` + (off.length > 1 ? ` · also ${off.slice(1).map(m => m.label.toLowerCase()).join(", ")}` : "") : "Both rules are met."),
    st.rebalance ? h("div", { class: "small", style: "margin-top:8px" }, firstSentence(st.rebalance.verdict)) : null));

}

// ================================================================ TO DO (PLAN-48): tasks and decisions by when
// One list from three sources: the routine (ticks), what is missing (fill in here), and the decisions the PC worked
// out (set aside, where the ₪ goes, your mix, cheaper fund, wrapper). Each row opens what does it.
let todoPeriod = "today";
function todoModel() {
  const F = D.fill || {}, X = D.decide || {}, R = D.routine || { tasks: { month: [], quarter: [], year: [] } };
  const out = { today: [], month: [], quarter: [], year: [] };
  const keys = new Set((F.todo || []).map(t => t.key)), byKey = Object.fromEntries((F.todo || []).map(t => [t.key, t]));
  const fill = (period, key, open, title) => { const t = byKey[key]; if (t) out[period].push({ type: "fill", title: title || t.title, sub: [t.minutes ? `~${t.minutes} min` : null, t.unlocks ? `unlocks ${t.unlocks}` : null].filter(Boolean).join(" · "), open }); };
  const waiting = C.pendingCount ? C.pendingCount() : 0;
  if (waiting) out.today.push({ type: "fill", title: `${waiting} change(s) still on this phone`, sub: "not sent to Drive yet — tap to send now", open: () => C.flushNow && C.flushNow() });
  const q = ((D.review || {}).queue || []).filter(g => !C.isAnswered(g.description));
  if (q.length) out.today.push({ type: "fill", title: `Answer ${q.length} uncertain transaction(s)`, sub: "Review tab", open: () => go("review") });
  const la = F.last_applied;
  if (la && la.refused) out.today.push({ type: "fill", title: `The PC could not apply ${la.refused} answer(s)`, sub: (la.why || []).join("; ").slice(0, 120), open: fillSheet });
  if (D.fill) {
    fill("today", "cash", cashSheet); fill("today", "positions", confirmSheet); fill("today", "classify", classifySheet);
    fill("today", "pots", potsSheet); fill("today", "commitment", commitmentSheet);
    if (keys.has("import")) out.today.push({ type: "info", title: byKey.import.title, sub: "The PC imports them when it next runs." });
    if (keys.has("reviews")) out.today.push({ type: "info", title: byKey.reviews.title, sub: "on the PC (Decisions)" });
    fill("month", "exports", () => filesSheet(F.files.missing_groups, "Last month's files"));
    if ((F.tags || []).length) out.month.push({ type: "fill", title: `Check ${F.tags.length} guessed tag(s)`, sub: "they decide which part of your mix each holding counts in", open: tagsSheet });
    fill("quarter", "quarterly", () => filesSheet(["broker", "funds"], "Fund and broker statements", true));
    fill("quarter", "holdings", () => filesSheet(["broker", "funds"], "Fund and broker statements", true));
  }
  if (X.savings || X.next) {
    const sv = X.savings || {}, plan = nearestPlan(sv.commitment || sv.safe);
    out.month.unshift({ type: "decision", title: "How much to set aside this month", sub: sv.ok ? `safe ${ils(sv.safe)} · stretch ${ils(sv.stretch)}` : (sv.why || "needs more months"), open: setAsideSheet },
      { type: "decision", title: "Where this month's ₪ goes", sub: plan && plan.legs.length ? `${ils(plan.amount)} → ${plan.legs[0].to}${plan.legs.length > 1 ? ` +${plan.legs.length - 1}` : ""}` : "—", open: () => whereSheet(plan ? plan.amount : null) });
  }
  const mx = (X.strategy || {}).mix;
  if (mx && mx.drift != null) out.quarter.unshift({ type: "decision", done: !mx.out.length, title: mx.out.length ? `Your mix: ${mx.out.length} part(s) outside the band` : "Your mix: every part inside",
    sub: mx.out.length ? (mx.months ? `new money fixes it in ~${mx.months} months — or move money now?` : "new money alone takes years — consider moving money") : `${pct(mx.drift, 1)} off target`, open: strategySheet });
  if (X.funds) { const w = (X.funds || []).filter(f => f.keep_move && f.keep_move.worth);
    out.quarter.push({ type: "decision", done: !w.length, title: w.length ? `${w.length} fund(s) could be cheaper` : "Funds checked against their peers", sub: w.length ? `up to ${ils(Math.max(...w.map(f => f.keep_move.difference)))} in 10 yrs` : `${X.funds.length} checked`, open: fundsSheet }); }
  const w10 = ((X.wrapper || {}).runs || []).find(r => r.years === 10);
  if (w10) out.year.push({ type: "decision", title: "Which wrapper for new money", sub: w10.worth ? `${w10.better === "gemel" ? "Investment gemel" : "Broker"} ahead by ${ils(Math.abs(w10.difference))} in 10 yrs` : "About the same — choose on the other reasons", open: wrapperSheet });
  if ((D.goals || []).length) out.year.push({ type: "decision", title: "Are the goals on track?", sub: `${D.goals.length} goal(s)`, open: () => sheet("Goals", b => b.append(h("div", { class: "card list", style: "padding:6px 14px" }, D.goals.map(goalRow)))) });
  for (const [cad, per] of [["month", "month"], ["quarter", "quarter"], ["year", "year"]])
    for (const x of R.tasks[cad] || []) out[per].push({ type: "routine", task: x, done: x.done || C.isTicked(x.key) });
  return out;
}
function todoRow(x) {
  if (x.type === "routine") return routineRow(x.task);
  const pill = x.type === "decision" ? h("span", { class: "pill", style: "flex:none" }, "decide") : x.type === "info" ? h("span", { class: "pill", style: "flex:none;opacity:.7" }, "PC") : null;
  return h(x.open ? "button" : "div", { class: "row", style: "width:100%;border:0;background:none;text-align:left;padding:6px 0" + (x.done ? ";opacity:.6" : ""), onclick: x.open || null },
    h("span", { class: "grow", style: "min-width:0" }, h("div", { class: "t", style: "font-weight:700" }, x.done ? "✓ " + x.title : x.title), x.sub ? h("div", { class: "small muted t" }, x.sub) : null),
    pill, x.open ? h("span", { class: "muted" }, "›") : null);
}
function renderTodo() {
  const v = $("#v-todo"); v.innerHTML = "";
  oldCopyNote(v);
  const T = todoModel(), L = (D.routine || {}).labels || {};
  const names = { today: "Today", month: "Month", quarter: "Quarter", year: "Year" };
  const left = k => T[k].filter(x => !x.done).length;
  v.append(h("div", { class: "seg", role: "tablist" }, Object.keys(names).map(k => h("button", { class: todoPeriod === k ? "on" : "", role: "tab", "aria-selected": String(todoPeriod === k),
    onclick: () => { todoPeriod = k; renderTodo(); } }, names[k], left(k) ? h("span", { class: "badge", style: "position:static;margin-left:4px" }, String(left(k))) : null))));
  const items = [...T[todoPeriod].filter(x => !x.done), ...T[todoPeriod].filter(x => x.done)];
  const label = todoPeriod === "today" ? "Things to do now" : `${names[todoPeriod]} · ${L[todoPeriod] || ""}`;
  const card = h("div", { class: "card list", style: "padding:4px 14px" }, h("div", { class: "kicker", style: "padding-top:8px" }, label));
  const MAX = 7;
  for (const x of items.slice(0, MAX)) card.append(todoRow(x));
  if (!items.length) card.append(h("div", { class: "row muted small" }, "Nothing here."));
  if (items.length > MAX) card.append(h("button", { class: "see-all", onclick: () => sheet(label, b => b.append(h("div", { class: "card list", style: "padding:4px 14px" }, items.map(todoRow)))) }, `All ${items.length}`));
  v.append(card);
  v.append(h("div", { class: "card list", style: "padding:2px 14px" },
    h("button", { class: "row", style: "width:100%;border:0;background:none;text-align:left;padding:6px 0", onclick: sendSheet },
      h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, "Send a file"), h("div", { class: "small muted" }, "bank, card or fund — say what it is")), h("span", { class: "muted" }, "›")),
    D.fill ? h("button", { class: "row", style: "width:100%;border:0;border-top:1px solid var(--line);background:none;text-align:left;padding:6px 0", onclick: () => balanceSheet() },
      h("span", { class: "grow" }, h("div", { style: "font-weight:700" }, "Type a balance by hand"), h("div", { class: "small muted" }, "when you have the number but no file")), h("span", { class: "muted" }, "›")) : null));
}
function nearestPlan(amount) {
  const ps = ((D.decide || {}).next || []).filter(p => p.ok !== false);
  if (!ps.length) return null;
  const a = amount || ps[0].amount;
  return ps.reduce((b, p) => Math.abs(p.amount - a) < Math.abs(b.amount - a) ? p : b, ps[0]);
}

function setAsideSheet() {
  const sv = D.decide.savings || {};
  sheet("Set aside this month", body => {
    if (!sv.ok) { body.append(h("p", { class: "muted" }, sv.why || "Needs at least 3 fully categorised months.")); return; }
    const room = sv.months.map(m => m.income - m.spending), top = Math.max(1, ...room.map(Math.abs));
    body.append(h("div", { class: "card" },
      h("div", { class: "split" }, h("div", {}, h("div", { class: "kicker" }, "Safe"), h("div", { class: "big num" }, ils(sv.safe))),
        h("div", {}, h("div", { class: "kicker" }, "Stretch"), h("div", { class: "big num" }, ils(sv.stretch)))),
      h("div", { class: "small muted", style: "margin-top:8px" },
        `Typical month: ${ils(sv.mean_income)} in, ${ils(sv.mean_spending)} spent (±${ils(sv.spread)}).` +
        (sv.planned_per_month ? ` Known expenses ahead: ${ils(sv.planned_per_month)} a month.` : "") +
        (sv.buffer != null ? ` Bank buffer ${ils(sv.buffer)}: ${sv.cash == null ? "bank balance not entered" : sv.buffer_gap > 0 ? `short by ${ils(sv.buffer_gap)}, refilled over 3 months` : "full"}.` : ""))));
    body.append(h("div", { class: "card", style: "padding:10px 14px" }, h("div", { class: "kicker" }, "Left after spending, last full months"),
      h("div", { style: "display:grid;grid-template-columns:repeat(" + room.length + ",1fr);gap:6px;align-items:end;height:84px;margin-top:8px" },
        room.map((r, i) => h("div", { style: "display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;justify-content:flex-end" },
          h("span", { class: "num", style: "font-size:10.5px;color:var(--muted)" }, Math.round(r / 100) / 10 + "k"),
          h("div", { style: `width:100%;border-radius:4px 4px 0 0;background:${r >= 0 ? "var(--accent)" : "var(--warn)"};height:${Math.max(3, 56 * Math.abs(r) / top)}px` }),
          h("span", { style: "font-size:11px;color:var(--muted)" }, MONTHS[+sv.months[i].month.slice(5, 7) - 1]))))));
    const start = sv.commitment || sv.safe, max = Math.max(1000, Math.ceil(sv.stretch * 1.5 / 500) * 500);
    const range = h("input", { type: "range", min: "0", max: String(max), step: "100", value: String(Math.min(start, max)), "aria-label": "Amount to set aside" });
    const out = h("div", { class: "answer" }), go = h("button", { class: "primary" });
    const draw = () => {
      const a = +range.value, left = sv.mean_income - sv.mean_spending - (sv.planned_per_month || 0) - a;
      const verdict = a <= sv.safe ? ["Comfortable", "fits even a weaker month"] : a <= sv.stretch ? ["Possible", "fits a typical month; a weaker one dips into the bank buffer"] : ["Too much", `about ${ils(a - sv.stretch)} a month more than a typical month leaves`];
      out.innerHTML = "";
      out.append(h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow", style: "font-weight:800" }, `Set aside ${ils(a)}`),
        h("span", { class: a <= sv.stretch ? "pill" : "pill warn" }, verdict[0])), range,
        h("div", { class: "small" }, `${verdict[1][0].toUpperCase()}${verdict[1].slice(1)}. A typical month then leaves ${ils(left)} for everything else.` +
          (sv.commitment ? ` Your commitment on the PC: ${ils(sv.commitment)}.` : "")));
      go.textContent = `See where ${ils(a)} goes`;
    };
    range.addEventListener("input", draw); draw();
    go.addEventListener("click", () => whereSheet(+range.value));
    body.append(out, go);
  });
}

function whereSheet(amount) {
  let plan = nearestPlan(amount);
  sheet("Where it goes", body => {
    const draw = () => {
      body.innerHTML = "";
      if (!plan) { body.append(h("p", { class: "muted" }, "No plan from the PC yet — classify your holdings there first.")); return; }
      const chips = h("div", { class: "chips one-line" }, (D.decide.next || []).map(p =>
        h("button", { class: "chip" + (p === plan ? " on" : ""), onclick: () => { plan = p; draw(); } }, ils(p.amount))));
      body.append(chips);
      if (amount && Math.abs(plan.amount - amount) >= 100) body.append(h("p", { class: "small muted", style: "margin:0" }, `Closest amount the PC worked out to your ${ils(amount)}.`));
      if (plan.ok === false) { body.append(h("p", {}, plan.why || "No plan for this amount.")); return; }
      body.append(h("div", { class: "card list", style: "padding:2px 14px" }, plan.legs.map(l => h("div", { class: "row", style: "padding:6px 0" },
        h("div", { class: "grow" }, h("div", { style: "font-weight:700" }, bdi(l.to)), h("div", { class: "small muted" }, [l.label, l.how || l.account].filter(Boolean).join(" · "))),
        h("span", { class: "num", style: "font-weight:800" }, ils(l.amount))))));
      if (plan.steps.length) body.append(h("div", { class: "card small", style: "display:flex;flex-direction:column;gap:6px" },
        h("div", { class: "kicker" }, "Why"), plan.steps.map(t => h("div", {}, t))));
      // "I did it": what was actually bought goes into the PC's decision log (queued until the PC runs)
      const inputs = plan.legs.map(l => h("input", { type: "number", inputmode: "decimal", value: String(Math.round(l.amount)), "aria-label": `Amount bought of ${l.to}` }));
      const note = h("input", { type: "search", placeholder: "Note (optional)", "aria-label": "Note" });
      const rec = h("button", { class: "primary" }, "I did it — record it");
      rec.addEventListener("click", async () => {
        const fields = [];
        plan.legs.forEach((l, i) => { fields.push(["to", l.to], ["amount", inputs[i].value || "0"], ["slot", l.slot || "other"]); });
        fields.push(["planned", String(plan.amount)]);
        if (note.value.trim()) fields.push(["note", note.value.trim()]);
        rec.disabled = true; rec.textContent = "Recorded ✓";
        await C.send("/next/done", fields);
      });
      body.append(h("div", { class: "card", style: "display:flex;flex-direction:column;gap:8px" }, h("div", { class: "kicker" }, "After you buy"),
        plan.legs.map((l, i) => h("div", { class: "field" }, h("label", {}, bdi(l.to)), inputs[i])), note, rec));
    };
    draw();
  });
}

// The "how far from my plan" line (PLAN-46): drift at each statement, the shaded strip is "close enough".
function driftSvg(hist, ok, W, H, axes) {
  const pts = (hist || []).filter(p => p.drift != null);
  if (pts.length < 2) return `<div class="small muted" style="text-align:right">${pts.length ? "one statement so far — the line grows each quarter" : ""}</div>`;
  const L = axes ? 34 : 2, R = 6, T = 6, B = axes ? 18 : 4;
  const top = Math.max(ok * 2, ...pts.map(p => p.drift)) * 1.15;
  const sx = i => L + (W - L - R) * i / (pts.length - 1), sy = y => T + (H - T - B) * (1 - y / top);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.drift).toFixed(1)}`).join("");
  const dots = pts.map((p, i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.drift).toFixed(1)}" r="${axes ? 3.2 : 2.4}" fill="${p.drift <= ok ? "var(--good)" : "var(--warn)"}"/>`).join("");
  const ax = axes ? [0, ok, top / 1.15].map(y => `<text x="${L - 5}" y="${(sy(y) + 4).toFixed(1)}" font-size="10" text-anchor="end" fill="var(--muted)">${Math.round(y * 100)}%</text>`).join("")
    + `<text x="${L}" y="${H - 4}" font-size="10" fill="var(--muted)">${pts[0].date.slice(0, 7)}</text><text x="${W - R}" y="${H - 4}" font-size="10" text-anchor="end" fill="var(--muted)">${pts[pts.length - 1].date.slice(0, 7)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block" role="img" aria-label="How far from your plan at each statement, last ${Math.round(pts[pts.length - 1].drift * 100)}%">
    <rect x="${L}" y="${sy(ok).toFixed(1)}" width="${W - L - R}" height="${(sy(0) - sy(ok)).toFixed(1)}" fill="var(--band)" opacity=".55"/>
    <path d="${line}" fill="none" stroke="var(--warn)" stroke-width="2" vector-effect="non-scaling-stroke"/>${dots}${ax}</svg>`;
}
// A row that opens in place to show what is behind it (the body is built on first open).
function expander(head, build) {
  const body = h("div", { class: "xp-body", hidden: true });
  const wrap = h("div", { class: "xp" });
  let built = false;
  const btn = h("button", { class: "xp-head", "aria-expanded": "false", onclick: () => {
    const open = body.hidden;
    if (open && !built) { build(body); built = true; }
    body.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open) wrap.setAttribute("data-open", ""); else wrap.removeAttribute("data-open");
  } }, head, h("span", { class: "chev", "aria-hidden": "true" }, "›"));
  wrap.append(btn, body);
  return wrap;
}
const DIM_LABEL = { horizon: { safe: "Safe", mid: "Mid", long: "Long" },
  asset: { stocks: "stocks", bonds: "bonds", cash: "cash", real_estate: "real estate", other: "other assets" },
  market: { israel: "Israel", us: "US", dev_ex_us: "other developed", emerging: "emerging", other: "other markets" },
  kind: { index: "index funds", active: "active funds", stock: "single stocks", track: "gemel / hishtalmut tracks", deposit: "deposits", other: "other kinds" } };
function whereText(w) {
  const parts = Object.entries(w || {}).filter(([, v]) => v && v.length).map(([d, v]) => v.map(x => (DIM_LABEL[d] || {})[x] || x).join(" or "));
  return parts.length ? parts.join(" · ") : "everything not taken by the parts above";
}
function mixCard(mx) {
  const pos = v => `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
  return h("div", { class: "card", style: "display:flex;flex-direction:column;gap:10px" },
    h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "kicker grow" }, mx.custom ? "Your mix" : "Your two bands, as three parts"),
      h("span", { class: "small muted num" }, ils(mx.value))),
    h("div", { html: driftSvg(mx.hist, mx.drift_ok, 320, 120, true) }),
    h("p", { class: "small muted", style: "margin:0" }, `${pct(mx.drift, 1)} of the money would have to move to be exactly on target. Below the shaded strip (${pct(mx.drift_ok)}) is close enough; act on a part that leaves its band — new money first.`),
    h("div", { class: "small muted" }, "Tap a part to see which holdings are in it and why."),
    mx.rows.map(r => expander(
      [h("span", { class: "grow", style: "min-width:0" },
         h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow small", style: "font-weight:700" }, r.name),
           h("span", { class: r.state === "inside" ? "pill" : "pill warn" }, `${pct(r.share)} · aim ${pct(r.target)}`)),
         h("div", { class: "bar", style: "margin-top:6px;height:8px" },
           h("i", { class: "band", style: `left:${pos(r.lo)};width:calc(${pos(r.hi)} - ${pos(r.lo)})` }),
           h("i", { class: "aim", style: `left:${pos(r.target)}` }),
           h("b", { style: `left:${pos(r.share || 0)};width:4px;background:${r.state === "inside" ? "var(--ink)" : "var(--warn)"};opacity:1;border-radius:2px` })),
         h("div", { class: "small muted", style: "margin-top:2px" }, `band ${pct(r.lo)}–${pct(r.hi)} · ` + (r.gap == null ? "" : r.gap >= 0 ? `buy ${ils(r.gap)}` : `${ils(-r.gap)} over`)))],
      body => {
        body.append(h("div", { class: "small muted" }, r.id === "_rest" ? "Money no part takes — it counts as off plan. Add a part for it, or widen one, on the PC (Your mix)." : `Counts: ${whereText(r.where)}.`));
        if (!(r.detail || []).length) body.append(h("div", { class: "small muted" }, "Nothing in this part yet."));
        for (const d of r.detail || []) body.append(h("div", { class: "xp-item" },
          h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "nm grow t" }, bdi(d.name)), h("span", { class: "num small", style: "font-weight:700" }, ils(d.value))),
          d.value < d.of - 1 ? h("div", { class: "why" }, `${ils(d.value)} of its ${ils(d.of)}: ` + d.pieces.map(x => `${x.what} ${ils(x.value)}`).join(", ")) : null,
          h("div", { class: "why" }, d.why)));
      })),
    (mx.caps || []).map(c => h("div", { class: c.over ? "small answer" : "small muted" }, `Limit ${c.name}: ${pct(c.share, 1)} of at most ${pct(c.max)}${c.over ? " — over" : " ✓"}`)),
    mx.guessed ? h("button", { class: "chip", onclick: () => tagsSheet() }, `${mx.guessed} holding(s) have guessed tags — fix them ›`) : null);
}

function strategySheet() {
  const st = D.decide.strategy || {}, M = D.money || {};
  sheet("Is the strategy working?", body => {
    oldCopyNote(body);
    if (st.mix && st.mix.drift != null) body.append(mixCard(st.mix));
    const hz = (st.mix || {}).horizons || [];
    const sl = hz.length ? [] : (st.sleeves || []);
    if (hz.length) {
      const col = { safe: "var(--save)", mid: "var(--left)", long: "var(--need)", none: "var(--muted)" };
      const tot = hz.reduce((a, x) => a + x.value, 0) || 1;
      body.append(h("div", { class: "card" }, h("div", { class: "kicker" }, "Money you can reach, by horizon"),
        h("div", { style: "display:flex;height:14px;border-radius:7px;overflow:hidden;margin:10px 0" },
          hz.map(x => h("i", { style: `width:${(100 * x.value / tot).toFixed(1)}%;background:${col[x.id]}` }))),
        h("div", { class: "small muted" }, "Tap a horizon to see its holdings and why each is there."),
        hz.map(x => expander([h("span", { class: "dot", style: `background:${col[x.id]}` }), h("span", { class: "grow" }, x.label),
            h("span", { class: "small muted num" }, pct(x.value / tot)), h("span", { class: "num", style: "font-weight:700;width:86px;text-align:right" }, ils(x.value))],
          b => { for (const it of x.holdings) b.append(h("div", { class: "xp-item" },
            h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "nm grow t" }, bdi(it.name)), h("span", { class: "num small", style: "font-weight:700" }, ils(it.value))),
            h("div", { class: "why" }, it.why + (it.legacy ? " Legacy: gets no new money." : "")),
            it.facts ? h("div", { class: "why" }, it.facts) : null)); }))));
    }
    if (sl.length) {
      const col = { safe: "var(--save)", mid: "var(--left)", long: "var(--need)", cash: "var(--muted)" };
      body.append(h("div", { class: "card" }, h("div", { class: "kicker" }, "Money you can reach, by horizon"),
        h("div", { style: "display:flex;height:14px;border-radius:7px;overflow:hidden;margin:10px 0" },
          sl.map(s => h("i", { style: `width:${(s.share * 100).toFixed(1)}%;background:${col[s.id] || "var(--line)"}` }))),
        h("div", { class: "list" }, sl.map(s => h("div", { class: "row", style: "min-height:34px" },
          h("span", { class: "dot", style: `background:${col[s.id] || "var(--line)"}` }), h("span", { class: "grow" }, s.label),
          h("span", { class: "small muted num" }, pct(s.share)), h("span", { class: "num", style: "font-weight:700;width:86px;text-align:right" }, ils(s.value)))))));
    }
    if ((M.meters || []).length) body.append(h("div", { class: "card", style: "display:flex;flex-direction:column;gap:14px" }, M.meters.map(meter)));
    const r = st.record;
    if (r && r.statements) body.append(h("div", { class: "card" }, h("div", { class: "kicker" }, `How it went · ${r.years} yrs, ${r.statements} statements`),
      h("div", { class: "split", style: "margin-top:8px" },
        h("div", {}, h("div", { class: "small muted" }, "Your money, a year"), h("div", { class: "mid num" }, pct(r.twr_yearly, 1))),
        h("div", {}, h("div", { class: "small muted" }, "Your strategy's own mix"), h("div", { class: "mid num" }, r.benchmark_yearly == null ? "—" : pct(r.benchmark_yearly, 1)))),
      h("p", { class: "small muted", style: "margin:8px 0 0" }, `After fees, deposits taken out. Covers ${pct(r.covered_share)} of the money. ` +
        (r.benchmark_yearly == null ? "The market history is not loaded on the PC yet." : r.twr_yearly >= r.benchmark_yearly - 0.005 ? "In line with the strategy." :
          `Behind the strategy's own mix by ${pct(r.benchmark_yearly - r.twr_yearly, 1)} a year over this period.`))));
    const rb = st.rebalance;
    if (rb) body.append(h("div", { class: "card", style: "display:flex;flex-direction:column;gap:8px" }, h("div", { class: "kicker" }, "Move money now, or let new money fix it?"),
      h("div", { class: "small" }, rb.verdict),
      (rb.options || []).map(o => h("div", { style: "border-top:1px solid var(--line);padding-top:8px" },
        h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow", style: "font-weight:700" }, o.title), o.id === rb.best ? h("span", { class: "pill" }, "best") : null),
        h("div", { class: "small muted" }, o.detail),
        h("div", { class: "small num" }, `tax ${ils(o.tax)} · trading ${ils(o.trading)} · waiting cost ${ils(o.total)}`)))));
  });
}

function fundsSheet() {
  const F = D.decide.funds || [], E = D.expect || { inflation: 0.02 };
  sheet("Cheaper fund or provider", body => {
    if (!F.length) { body.append(h("p", { class: "muted" }, "No fund is linked to the regulator's data yet — do it on the PC (Holdings → Refresh from the regulator).")); return; }
    body.append(h("p", { class: "small muted", style: "margin:0" }, "Each fund against the regulator's peers of the same kind. Moving a gemel, hishtalmut or pension (ניוד) is free and tax-free; seniority stays."));
    for (const f of F) {
      const km = f.keep_move, c = f.cheaper;
      const card = h("div", { class: "card", style: "display:flex;flex-direction:column;gap:6px" },
        h("div", { class: "row", style: "min-height:auto" }, h("span", { class: "grow t", style: "font-weight:800" }, bdi(f.name)), h("span", { class: "num", style: "font-weight:700" }, ils(f.value))),
        h("div", { class: "small muted" }, `fee ${pct(f.fee, 2)} vs peers ${pct(f.fee_median, 2)}` + (f.level ? ` · returns ${f.level}` : "") + (f.rank ? ` (${f.rank[0]} of ${f.rank[1]}, ${f.horizon})` : "")));
      if (c && km) {
        card.append(h("div", { class: "answer small" }, h("b", {}, km.worth ? "Worth moving. " : "Small difference. "),
          `${c.company}: `, bdi(c.name), ` charges ${pct(c.fee, 2)}. Same returns assumed: `, h("b", { class: "nw" }, ils(km.difference, true)), ` after ${km.years} years (today's ₪), `, h("span", { class: "nw" }, ils(km.first_year_saving)), " in the first year."));
        const yrs = h("input", { type: "range", min: "1", max: "30", value: "10", "aria-label": "Years" });
        const res = h("div", { class: "small" });
        const draw = () => { const r = calc.fund(f.value, +yrs.value, 0, f.gross, f.gross, f.fee, c.fee, E.inflation);
          res.textContent = `Over ${yrs.value} years: ${ils(r.difference, true)} by moving (fees ${ils(r.fees_keep)} vs ${ils(r.fees_move)}).`; };
        yrs.addEventListener("input", draw); draw();
        card.append(yrs, res);
      } else card.append(h("div", { class: "small" }, f.fee != null && f.fee_median != null && f.fee <= f.fee_median ? "Fee at or below its peers — nothing to gain from moving on fees." : "No cheaper peer with returns at least as good."));
      body.append(card);
    }
  });
}

function wrapperSheet() {
  const W = D.decide.wrapper;
  sheet("Which wrapper for new money", body => {
    if (!W) { body.append(h("p", { class: "muted" }, "Not available in this copy.")); return; }
    const st = { monthly: W.monthly, years: 10, fb: W.fee_broker, fg: W.fee_gemel };
    const amt = h("input", { type: "number", inputmode: "numeric", value: String(st.monthly), step: "100", "aria-label": "Every month" });
    const yrs = h("input", { type: "range", min: "1", max: "30", value: "10", "aria-label": "Years" }), yLab = h("label", {});
    const fb = h("input", { type: "number", inputmode: "decimal", step: "0.05", value: (st.fb * 100).toFixed(2), "aria-label": "Broker fee %" });
    const fg = h("input", { type: "number", inputmode: "decimal", step: "0.05", value: (st.fg * 100).toFixed(2), "aria-label": "Gemel fee %" });
    const out = h("div", { class: "answer" });
    const draw = () => {
      const m = Math.max(0, parseFloat(amt.value) || 0), y = +yrs.value, b = (parseFloat(fb.value) || 0) / 100, g = (parseFloat(fg.value) || 0) / 100;
      const trade = m === W.monthly ? W.trade_cost : Math.max(10, m * 0.001);
      const r = calc.newMoney(m, y, W.gross, b, g, trade, W.inflation);
      yLab.textContent = `Years: ${y}`;
      out.innerHTML = "";
      out.append(h("div", { class: "split" },
        h("div", {}, h("div", { class: "small muted" }, "Broker"), h("div", { class: "mid num" }, ils(r.broker))),
        h("div", {}, h("div", { class: "small muted" }, "Investment gemel"), h("div", { class: "mid num" }, ils(r.gemel)))),
        h("div", { class: "small", style: "margin-top:6px" }, (r.worth ? `${r.better === "gemel" ? "The investment gemel" : "The broker"} leaves ${ils(Math.abs(r.difference))} more` :
          `About the same (${ils(Math.abs(r.difference))})`) + ` after ${y} years — today's ₪, after fees and 25% tax on the real gain. Both assume ${pct(W.gross, 1)} a year before fees.` +
          (m * 12 > W.ceiling ? ` Above the gemel ceiling of ${ils(W.ceiling)} a year per person.` : "")));
    };
    [amt, yrs, fb, fg].forEach(x => x.addEventListener("input", draw));
    body.append(h("div", { class: "split" }, h("div", { class: "field" }, h("label", {}, "Every month (₪)"), amt), h("div", { class: "field" }, yLab, yrs)),
      h("div", { class: "split" }, h("div", { class: "field" }, h("label", {}, "Broker fee %/yr"), fb), h("div", { class: "field" }, h("label", {}, "Gemel fee %/yr"), fg)), out);
    draw();
    const R = W.rules || {};
    for (const k of ["broker", "gemel_invest", "hishtalmut"]) {
      const x = R[k]; if (!x) continue;
      body.append(h("details", { class: "card" }, h("summary", { style: "font-weight:700;min-height:32px" }, x.name),
        h("div", { class: "small", style: "display:flex;flex-direction:column;gap:4px;margin-top:6px" },
          [["Who deposits", x.who], ["When you can take it", x.liquid], ["Tax", x.tax], ["Switching", x.switch]].filter(r => r[1]).map(([a, b]) => h("div", {}, h("b", {}, a + ": "), b)))));
    }
    body.append(h("p", { class: "small muted" }, "Not priced here: the gemel's tax-free track switches (rebalancing without tax) and the hishtalmut's tax-free gain, which needs deposits through an employer or as self-employed."));
  });
}
