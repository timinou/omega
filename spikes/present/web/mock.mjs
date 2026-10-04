// spikes/present/web/mock.mjs — a DESIGN MOCK of the next interface step
// (spikes/present-pipeline.bl.md §"Next: scroll and type"). Not bl-ed: plain
// DOM over the same /api the editor reads, to see the typography and the
// one-screen overview with REAL tasks before deciding what the presentation
// pipeline must grow (:flow marks, sticky headers, a split view).
//
//   one screen:  rail (inbox · running · finished) | conversation of the selected task
//   conversation: what YOU said is the large, sticky headline; the model's
//                 work hangs under it as follow-ups; tools fold to one line
//   keys:        j/k move in the rail AND the conversation follows (no Enter)
//                J/K jump question to question · / filters · y/n answer · i writes

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};
const api = async (p) => (await (await fetch("/api/doc?path=" + encodeURIComponent(p))).json());

// ─── reading the documents omega already prints ────────────────────────────

function readTask(text) {
  const L = text.split("\n");
  const [, id, slug, state, age] = (L[0].match(/^#\+TITLE: (t-\d+) · (.*?) · (.*?) · (.*)$/) || []);
  const turns = []; let cur = null; let i = 1;
  while (i < L.length) {
    const l = L[i];
    const hm = l.match(/^\* (you|model) · (\d+)/);
    if (hm) { cur = { who: hm[1], n: +hm[2], parts: [] }; turns.push(cur); i++; continue; }
    if (/^\* ⚑ asks you/.test(l)) { cur = { who: "ask", parts: [] }; turns.push(cur); i++; continue; }
    if (/^\* (traces|say ▸)/.test(l)) { cur = null; i++; continue; }
    if (!cur) { i++; continue; }
    if (/^#\+begin_src/.test(l)) {
      const code = []; i++;
      while (i < L.length && !/^#\+end_src/.test(L[i])) code.push(L[i++]);
      i++;
      let out = [];
      if (/^#\+RESULTS/.test(L[i] || "")) { i++; while (i < L.length && /^:( |$)/.test(L[i])) out.push(L[i++].replace(/^: ?/, "")); }
      cur.parts.push({ kind: "tool", code, out });
      continue;
    }
    if (cur.who === "ask") { if (l.trim()) cur.parts.push({ kind: "ask", text: l.replace(/^⚑\s*/, "").split("   ")[0] }); i++; continue; }
    const last = cur.parts[cur.parts.length - 1];
    if (last && last.kind === "prose") last.lines.push(l); else cur.parts.push({ kind: "prose", lines: [l] });
    i++;
  }
  return { id, slug, state: state || "", age: age || "", turns };
}

function readOverview(j) {
  const L = j.text.split("\n"); const rows = []; let group = null;
  for (let r = 0; r < L.length; r++) {
    const g = L[r].match(/^\* (.*?) \((\d+)\)/); if (g) { group = g[1]; continue; }
    const o = (j.objects || []).find((x) => x.row === r && x.type === "omega/task");
    if (o) {
      const m = L[r].match(/^\S+ (t-\d+)\s+(.*?) — (.*?)\s+· (\S+) · (.*)$/) || [];
      rows.push({ id: o.key, group, slug: m[2] || "", summary: m[3] || L[r], age: m[4] || "", home: m[5] || "" });
    }
  }
  return rows;
}

// ─── markdown-ish prose → typography (headings, bold, code, lists) ─────────

function inline(s) {
  const out = []; const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g; let k = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > k) out.push(s.slice(k, m.index));
    const t = m[0];
    out.push(t.startsWith("**") ? h("strong", null, t.slice(2, -2)) : t.startsWith("`") ? h("code", null, t.slice(1, -1)) : h("em", null, t.slice(1, -1)));
    k = m.index + t.length;
  }
  if (k < s.length) out.push(s.slice(k));
  return out;
}
function prose(lines) {
  const box = h("div", "prose"); let list = null;
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (!l.trim()) { list = null; continue; }
    if (/^---+$/.test(l)) { box.append(h("hr")); list = null; continue; }
    const li = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (li) { if (!list) { list = h(/^\s*\d/.test(l) ? "ol" : "ul"); box.append(list); } list.append(h("li", null, inline(li[1]))); continue; }
    list = null;
    const lead = l.match(/^\*\*([^*]+)\*\*\s*$/);
    box.append(lead ? h("h4", null, lead[1]) : h("p", null, inline(l)));
  }
  return box;
}

function toolLine(t) {
  const calls = t.code.map((c) => c.trim()).filter(Boolean);
  const label = calls.map((c) => c.replace(/^\(println /, "(").replace(/\s+/g, " ")).join("  ·  ");
  const n = t.out.filter((x) => x.trim()).length;
  const d = h("details", "tool");
  d.append(h("summary", null, h("span", "tool-glyph", "⌁"), h("span", "tool-code", label.length > 110 ? label.slice(0, 109) + "…" : label),
             n ? h("span", "tool-n", `⇒ ${n} line${n === 1 ? "" : "s"}`) : null));
  d.append(h("pre", "tool-src", t.code.join("\n")));
  if (n) d.append(h("pre", "tool-out", t.out.join("\n")));
  return d;
}

// ─── the conversation: questions are headlines, work is follow-up ──────────

// what you said, as words: a task handed over as `: #omega/task {:id … :goal "…"}` reads as its goal
function said(turn) {
  const s = turn ? turn.parts.flatMap((p) => p.lines || []).join(" ").trim() : "";
  const g = s.match(/#omega\/task \{.*?:goal "([^"]*)"/);
  return g ? "task " + (s.match(/:id "([^"]*)"/) || [])[1] + ": " + g[1] : s.replace(/^:\s*/, "");
}

function conversation(task) {
  const root = h("article", "conv");
  root.append(h("header", "conv-head",
    h("div", "conv-id", task.id, h("span", "state " + stateClass(task.state), task.state), h("span", "age", task.age)),
    h("h1", null, said(task.turns.find((t) => t.who === "you")) || task.slug.replace(/-/g, " "))));
  // a THREAD = one thing you said + everything the model did until you spoke again
  const threads = []; let th = null;
  for (const t of task.turns) {
    if (t.who === "you") { th = { you: t, follow: [] }; threads.push(th); }
    else { if (!th) { th = { you: null, follow: [] }; threads.push(th); } th.follow.push(t); }
  }
  threads.forEach((thr, k) => {
    const sec = h("section", "thread"); sec.dataset.k = k;
    const q = said(thr.you);
    // the first thing you said is the page's h1; every later one is a sticky h2
    if (k > 0 && q) sec.append(h("h2", "q", h("span", "q-n", "you · " + thr.you.n), q));
    const steps = thr.follow.filter((t) => t.who === "model");
    const tools = steps.flatMap((t) => t.parts.filter((p) => p.kind === "tool"));
    const answerTurn = [...steps].reverse().find((t) => t.parts.some((p) => p.kind === "prose" && p.lines.some((l) => l.trim())));
    if (tools.length) {
      const work = h("div", "work", h("div", "work-head", `${tools.length} step${tools.length === 1 ? "" : "s"} of work`));
      tools.forEach((t) => work.append(toolLine(t)));
      sec.append(work);
    }
    for (const t of steps) for (const p of t.parts) if (p.kind === "prose" && t !== answerTurn && p.lines.some((l) => l.trim()))
      sec.append(h("div", "aside", prose(p.lines)));
    if (answerTurn) for (const p of answerTurn.parts) if (p.kind === "prose") sec.append(h("div", "answer", prose(p.lines)));
    for (const a of thr.follow.filter((t) => t.who === "ask")) for (const p of a.parts)
      sec.append(h("div", "ask", h("span", "ask-flag", "⚑ asks you"), h("p", null, p.text), h("div", "ask-keys", h("kbd", null, "y"), " yes  ", h("kbd", null, "n"), " no  ", h("kbd", null, "i"), " answer")));
    root.append(sec);
  });
  return { root, threads };
}
const stateClass = (s) => s.includes("your turn") ? "yours" : s.includes("running") ? "running" : s.includes("done") ? "done" : s.includes("failed") ? "failed" : "";

// ─── the one screen ─────────────────────────────────────────────────────────

let rows = [], sel = 0, task = null, threads = [];
const GROUP_ORDER = ["Needs you", "Running", "Waiting", "Stale", "Finished"];

function drawRail() {
  const rail = $("#rail"); rail.textContent = "";
  const q = $("#filter").value.toLowerCase();
  const shown = rows.filter((r) => !q || (r.id + r.slug + r.summary).toLowerCase().includes(q));
  for (const g of GROUP_ORDER) {
    const rs = shown.filter((r) => r.group === g);
    if (!rs.length) continue;
    rail.append(h("div", "group", g, h("span", "count", rs.length)));
    for (const r of rs) {
      const i = rows.indexOf(r);
      const e = h("div", "row" + (i === sel ? " picked" : "") + (g === "Needs you" ? " needs" : ""),
        h("div", "row-top", h("span", "row-id", r.id), h("span", "row-age", r.age)),
        h("div", "row-title", r.slug.replace(/-/g, " ")),
        h("div", "row-sum", r.summary.replace(/\*\*/g, "")));
      e.onclick = () => select(i);
      rail.append(e);
    }
  }
  $("#rail .picked")?.scrollIntoView({ block: "nearest" });
}

async function select(i) {
  sel = Math.max(0, Math.min(rows.length - 1, i)); drawRail();
  const r = rows[sel]; if (!r) return;
  const j = await api("task:" + r.id);
  if (rows[sel] !== r) return;           // a later j/k won
  task = readTask(j.text);
  const c = conversation(task); threads = c.threads;
  const pane = $("#pane"); pane.textContent = ""; pane.append(c.root); pane.scrollTop = 0;
  drawIndex();
  $("#composer-to").textContent = task.state.includes("done") ? "new task ▸" : "say to " + task.id + " ▸";
}

// the question index: every thing you said, a scroll-spy (the minimap of a conversation)
function drawIndex() {
  const ix = $("#index"); ix.textContent = "";
  threads.forEach((t, k) => {
    const label = said(t.you) || "(start)";
    const e = h("div", "ix", h("span", "ix-n", k + 1), label.length > 60 ? label.slice(0, 59) + "…" : label);
    e.onclick = () => $(`.thread[data-k="${k}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    ix.append(e);
  });
  spy();
}
function spy() {
  const pane = $("#pane"); let at = 0;
  pane.querySelectorAll(".thread").forEach((s) => { if (s.offsetTop - pane.offsetTop <= pane.scrollTop + 40) at = +s.dataset.k; });
  document.querySelectorAll("#index .ix").forEach((e, k) => e.classList.toggle("at", k === at));
  return at;
}

async function load() {
  rows = readOverview(await api("omega:overview"));
  $("#total").textContent = `${rows.length} tasks · ${rows.filter((r) => r.group === "Needs you").length} need you`;
  await select(sel);
}

// ─── keys: the rail drives the pane (no Enter, no second screen) ───────────

document.addEventListener("keydown", (e) => {
  const typing = document.activeElement === $("#composer-text") || document.activeElement === $("#filter");
  if (e.key === "Escape") { document.activeElement.blur(); return; }
  if (typing) {
    if (e.key === "Enter" && document.activeElement === $("#composer-text")) { e.preventDefault(); send(); }
    if (document.activeElement === $("#filter")) setTimeout(drawRail);
    return;
  }
  const pane = $("#pane");
  const jump = (d) => { const k = Math.max(0, Math.min(threads.length - 1, spy() + d)); $(`.thread[data-k="${k}"]`)?.scrollIntoView({ block: "start" }); };
  const keys = {
    j: () => select(sel + 1), k: () => select(sel - 1),
    J: () => jump(1), K: () => jump(-1),
    " ": () => pane.scrollBy({ top: pane.clientHeight * 0.8 }),
    G: () => { pane.scrollTop = pane.scrollHeight; }, g: () => { pane.scrollTop = 0; },
    "/": () => $("#filter").focus(),
    i: () => $("#composer-text").focus(),
    y: () => answer("yes"), n: () => answer("no"),
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
});
$("#pane").addEventListener("scroll", spy);

async function intent(name, args) {
  const r = await fetch("/api/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: name, args }) });
  return r.json();
}
async function send() {
  const t = $("#composer-text"); const text = t.value.trim(); if (!text || !task) return;
  const r = task.state.includes("done") ? await intent("task/open", { goal: text }) : await intent("task/say", { id: task.id, text });
  $("#echo").textContent = r.ok ? (task.state.includes("done") ? "opened " + r.id : "sent to " + task.id) : "error: " + (r.message || JSON.stringify(r));
  t.value = ""; t.blur(); setTimeout(load, 1500);
}
async function answer(a) {
  const j = task && await api("task:" + task.id);
  const o = j && (j.objects || []).find((x) => x.type === "omega/msg");
  if (!o) { $("#echo").textContent = "no question waiting"; return; }
  const r = await intent("msg/answer", { msg: o.key, text: a });
  $("#echo").textContent = r.ok ? `answered ${a}` : "error: " + (r.message || "");
  setTimeout(load, 1500);
}

await load();
setInterval(load, 15000);
window.mock = { load, select, readTask, readOverview };
