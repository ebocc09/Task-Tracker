/* ============================================================================
   Task Tracker — rendering, overlays, and the main board
   ========================================================================== */
"use strict";

/* ─────────────────────────────── glyphs ────────────────────────────────── */

const ICON = {
  pending : '<circle cx="12" cy="12" r="8.5"/>',
  complete: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.2 2.5 2.5 4.7-5"/>',
  blocked : '<circle cx="12" cy="12" r="8.5"/><path d="m8.6 8.6 6.8 6.8"/>',
  check   : '<path d="M20 6 9 17l-5-5"/>',
  slash   : '<circle cx="12" cy="12" r="9"/><path d="m8.4 8.4 7.2 7.2"/>',
  // A clock face for a running timer, and a crossed one for a task that ran out.
  in_progress: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
  failed  : '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6v4.9"/><path d="M12 15.8h.01"/>',
  play    : '<path d="M8 5.5v13l10-6.5z"/>',
  lock    : '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  undo    : '<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.1-6.4L3 9"/>',
  up      : '<path d="m6 15 6-6 6 6"/>',
  down    : '<path d="m6 9 6 6 6-6"/>',
  pencil  : '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  x       : '<path d="M18 6 6 18M6 6l12 12"/>'
};

const svg = (paths, cls) =>
  `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const STATUS = {
  pending : { label:"Pending",            pill:"idle", verb:"reopened"  },
  complete: { label:"Complete",           pill:"ok",   verb:"completed" },
  blocked : { label:"Could not complete", pill:"bad",  verb:"marked blocked on" },
  // Timed tasks only. "failed" is terminal — nothing reopens it, by design.
  in_progress: { label:"In progress",     pill:"info", verb:"started" },
  failed  : { label:"Failed",             pill:"bad",  verb:"failed" },
  /* Retired in BUILD 29 — a task is completed or it is not, and "partial" was
     the fuzzy middle. No live task can hold it any more (normalize() migrates
     it to blocked), and nothing offers it as an action. It stays here so reset
     snapshots taken while it existed still render their real labels rather
     than quietly reading "Pending". Do not put it back on a button. */
  partial : { label:"Partial",            pill:"warm", verb:"partially completed" }
};

/* ─────────────────────────────── toasts ────────────────────────────────── */

function toast(message, kind = ""){
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  const mark = kind === "bad"
    ? '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
    : kind === "good" ? ICON.check
    : '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>';
  el.innerHTML = svg(mark) + `<span>${escHtml(message)}</span>`;
  $("toasts").appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  }, kind === "bad" ? 6200 : 3600);
}

/* ────────────────────────── overlay plumbing ───────────────────────────── */

const OVERLAYS = ["userModal","adminModal","scanModal"];
let lastFocus = null;

function anyOverlayOpen(){
  return OVERLAYS.some(id => $(id).classList.contains("on")) || $("confirm").classList.contains("on");
}

function syncScrollLock(){
  const open = anyOverlayOpen();
  if(open === document.body.classList.contains("no-scroll")) return;
  if(open){
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.paddingRight = gap > 0 ? gap + "px" : "";
    document.body.classList.add("no-scroll");
  }else{
    document.body.classList.remove("no-scroll");
    document.body.style.paddingRight = "";
  }
}

/* Land focus on the field someone opened the dialog to fill in. Document order
   alone always picks the close X — it's the first button in every modal head —
   so the first keystroke went nowhere until you clicked. Text fields win,
   buttons are the fallback, and anything hidden is skipped so the passcode
   boxes can't swallow focus while the unlocked panel is the thing on screen.
   No select(): reopening shouldn't put a half-typed draft one keystroke from
   being wiped. */
function focusFirst(root, preferred){
  const usable = el => el && !el.disabled && el.offsetParent !== null;
  const pick   = sel => [...root.querySelectorAll(sel)].find(usable);
  const target = (preferred && pick(preferred))
              || pick("input:not([type=hidden]),textarea,select")
              || pick("button.solid")
              || pick("button");
  if(target) target.focus();
}

function openModal(id, focusSel){
  lastFocus = document.activeElement;
  closePlateMenu();
  // Switching dialogs must not leave the camera running behind the new one.
  // openScanner starts its stream after calling this, so it is unaffected.
  stopScanner();
  OVERLAYS.forEach(o => { if(o !== id) $(o).classList.remove("on"); });
  $(id).classList.add("on");
  $("scrim").classList.add("on");
  syncScrollLock();
  setTimeout(() => focusFirst($(id), focusSel), 90);
}

function closeOverlays(){
  stopScanner();
  OVERLAYS.forEach(id => $(id).classList.remove("on"));
  $("scrim").classList.remove("on");
  syncScrollLock();
  if(lastFocus && lastFocus.focus){ lastFocus.focus(); lastFocus = null; }
}

/* Focus trap for whichever modal is on top. */
document.addEventListener("keydown", e => {
  if(e.key !== "Tab") return;
  const open = $("confirm").classList.contains("on")
    ? $("confirm")
    : OVERLAYS.map($).find(m => m.classList.contains("on"));
  if(!open) return;
  const items = [...open.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if(!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
});

/* Promise-based confirm, replacing window.confirm. */
let confirmResolve = null;
let confirmHasInput = false;
let confirmRequire = false;

/* Options:
   - solo:true   one button, an acknowledgement ("you may not do that").
   - input:{...} adds a text field; the promise then resolves with the trimmed
                 string (or false on cancel) instead of a boolean. */
function askConfirm({ title, text, facts = [], yes = "Confirm", no = "Cancel", danger = false, solo = false, input = null } = {}){
  if(confirmResolve) closeConfirm(false);
  $("confirmTitle").textContent = title || "Are you sure?";
  $("confirmText").textContent  = text || "";
  $("confirmIc").className = "confirm-ic" + (danger ? "" : " calm");

  const field = $("confirmField"), inp = $("confirmInput");
  confirmHasInput = !!input;
  confirmRequire  = !!(input && input.required);
  if(input){
    inp.value = input.value != null ? String(input.value) : "";
    inp.placeholder = input.placeholder || "";
    inp.maxLength = input.maxlength || 80;
    field.hidden = false;
  }else{
    field.hidden = true;
  }

  const box = $("confirmFacts");
  box.innerHTML = facts.map(([k,v]) =>
    `<div class="cf"><span>${escHtml(k)}</span><span>${escHtml(v)}</span></div>`).join("");
  box.hidden = facts.length === 0;

  const yesBtn = $("confirmYes");
  yesBtn.textContent = yes;
  yesBtn.className = "btn-block " + (danger ? "red" : "solid");
  // A required input keeps the confirm button disabled until something's typed.
  yesBtn.disabled = confirmRequire && !inp.value.trim();
  $("confirmNo").textContent = no;
  $("confirmNo").hidden = solo;

  $("confirm").classList.add("on");
  $("confirmScrim").classList.add("on");
  syncScrollLock();
  setTimeout(() => { if(input){ inp.focus(); inp.select(); } else yesBtn.focus(); }, 60);
  return new Promise(resolve => { confirmResolve = resolve; });
}

// What the Confirm button hands back: the field's value in input mode, else true.
const confirmAnswer = () => confirmHasInput ? $("confirmInput").value : true;

function closeConfirm(answer){
  $("confirm").classList.remove("on");
  $("confirmScrim").classList.remove("on");
  syncScrollLock();
  const r = confirmResolve;
  confirmResolve = null;
  if(r) r(answer);
}

/* ─────────────────────────────── timers ────────────────────────────────
   A timed task is given a limit in minutes when it is added. It sits Pending
   until someone presses Start; from that moment it has until the deadline to
   be completed, and if it isn't, it fails and locks.

   Nothing runs when the tab is closed — this is a static page whose only
   backend is a JSON file on GitHub. So expiry is DERIVED for display and
   PERSISTED opportunistically:

     · effectiveStatus() reports "failed" the moment the deadline passes,
       whatever data.json still says. Every display path reads it, so the board
       is right immediately for everyone — including viewers, who cannot write.
     · sweepExpiredTimers() further down writes that conclusion back, from the
       first member client to notice. The mutator no-ops unless the stored
       status is still in_progress, so racing clients converge on one write.
     · The lock itself lives in the mutators, not the buttons. A tab left open
       from before the deadline still has a live Complete button; pressing it
       is rejected at the moment of writing.

   The consequence to know about: if nobody with write access opens the board
   for a week, the failure shows correctly all week but is not recorded in the
   audit log until someone does. Fixing that properly needs a server. */

const isTimed = t => t.timed === true && Number(t.limitMinutes) > 0;

// null unless the clock is actually running — an unstarted timed task has no
// deadline at all, which is what keeps it sitting Pending indefinitely.
const deadlineOf = t => {
  if(!isTimed(t) || !t.startedAt) return null;
  const started = Date.parse(t.startedAt);
  return Number.isNaN(started) ? null : started + t.limitMinutes * 60000;
};

const msLeft = (t, now = Date.now()) => {
  const d = deadlineOf(t);
  return d == null ? null : d - now;
};

const isExpired = (t, now = Date.now()) => {
  if(t.status !== "in_progress") return false;      // only a running clock expires
  const left = msLeft(t, now);
  return left != null && left <= 0;
};

/* The status to SHOW and to count, as opposed to the one on disk. They differ
   only for a running timer that has passed its deadline and has not been
   written back yet. */
const effectiveStatus = (t, now = Date.now()) => isExpired(t, now) ? "failed" : t.status;

// How long a finished timed task actually took. Null unless both ends exist.
const elapsedMs = t => {
  if(!t.startedAt || !t.statusAt) return null;
  const a = Date.parse(t.startedAt), b = Date.parse(t.statusAt);
  return (Number.isNaN(a) || Number.isNaN(b) || b < a) ? null : b - a;
};

/* "9m 04s" while it matters, "2h 05m" once it doesn't. Seconds are padded so a
   ticking countdown doesn't change width every second and jiggle the row. */
function fmtDuration(ms){
  if(ms == null) return "";
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if(h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// Plain minutes, for prose in the audit log rather than a ticking display.
const fmtMinutes = n => `${n} minute${n === 1 ? "" : "s"}`;

/* ───────────────────────────── derived data ────────────────────────────── */

const counts = () => {
  const c = { all: state.data.tasks.length, pending:0, complete:0,
              blocked:0, in_progress:0, failed:0 };
  state.data.tasks.forEach(t => {
    const s = effectiveStatus(t);
    c[s] = (c[s] || 0) + 1;
  });
  return c;
};

/* "Addressed" means the task has reached an end state. A timer that is still
   running has not — it is work in flight, and counting it as done would put
   the hero bar ahead of reality. A failed one has, unhappily. */
const doneCount = (tasks = state.data.tasks) => tasks.filter(t => {
  const s = effectiveStatus(t);
  return s !== "pending" && s !== "in_progress";
}).length;

/* Board progress in task-equivalents rather than whole tasks. A plain task is
   worth 1 once it's addressed; a staged one earns its stages as they land, so
   finishing 2 of 3 moves the bar by two thirds of a task instead of nothing. */
const progressSum = (tasks = state.data.tasks) => tasks.reduce((sum, t) => {
  // A timed task is all-or-nothing: it has no stages, and a clock part-way
  // through has produced nothing yet.
  if(isTimed(t)){
    const s = effectiveStatus(t);
    return sum + (s === "pending" || s === "in_progress" ? 0 : 1);
  }
  if(!hasStages(t)) return sum + (t.status !== "pending" ? 1 : 0);
  if(t.status !== "pending") return sum + 1;          // halted or finished: whole task
  return sum + t.stages.filter(s => s.status === "complete").length / t.stages.length;
}, 0);

/* The number on the hero bar. Reset board snapshots this, so it lives in one
   place — a snapshot that disagreed with the bar it was taken from would be
   worse than no snapshot at all. */
const progressPct = (tasks = state.data.tasks) =>
  tasks.length ? Math.round((progressSum(tasks) / tasks.length) * 100) : 0;

/* ── stages ──
   A staged task carries an ordered list of steps. The "current" stage is the
   first one that isn't complete, derived rather than stored: a stored cursor
   could drift out of step with the stage statuses under concurrent edits, a
   derived one can't. A stage left blocked stays current, which is exactly the
   halt we want — the task stops there until it's reopened. */
const hasStages = t => Array.isArray(t.stages) && t.stages.length > 0;

const currentStageIndex = t => {
  const i = t.stages.findIndex(s => s.status !== "complete");
  return i === -1 ? t.stages.length : i;      // === length once every stage is done
};

const currentStage = t => t.stages[currentStageIndex(t)] || null;

// "Stage 2 of 3" — clamped so a finished task doesn't read "Stage 4 of 3".
const stageLabel = t =>
  `Stage ${Math.min(currentStageIndex(t) + 1, t.stages.length)} of ${t.stages.length}`;

/* Where a task's status lands once its stages say so. Stage state is the
   source of truth; the task-level status is kept in step with it so that
   counts(), the filter, the hero bar and the admin list all keep working
   unchanged off t.status alone. */
function statusFromStages(stages){
  const halted = stages.find(s => s.status === "blocked");
  if(halted) return halted.status;
  return stages.every(s => s.status === "complete") ? "complete" : "pending";
}

function myPlate(){
  const n = me();
  if(!n) return null;
  return state.data.plates.find(p => p.checkedOutBy === n) || null;
}

/* ────────────────────────────── rendering ──────────────────────────────── */

function render(){
  renderChrome();
  renderHero();
  renderStats();
  renderList();
  if($("adminModal").classList.contains("on") && !$("adminBody").hidden) renderAdmin();
  if($("plateMenu").classList.contains("on")) renderPlateMenu();
  /* Start or stop the countdown depending on what is now on the board, and
     write back anything that expired while this tab was asleep or closed —
     a poll landing a started task is the usual way both of these come up. */
  syncTimerTicker();
  sweepExpiredTimers();
}

function renderChrome(){
  // Identity button
  const name = me();
  const ub = $("userBtn");
  $("userBtnLabel").textContent = name ? name.toUpperCase() : "USERNAME";
  ub.classList.toggle("set", !!name);
  ub.title = name ? `Signed in as ${name} — click to change` : "Set your name";

  // Plate button
  const plate = myPlate();
  const pb = $("plateBtn");
  $("plateBtnLabel").textContent = plate ? plate.label.toUpperCase() : "SELECT PLATE";
  pb.classList.toggle("set", !!plate);

  // Sync chip
  const chip = $("syncChip"), label = $("syncLabel");
  chip.className = "sync-chip" + (state.syncing ? " busy" : "");
  if(state.lastError){ chip.classList.add("bad"); label.textContent = "OFFLINE"; }
  else if(state.mode === "member"){ chip.classList.add("member"); label.textContent = "SYNCED"; }
  else if(state.mode === "viewer"){ chip.classList.add("viewer"); label.textContent = "READ ONLY"; }
  else { label.textContent = "LOCAL"; }
  chip.title = state.lastError
    ? state.lastError
    : state.mode === "member" ? `Connected as ${state.user || "—"}`
    : state.mode === "viewer" ? "Viewing only — enter your team code to make changes"
    : "Local mode — changes stay in this browser";

  // Banner
  const banner = $("banner"), text = $("bannerText"), btn = $("bannerBtn");
  let show = null;
  if(state.lastError){
    show = { cls:"bad", msg: state.lastError, action:"Retry", fn: () => refresh() };
  }else if(state.mode === "local" && !repoConfigured()){
    show = { cls:"", msg:"Local mode — changes stay in this browser. Set REPO in config.js to share with your team.", action:null };
  }else if(state.mode === "local"){
    show = { cls:"bad", msg:"Couldn't reach the shared board. Working locally for now.", action:"Retry", fn: () => location.reload() };
  }else if(amBlocked()){
    show = { cls:"bad", msg:`An admin has removed edit access for ${me()}. You can still read the board.`,
             action:null };
  }else if(state.mode === "viewer"){
    show = { cls:"info", msg:"You're viewing the board. Enter your team code to complete tasks and check out plates.",
             action:"Enter code", fn: openUserModal };
  }
  banner.hidden = !show;
  if(show){
    banner.className = "banner" + (show.cls ? " " + show.cls : "");
    text.textContent = show.msg;
    btn.hidden = !show.action;
    if(show.action){ btn.textContent = show.action; btn.onclick = show.fn; }
  }else{
    // Clear rather than just hide. If the hidden attribute ever loses to a
    // display rule again, an empty banner is a far cheaper failure than one
    // confidently displaying a stale error.
    text.textContent = "";
    btn.hidden = true;
    btn.onclick = null;
  }

  // Footer
  $("footMode").textContent =
    state.mode === "member" ? `Connected as ${state.user || me() || "—"}`
    : state.mode === "viewer" ? "Read-only"
    : "Local mode";
  $("footSync").textContent = (state.lastSync
    ? "Last synced " + relTime(new Date(state.lastSync).toISOString())
    : (state.mode === "local" ? "Not syncing" : "Never synced")) + " · build " + BUILD;
}

function renderHero(){
  const total = state.data.tasks.length;
  const done  = doneCount();
  const sum   = progressSum();
  const pct   = progressPct();

  $("heroPct").innerHTML = `${pct}<small>%</small>`;
  const fill = $("heroBarFill");
  fill.style.width = pct + "%";
  fill.classList.toggle("done", total > 0 && done === total);

  const sub = $("heroSub");
  if(!total){
    sub.textContent = "No tasks on the board yet.";
  }else{
    const left = total - done;
    const who  = state.data.updatedBy;
    const when = state.data.updatedAt ? relTime(state.data.updatedAt) : null;
    const tail = who && when ? ` · last change ${when} by ${who}` : "";
    /* Say so when the percentage is running ahead of the task count, otherwise
       "1 of 3 addressed" next to 56% just looks like a bug. */
    const extra = sum - done > 0.001 ? " · plus stage progress" : "";
    sub.textContent = `${done} of ${total} addressed · ${left} still pending${extra}${tail}`;
  }
}

function renderStats(){
  const c = counts();
  $("sAll").textContent      = c.all;
  $("sComplete").textContent = c.complete;
  $("sBlocked").textContent  = c.blocked;
  $("sPending").textContent  = c.pending;
  $("sRunning").textContent  = c.in_progress;
  $("sFailed").textContent   = c.failed;
  document.querySelectorAll(".strip .stat").forEach(cell => {
    cell.classList.toggle("on", cell.dataset.filter === state.filter);
  });
}

function renderList(){
  const list = $("list");
  const all  = state.data.tasks;
  const shown = state.filter === "all" ? all : all.filter(t => effectiveStatus(t) === state.filter);

  $("empty").hidden       = all.length > 0;
  $("filterEmpty").hidden = !(all.length > 0 && shown.length === 0);
  $("clearFilterBtn").hidden = state.filter === "all";
  $("listTitle").textContent = state.filter === "all"
    ? "Active board"
    : STATUS[state.filter].label;

  if(!shown.length){ list.replaceChildren(); return; }

  const readOnly = state.mode === "viewer" || amBlocked();
  reconcileChildren(list, shown.map(t => ensureCard(t, readOnly)));
}

/* ── Keyed rendering ────────────────────────────────────────────────────
   The list is reconciled, never rebuilt. Each task keeps its own DOM node
   across refreshes, and only what actually changed is written. This is what
   makes the board stop juddering:

     · rebuilding every card meant the rowIn entrance animation replayed on
       every 20-second poll — that was the flicker;
     · .task-drawer now survives a render, so its grid-template-rows
       transition finally fires and the drawer glides open instead of
       appearing fully formed;
     · a card whose data didn't change is not touched at all.

   Open/closed is a class toggle on a node that persists — never a rebuild.
   Same approach as the charging tracker's vehicle list. */

// Everything that affects a card's markup. Same signature → don't touch it.
const cardSig = (t, readOnly) => JSON.stringify([
  t.title, t.description, t.status, t.statusBy, t.statusAt, t.statusNote,
  t.createdBy, t.createdAt, readOnly,
  /* Timer fields, or a task would not repaint when someone starts it. The
     EFFECTIVE status is in here rather than just t.status: an expiry changes
     nothing on disk, so without it the card would keep its Complete button
     until a write happened to land. me() matters because whether the Complete
     button is live depends on who is looking. */
  t.timed, t.limitMinutes, t.startedAt, t.startedBy, effectiveStatus(t), me(),
  (state.data.reopenRequests || []).some(r => r.taskId === t.id),
  (t.stages || []).map(s => [s.title, s.description, s.status, s.by, s.at, s.note])
]);

const cardNode = html => {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
};

function makeCard(t, readOnly){
  const node = cardNode(taskCard(t, readOnly));
  node.__sig = cardSig(t, readOnly);       // markup is already current
  return node;
}

function patchCard(node, t, readOnly){
  const open = state.openTaskId === t.id;
  node.classList.toggle("open", open);
  node.querySelector(".task-head").setAttribute("aria-expanded", open);

  const sig = cardSig(t, readOnly);
  if(node.__sig === sig) return node;      // nothing changed — leave it alone
  node.__sig = sig;

  // Toggle the status token rather than reassigning className, so .open and
  // any transient class survive.
  Object.keys(STATUS).forEach(s => node.classList.toggle("s-" + s, t.status === s));

  /* Swap only the subtrees that can change. .task-drawer itself is deliberately
     left in place — replacing it would restart the open/close transition. */
  const src = cardNode(taskCard(t, readOnly));

  /* The stage track is the one part of the head that moves, and the one part
     carrying transitions, so patch its classes in place. Swapping the nodes
     out would give the new dot no previous state to animate from and it would
     snap to green instead of fading. */
  const cur = [...node.querySelectorAll(".stage-track > span")];
  const want = [...src.querySelectorAll(".stage-track > span")];
  if(cur.length && cur.length === want.length){
    cur.forEach((n, i) => {
      if(n.className !== want[i].className) n.className = want[i].className;
      if(n.classList.contains("stage-count")) n.textContent = want[i].textContent;
    });
  }else{
    node.querySelector(".task-main").replaceWith(src.querySelector(".task-main"));
  }

  node.querySelector(".task-right").replaceWith(src.querySelector(".task-right"));
  node.querySelector(".dw-inner").replaceWith(src.querySelector(".dw-inner"));
  return node;
}

const ensureCard = (t, readOnly) => {
  const existing = $("list").querySelector(`.task[data-task="${t.id}"]`);
  return existing ? patchCard(existing, t, readOnly) : makeCard(t, readOnly);
};

/* Make container's children exactly `desired`, in order, with minimal moves.
   Moving an existing node does not replay its entrance animation. */
function reconcileChildren(container, desired){
  const keep = new Set(desired);
  [...container.children].forEach(ch => { if(!keep.has(ch)) ch.remove(); });
  desired.forEach((node, i) => {
    if(container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
  });
}

/* The action row for a timed task, which replaces Complete/Could-not-complete
   entirely — a timed task has exactly one path through it.

     pending      Start
     in_progress  Complete, but only for whoever started it, plus a countdown
     complete     how long it took
     failed       nothing at all; it is locked

   The countdown text is written once here and then rewritten in place every
   second by the ticker, never by a re-render — see startTimerTicker(). */
function timedActions(t, readOnly, eff){
  if(readOnly) return `<div class="dw-meta">Connect a token to change this task.</div>`;

  if(eff === "failed"){
    const ran = t.limitMinutes ? ` after ${escHtml(fmtMinutes(t.limitMinutes))}` : "";
    return `<div class="timer-locked">${svg(ICON.lock)}<span>Ran out of time${ran} — this task is locked and cannot be reopened.</span></div>`;
  }

  if(eff === "complete"){
    const took = elapsedMs(t);
    return took == null ? "" :
      `<div class="timer-done">${svg(ICON.check)}<span>Completed in <strong>${escHtml(fmtDuration(took))}</strong> of ${escHtml(fmtMinutes(t.limitMinutes))}.</span></div>`;
  }

  if(eff === "in_progress"){
    const mine = t.startedBy === me();
    return `
<div class="timer-run" data-timer="${t.id}">
  <span class="timer-left" data-timer-left="${t.id}">${escHtml(fmtDuration(msLeft(t)))}</span>
  <span class="timer-cap">left of ${escHtml(fmtMinutes(t.limitMinutes))} · started by ${escHtml(t.startedBy || "—")}</span>
</div>
<div class="acts">
  ${mine
    ? `<button class="act good" data-act="timed-complete" data-id="${t.id}">${svg(ICON.check)}Complete</button>`
    : `<button class="act good" disabled title="Only ${escHtml(t.startedBy || "the person who started it")} can complete this">${svg(ICON.check)}Complete</button>`}
</div>
${mine ? "" : `<div class="dw-meta">Only ${escHtml(t.startedBy || "whoever starts it")} can complete this one.</div>`}`;
  }

  // pending — not started, so no clock is running yet.
  return `
<div class="acts">
  <button class="act good" data-act="timed-start" data-id="${t.id}">${svg(ICON.play)}Start</button>
</div>
<div class="dw-meta">The ${escHtml(fmtMinutes(t.limitMinutes))} starts when you press Start.</div>`;
}

function taskCard(t, readOnly){
  /* Everything below reads the EFFECTIVE status, so a timer that ran out while
     the tab sat idle renders as failed immediately rather than waiting for a
     write to land. */
  const eff    = effectiveStatus(t);
  const st     = STATUS[eff];
  const open   = state.openTaskId === t.id;
  const staged = hasStages(t);
  const timed  = isTimed(t);

  /* A staged task in flight is still "pending" as far as the stat strip and
     the board bar are concerned — but "Pending" tells the team nothing useful
     when two of three stages are done, so the card says where it actually is. */
  const headline = staged && t.status === "pending" ? stageLabel(t) : st.label;

  /* ── what the card is called ──
     On a staged task the big line is the CURRENT STAGE, not the task. Reading
     "Plate Audit" on every card of a five-stage job tells you nothing about
     what to actually do next; "Photograph the damage" does.

     The task name moves to a small line above it so the stage still has an
     owner — without it a board of stage names is a list of orphans.

     Two cases where this collapses back to the old behaviour:
       · stage 1, whose title IS the task title (stagesToSave prepends it), so
         the kicker would simply repeat the line under it;
       · a finished or halted-at-the-end task with no current stage, which is
         about the task as a whole again. */
  const cur = staged ? currentStage(t) : null;
  const showTitle = cur ? cur.title : t.title;
  const showDesc  = cur ? (cur.description || "") : (t.description || "");
  const kicker    = cur && cur.title !== t.title ? t.title : "";

  const meta = t.statusBy
    ? `${headline} · ${escHtml(t.statusBy)} · <span title="${escHtml(fullTime(t.statusAt))}">${escHtml(relTime(t.statusAt))}</span>`
    : `Added by ${escHtml(t.createdBy || "—")} · <span title="${escHtml(fullTime(t.createdAt))}">${escHtml(relTime(t.createdAt))}</span>`;

  const noteBlock = t.statusNote
    ? `<div class="dw-note">${escHtml(t.statusNote)}</div>` : "";

  /* A failed timed task is terminal — no reopen button, and no request path
     either. The refusal is repeated in requestReopen() and in the admin
     approval, because this line only hides the button. */
  const roPending = (state.data.reopenRequests || []).some(r => r.taskId === t.id);
  const reopenBtn = (t.status === "pending" || eff === "failed") ? ""
    : roPending
      ? `<button class="act ghost" disabled>${svg(ICON.undo)}Reopen requested</button>`
      : `<button class="act ghost" data-act="reopen" data-id="${t.id}">${svg(ICON.undo)}Reopen</button>`;

  /* On a staged task the buttons act on the current stage, not the whole task,
     so say so — "Complete" on a 3-stage task would read as "finish all of it". */
  const done      = staged && currentStageIndex(t) >= t.stages.length;
  const doneLabel = staged && !done ? `Complete stage ${currentStageIndex(t) + 1}` : "Complete";

  const actions = timed
    ? timedActions(t, readOnly, eff)
    : readOnly
    ? `<div class="dw-meta">Connect a token to change this task.</div>`
    : `<div class="acts">
         <button class="act good ${t.status === "complete" ? "on" : ""}" data-act="complete" data-id="${t.id}"
                 ${done ? "disabled" : ""}>
           ${svg(ICON.check)}${escHtml(doneLabel)}</button>
         <button class="act bad ${t.status === "blocked" ? "on" : ""}" data-act="blocked" data-id="${t.id}"
                 ${done ? "disabled" : ""}>
           ${svg(ICON.slash)}Could not complete</button>
         ${reopenBtn}
       </div>`;

  /* The collapsed row carries the countdown too, so a running timer is visible
     without opening the drawer — that is the whole point of a deadline. Same
     data-timer-left hook, so the ticker updates both copies in one pass. */
  const headTimer = timed && eff === "in_progress"
    ? `<span class="task-by timer-chip"><span class="timer-left" data-timer-left="${t.id}">${escHtml(fmtDuration(msLeft(t)))}</span> left</span>`
    : "";

  return `
<article class="task s-${eff}${open ? " open" : ""}" data-task="${t.id}">
  <button class="task-head" data-toggle="${t.id}" aria-expanded="${open}">
    <span class="task-glyph">${svg(ICON[eff])}</span>
    <span class="task-main">
      ${kicker ? `<span class="task-kicker">${escHtml(kicker)}</span>` : ""}
      <span class="task-title">${escHtml(showTitle)}</span>
      ${showDesc ? `<span class="task-desc">${escHtml(showDesc)}</span>` : ""}
      ${staged ? stageBubbles(t) : ""}
      ${headTimer}
    </span>
    <span class="task-right">
      <span class="pill ${staged && t.status === "pending" ? "info" : st.pill}">${escHtml(headline)}</span>
      ${svg(ICON.down, "task-chev")}
    </span>
  </button>
  <div class="task-drawer"><div class="dw"><div class="dw-inner">
    ${!staged && t.description ? `<p class="dw-desc">${escHtml(t.description)}</p>` : ""}
    ${staged ? stageList(t) : ""}
    ${actions}
    ${staged ? "" : noteBlock}
    <div class="dw-meta">${meta}</div>
  </div></div></div>
</article>`;
}

/* Collapsed-card progress: one dot per stage, filled as they land. These live
   inside .task-head, which is a <button>, so they must stay plain spans — no
   nested interactive elements. .task-by is an existing styled slot in exactly
   the right place. */
function stageBubbles(t){
  const cur = currentStageIndex(t);
  // The connector out of a finished stage fills in too, so the track reads as
  // one continuous bar rather than a row of unrelated dots.
  const parts = t.stages.map((s, i) => {
    const link = i ? `<span class="stage-link${t.stages[i - 1].status === "complete" ? " done" : ""}"></span>` : "";
    return `${link}<span class="stage-dot s-${s.status}${i === cur ? " now" : ""}"></span>`;
  });
  return `
<span class="task-by stage-track" role="img" aria-label="${escHtml(stageLabel(t))}">
  ${parts.join("")}
  <span class="stage-count">${escHtml(stageLabel(t))}</span>
</span>`;
}

/* The same progress spelled out in the drawer, where there's room for each
   stage's title, its note, and who finished it. */
function stageList(t){
  const cur = currentStageIndex(t);
  return `
<ol class="stages">
  ${t.stages.map((s, i) => `
  <li class="stage s-${s.status}${i === cur ? " now" : ""}">
    <span class="stage-mark">${svg(ICON[s.status])}</span>
    <span class="stage-body">
      <span class="stage-title">${escHtml(s.title)}</span>
      ${s.description ? `<span class="stage-desc">${escHtml(s.description)}</span>` : ""}
      ${s.note ? `<span class="stage-note">${escHtml(s.note)}</span>` : ""}
      ${s.by ? `<span class="stage-who">${escHtml(STATUS[s.status].label)} · ${escHtml(s.by)} · <span title="${escHtml(fullTime(s.at))}">${escHtml(relTime(s.at))}</span></span>` : ""}
    </span>
  </li>`).join("")}
</ol>`;
}

/* ───────────────────────────── plate menu ──────────────────────────────── */

function renderPlateMenu(){
  const body = $("plateMenuBody");
  const name = me();
  const plates = state.data.plates;

  if(!plates.length){
    body.innerHTML = `<div class="menu-empty">No plates configured yet.<br>Add them in <strong>Admin → Plates</strong>.</div>`;
    return;
  }

  body.innerHTML = plates.map(p => {
    const mine   = name && p.checkedOutBy === name;
    const taken  = p.checkedOutBy && !mine;
    const locked = !!p.forcedBy;
    // Keep these short — the pill already says Yours/Taken, so repeating it
    // here just crowds the row and forces the plate number to truncate.
    const sub = locked && mine ? "Locked to you by an admin"
              : locked        ? `Locked to ${p.checkedOutBy}`
              : mine          ? "Click to release"
              : taken         ? `With ${p.checkedOutBy}`
              : (p.note || "Available");

    const pill = locked && mine ? '<span class="pill warm">Locked</span>'
               : locked         ? '<span class="pill idle">Locked</span>'
               : mine           ? '<span class="pill ok">Yours</span>'
               : taken          ? '<span class="pill idle">Taken</span>'
               : "";

    return `
<button class="menu-item ${mine ? "mine" : taken || locked ? "taken" : ""}" role="menuitem"
        data-plate="${p.id}" ${(taken && !mine) || (locked && !mine) ? "disabled" : ""}>
  <span class="mi-main">
    <span class="mi-plate">${escHtml(p.label)}</span>
    <span class="mi-sub">${escHtml(sub)}</span>
  </span>
  ${pill}
</button>`;
  }).join("");
}

function openPlateMenu(){
  renderPlateMenu();
  $("plateMenu").classList.add("on");
  $("plateBtn").setAttribute("aria-expanded", "true");
}
function closePlateMenu(){
  $("plateMenu").classList.remove("on");
  $("plateBtn").setAttribute("aria-expanded", "false");
}

/* ──────────────────────────────── actions ──────────────────────────────── */

function setTaskStatus(taskId, status, note){
  const task = state.data.tasks.find(t => t.id === taskId);
  if(!task) return;
  if(hasStages(task)) return setStageStatus(taskId, status, note);
  const title = task.title;

  // Minted out here, not inside the mutator: uid() bumps a module counter, so a
  // replay would mint a second id and credit the same completion twice.
  const scoreId = uid("sc"), scoreAt = nowIso(), scoreWho = me();

  return commit(`${STATUS[status].label} "${title}"`, data => {
    const t = data.tasks.find(x => x.id === taskId);
    if(!t) throw new Error("That task was deleted by someone else.");

    /* A timed task has its own two actions and never renders these buttons. It
       can still be reached for ~10 minutes after a deploy by a teammate running
       cached JS from before timers existed, which would otherwise let them
       complete — or reopen — a task the timer already failed. */
    if(t.timed) throw new Error("That's a timed task — reload the page to get the Start button.");

    /* Read off the FRESH task, before we write. Two people can complete the
       same task at once: the loser gets a 409 and replays against data where
       it's already complete, and without this they'd be credited too. A
       double-click does the same thing with one person. Scoring only — the
       status write itself still goes through, as it always has. */
    const wasComplete = t.status === "complete";

    t.status     = status;
    t.statusBy   = status === "pending" ? null : me();
    t.statusAt   = status === "pending" ? null : nowIso();
    t.statusNote = status === "pending" ? null : (note || null);

    if(t.leaderboard && status === "complete" && !wasComplete){
      awardScore(data, {
        id: scoreId, at: scoreAt, who: scoreWho,
        taskId: t.id, stageId: null, title: t.title, value: 1
      });
    }

    return {
      action : "task." + status,
      subject: t.title,
      detail : note || ""
    };
  });
}

/* The staged equivalent. Complete advances one stage at a time and only flips
   the whole task once the last one lands; Could-not-complete halts the task at
   whichever stage it reached, keeping the ones already done. */
function setStageStatus(taskId, status, note){
  const task  = state.data.tasks.find(t => t.id === taskId);
  const stage = currentStage(task);
  if(!stage) return;                       // already finished — nothing current
  const n     = currentStageIndex(task) + 1;
  const label = status === "complete" && n === task.stages.length
    ? `Complete "${task.title}"`
    : `${STATUS[status].label} stage ${n} of "${task.title}"`;

  const scoreId = uid("sc"), scoreAt = nowIso(), scoreWho = me();

  return commit(label, data => {
    const t = data.tasks.find(x => x.id === taskId);
    if(!t) throw new Error("That task was deleted by someone else.");

    /* Re-find by id rather than by position. The mutator runs again on freshly
       pulled data for every replay attempt, and someone else may have advanced
       this task in between — in which case our stage is already done and the
       right move is to abort rather than silently skip ahead. */
    const s = (t.stages || []).find(x => x.id === stage.id);
    if(!s) throw new Error("That stage no longer exists.");
    // Doing double duty now: this is also what stops a stage being credited
    // twice, so the staged path needs no separate guard.
    if(s.status === "complete") throw new Error("Someone already completed that stage.");

    s.status = status;
    s.by     = me();
    s.at     = nowIso();
    s.note   = note || null;

    const idx  = t.stages.indexOf(s) + 1;
    const of   = t.stages.length;
    const next = statusFromStages(t.stages);

    /* Each stage is worth an equal share of one task, credited to whoever
       landed it — so two people splitting a three-stage task split the credit
       2/3 and 1/3. Denominator read off the fresh task, not the captured one. */
    if(t.leaderboard && status === "complete"){
      awardScore(data, {
        id: scoreId, at: scoreAt, who: scoreWho,
        taskId: t.id, stageId: s.id, title: t.title, value: 1 / of
      });
    }
    t.status     = next;
    t.statusBy   = me();
    t.statusAt   = nowIso();
    t.statusNote = next === "pending" ? null : (note || null);

    // The final stage completing is the task completing — log it as such.
    const done = next === "complete";
    /* Name the stage, not just its number. "Plate Audit · stage 2 of 3" leaves
       a reader counting rows in the admin panel to work out what happened;
       "…: Photograph the damage" does not. Skipped on stage 1, whose title is
       the task title and would read as "Plate Audit · stage 1 of 3: Plate
       Audit". */
    const named = s.title && s.title !== t.title ? `: ${s.title}` : "";
    return {
      action : done ? "task.complete" : (status === "complete" ? "task.stage" : "task." + status),
      subject: done ? t.title : `${t.title} · stage ${idx} of ${of}${named}`,
      detail : note || ""
    };
  });
}

/* Could-not-complete takes effect immediately — no approval, unlike Reopen.
   But it is no use to an admin reading the audit log without the story behind
   it, so the note is required rather than optional. Kept as a table because it
   used to hold Partial too, and the next status that needs a note will want
   the same shape. */
const NOTE_PROMPT = {
  blocked: {
    title: "Could not complete",
    ask  : t => `Why couldn't “${t}” be completed?`,
    ph   : "What's blocking it?",
    yes  : "Mark could not complete"
  }
};

async function markWithNote(taskId, status){
  const task = state.data.tasks.find(t => t.id === taskId);
  if(!task) return;
  const p = NOTE_PROMPT[status];

  /* On a staged task this halts one stage, so ask about that stage by name —
     asking "how much of Plate Audit was completed?" when the team is three
     stages in would be asking the wrong question. */
  const staged = hasStages(task);
  const stage  = staged ? currentStage(task) : null;
  if(staged && !stage) return;
  const subject = stage ? stage.title : task.title;
  const where   = stage ? ` (${stageLabel(task).toLowerCase()} of “${task.title}”)` : "";

  const answer = await askConfirm({
    title: staged ? `${p.title} — ${stageLabel(task)}` : p.title,
    text : `${p.ask(subject)}${where} A note is required — it goes in the audit log.`,
    input: { value: "", placeholder: p.ph, maxlength: 200, required: true },
    yes  : p.yes
  });
  if(answer === false || answer == null) return;      // cancelled
  const clean = String(answer).trim();
  if(!clean){ toast("A note is required.", "bad"); return; }

  setTaskStatus(taskId, status, clean);
}

/* ──────────────────────────── timed tasks ──────────────────────────────
   Two actions and a sweep. Each mutator re-finds the task by id and refuses on
   a state that no longer allows the move, because between the click and the
   write someone else may have started it, finished it, or the clock may have
   run out — and the button the user pressed can be from before any of that. */

function startTimedTask(taskId){
  const task = state.data.tasks.find(t => t.id === taskId);
  if(!task || !isTimed(task)) return;

  const startedAt = nowIso();

  return commit(`Start "${task.title}"`, data => {
    const t = data.tasks.find(x => x.id === taskId);
    if(!t) throw new Error("That task was deleted by someone else.");
    if(!t.timed) throw new Error("That task is no longer a timed task.");
    if(t.status !== "pending") throw new Error(`${t.startedBy || "Someone"} already started this one.`);

    t.status    = "in_progress";
    t.startedAt = startedAt;
    t.startedBy = me();
    // statusBy/At track the last status change for the card footer, same as
    // every other transition.
    t.statusBy  = me();
    t.statusAt  = startedAt;
    t.statusNote = null;

    return { action:"task.start", subject: t.title, detail: fmtMinutes(t.limitMinutes) };
  });
}

function completeTimedTask(taskId){
  const task = state.data.tasks.find(t => t.id === taskId);
  if(!task || !isTimed(task)) return;

  // Minted outside the mutator — uid() bumps a module counter, so a replay
  // would mint a second id and credit the completion twice.
  const scoreId = uid("sc"), scoreAt = nowIso(), scoreWho = me();

  return commit(`Complete "${task.title}"`, data => {
    const t = data.tasks.find(x => x.id === taskId);
    if(!t) throw new Error("That task was deleted by someone else.");
    if(t.status === "failed") throw new Error("That task ran out of time and is locked.");
    if(t.status !== "in_progress") throw new Error("That task isn't running.");
    if(t.startedBy !== me()) throw new Error(`Only ${t.startedBy} can complete this one.`);

    /* The deadline is checked HERE, against the data being written, not against
       what the button looked like. A tab open from before the deadline still
       shows a live Complete button; this is what stops it landing. */
    if(isExpired(t)) throw new Error("Time ran out on that task — it can no longer be completed.");

    const finishedAt = nowIso();
    t.status     = "complete";
    t.statusBy   = me();
    t.statusAt   = finishedAt;
    t.statusNote = null;

    if(t.leaderboard){
      awardScore(data, {
        id: scoreId, at: scoreAt, who: scoreWho,
        taskId: t.id, stageId: null, title: t.title, value: 1
      });
    }

    return {
      action : "task.timedComplete",
      subject: t.title,
      detail : `${fmtDuration(elapsedMs(t))} of ${fmtMinutes(t.limitMinutes)}`
    };
  });
}

/* Write back the expiries that effectiveStatus() is already showing.

   Runs from the ticker and after every sync. Only members can write, so a
   viewer-only audience sees the right board and records nothing until someone
   with a token turns up — that is the accepted cost of having no server. */
const timeoutsInFlight = new Set();

function sweepExpiredTimers(){
  if(state.mode !== "member" || amBlocked() || !me()) return;

  const due = state.data.tasks.filter(t =>
    t.status === "in_progress" && isExpired(t) && !timeoutsInFlight.has(t.id));
  if(!due.length) return;

  due.forEach(task => {
    timeoutsInFlight.add(task.id);
    const deadline = deadlineOf(task);
    // The moment it actually ran out, not the moment a browser noticed. Those
    // can be days apart if nobody had the board open.
    const failedAt = deadline ? new Date(deadline).toISOString() : nowIso();

    commit(`Time out "${task.title}"`, data => {
      const t = data.tasks.find(x => x.id === task.id);
      // Someone completed it in time, or another client already wrote the
      // timeout. Either way there is nothing to do and nothing to log — this
      // is what makes concurrent sweeps converge on one entry.
      if(!t || t.status !== "in_progress") return null;
      if(!isExpired(t)) return null;

      t.status     = "failed";
      t.failedAt   = failedAt;
      t.statusBy   = t.startedBy;
      t.statusAt   = failedAt;
      t.statusNote = null;

      return {
        action : "task.timeout",
        subject: t.title,
        // Attributed to whoever started the clock, not to whoever's browser
        // happened to be open when it ran out. See pushAudit in sync.js.
        who    : t.startedBy || "Unknown",
        detail : `ran out after ${fmtMinutes(t.limitMinutes)}`
      };
    }).finally(() => timeoutsInFlight.delete(task.id));
  });
}

/* One interval for the whole board. It rewrites the countdown text in place —
   touching a text node, never re-rendering — because the list is keyed and
   reconciled, and rebuilding cards every second would replay the row animation
   and fight the drawer transition. It only runs while something is counting. */
let timerTicker = null;

function syncTimerTicker(){
  const running = state.data.tasks.some(t => t.status === "in_progress" && isTimed(t));
  if(running && !timerTicker){
    timerTicker = setInterval(tickTimers, 1000);
  }else if(!running && timerTicker){
    clearInterval(timerTicker);
    timerTicker = null;
  }
}

function tickTimers(){
  let expired = false;
  document.querySelectorAll("[data-timer-left]").forEach(el => {
    const t = state.data.tasks.find(x => x.id === el.dataset.timerLeft);
    if(!t) return;
    const left = msLeft(t);
    if(left == null) return;
    if(left <= 0) expired = true;
    el.textContent = fmtDuration(left);
  });

  /* A card that just hit zero has to change shape, not just text — the Complete
     button goes, the pill flips to Failed. That is a real render, but only on
     the tick where it actually happens. */
  if(expired){
    renderStats();
    renderHero();
    renderList();
    syncTimerTicker();
    sweepExpiredTimers();
  }
}

async function requestReopen(taskId){
  const task = state.data.tasks.find(t => t.id === taskId);
  if(!task) return;

  /* Hidden in the card too, but a failed task must be unreopenable by every
     route — this is the one that a stale tab or a keyboard shortcut would hit. */
  if(effectiveStatus(task) === "failed"){
    toast("That task ran out of time and is locked. It cannot be reopened.", "bad");
    return;
  }

  if((state.data.reopenRequests || []).some(r => r.taskId === taskId)){
    toast("A reopen request for this task is already pending.", "");
    return;
  }

  const reason = await askConfirm({
    title: "Request reopen",
    text : `Ask an admin to reopen “${task.title}”. A reason is required.`,
    input: { value: "", placeholder: "Why does this need reopening?", maxlength: 200, required: true },
    yes  : "Request reopen"
  });
  if(!reason) return;                       // cancelled
  const clean = String(reason).trim();
  if(!clean){ toast("A reason is required.", "bad"); return; }

  const ok = await commit(`Request reopen: ${task.title}`, data => {
    const t = data.tasks.find(x => x.id === taskId);
    if(!t) throw new Error("That task no longer exists.");
    data.reopenRequests = data.reopenRequests || [];
    data.reopenRequests = data.reopenRequests.filter(r => r.taskId !== taskId);  // one per task
    data.reopenRequests.push({ id: uid("ro"), at: nowIso(), by: me(), taskId, taskTitle: t.title, reason: clean });
    return { action:"reopen.request", subject: t.title, detail: clean };
  });

  if(ok) toast("Reopen request sent to an admin.", "good");
}

function checkoutPlate(plateId){
  const name = me();
  return commit("Check out plate", data => {
    const p = data.plates.find(x => x.id === plateId);
    if(!p) throw new Error("That plate no longer exists.");
    if(p.forcedBy && p.checkedOutBy !== name){
      throw new Error(`${p.label} is locked to ${p.checkedOutBy} by an admin.`);
    }
    if(p.checkedOutBy && p.checkedOutBy !== name){
      throw new Error(`${p.label} was just checked out by ${p.checkedOutBy}.`);
    }
    // One plate per person — release any other first, unless an admin locked it.
    const entries = [];
    data.plates.forEach(other => {
      if(other.id !== plateId && other.checkedOutBy === name && !other.forcedBy){
        other.checkedOutBy = null;
        other.checkedOutAt = null;
        entries.push({ action:"plate.release", subject: other.label });
      }
    });
    p.checkedOutBy = name;
    p.checkedOutAt = nowIso();
    entries.push({ action:"plate.checkout", subject: p.label });
    return entries;
  });
}

async function releasePlate(plateId){
  const name = me();
  const plate = state.data.plates.find(p => p.id === plateId);

  // An admin-locked plate can only be handed back by an admin.
  if(plate && plate.forcedBy){
    await askConfirm({
      title: "This plate is locked to you",
      text : `An admin has forcibly assigned ${plate.label} to you. You can't hand it back — ask ${plate.forcedBy} to unlock it in Admin.`,
      yes  : "OK", solo: true, danger: true
    });
    return false;
  }

  return commit("Release plate", data => {
    const p = data.plates.find(x => x.id === plateId);
    if(!p) return null;
    if(p.forcedBy) throw new Error(`An admin has forcibly assigned ${p.label} to you.`);
    if(p.checkedOutBy !== name) throw new Error("That plate isn't checked out to you.");
    p.checkedOutBy = null;
    p.checkedOutAt = null;
    return { action:"plate.release", subject: p.label };
  });
}

/* ─────────────────────── team code (shared connect) ────────────────────── */

/**
 * Validate a team code and switch this device to member mode.
 * Used by both the first-run modal and Admin → Connection, so the two can
 * never drift apart in what they accept or how they report failure.
 * @returns {Promise<{ok:boolean, error?:string, login?:string}>}
 */
async function connectTeamCode(value){
  const code = String(value || "").trim();

  if(!code)            return { ok:false, error:"Paste the code first." };
  if(/\s/.test(code))  return { ok:false, error:"The code shouldn't contain spaces — check for a stray line break." };
  if(code.length < 20) return { ok:false, error:"That doesn't look like a full code. Make sure you copied all of it." };

  setToken(code);
  try{
    const res  = await gh("https://api.github.com/user");
    const user = await res.json();
    state.user = user.login;
    state.mode = "member";
    state.lastError = null;

    await refresh({ quiet: true });
    startPolling();
    render();
    return { ok:true, login:user.login };
  }catch(e){
    setToken(null);
    state.user = null;
    state.mode = repoConfigured() ? "viewer" : "local";
    render();
    return {
      ok: false,
      error: e.status === 401
        ? "GitHub rejected that code. It may have expired, or been copied incompletely."
        : explainError(e, "check the code")
    };
  }
}

/* ─────────────────────────── scanning a code ───────────────────────────── */

/* Why this exists: a 93-character token cannot be dictated across a desk, and a
   clipboard does not reach a second device. The Hub paints the code as a QR;
   this reads it. Scanning only fills the field — the Connect button is still
   pressed by hand, so nothing about a scan is a shortcut past consent.

   Everything here feeds connectTeamCode() like the typed path does, so the two
   cannot drift apart in what they accept or how they report failure. */

let scanStream = null;   // MediaStream while the camera is live
let scanRaf    = null;   // pending animation frame for the decode loop
let scanTarget = null;   // id of the input a successful scan should fill
let scanReturn = null;   // modal to restore when the scanner closes

/* getUserMedia needs a secure context, which a double-clicked index.html is
   not. Rather than offer a button that throws when pressed, the choice is
   removed and the plain input stands on its own. */
const cameraPossible = () =>
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
  window.isSecureContext === true;

/* jsQR is 250KB and only matters to someone holding a camera up to a screen, so
   it is fetched on the first scan rather than on every page load. Opening the
   board stays exactly as quick for the people who only ever read it. */
let decoderLoading = null;
function loadDecoder(){
  if(window.jsQR) return Promise.resolve(window.jsQR);
  if(decoderLoading) return decoderLoading;
  decoderLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `jsqr.js?v=${BUILD}`;
    s.onload  = () => window.jsQR
      ? resolve(window.jsQR)
      : reject(new Error("decoder loaded but did not register"));
    s.onerror = () => { decoderLoading = null; reject(new Error("decoder failed to load")); };
    document.head.appendChild(s);
  });
  return decoderLoading;
}

/* Native BarcodeDetector where it exists — no download and hardware-backed on
   most phones. It is Chromium-only, which is exactly why jsQR is carried as
   well: on iOS Safari the native path simply is not there. */
async function makeDecoder(){
  if("BarcodeDetector" in window){
    try{
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if(formats.includes("qr_code")){
        const det = new window.BarcodeDetector({ formats: ["qr_code"] });
        return async video => {
          const found = await det.detect(video);
          return found.length ? found[0].rawValue : null;
        };
      }
    }catch{ /* fall through to jsQR */ }
  }

  const jsQR = await loadDecoder();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async video => {
    const w = video.videoWidth, h = video.videoHeight;
    if(!w || !h) return null;
    // jsQR walks every pixel, so a 1080p frame costs far more time than the
    // reach it buys. 640 wide still reads a code that fills the frame.
    const scale = Math.min(1, 640 / w);
    canvas.width  = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    return found ? found.data : null;
  };
}

/* Called from every exit: the Cancel button, the X, Escape, the scrim, a
   successful read, and openModal switching away. A camera light still on after
   the dialog has gone is the failure people notice and do not forgive. */
function stopScanner(){
  if(scanRaf){ cancelAnimationFrame(scanRaf); scanRaf = null; }
  if(scanStream){
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  const video = $("scanVideo");
  if(video) video.srcObject = null;
  scanTarget = null;
}

function closeScanner(){
  stopScanner();
  const back = scanReturn;
  scanReturn = null;
  // Come back to whichever dialog sent us here — cancelling a scan should not
  // also throw away a half-finished Welcome form.
  if(back) openModal(back);
  else     closeOverlays();
}

function scanFail(message){
  stopScanner();
  $("scanErr").textContent = message;
  $("scanErr").hidden = false;
}

function cameraTrouble(err){
  const name = err && err.name;
  if(name === "NotAllowedError" || name === "SecurityError")
    return "Camera access was blocked. Allow it in your browser's settings for this site, or enter the code manually.";
  if(name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera found on this device. Enter the code manually instead.";
  if(name === "NotReadableError")
    return "The camera is already in use by another app. Close that, or enter the code manually.";
  return "Couldn't start the camera — " + ((err && err.message) || "unknown error") +
         ". Enter the code manually instead.";
}

/* A decoder that throws on every single frame would otherwise spin here for as
   long as the dialog stayed open, looking like a camera that simply never finds
   anything. Past this many consecutive failures it says so and stands down. */
const SCAN_GIVE_UP = 45;

function scanLoop(video, decode, misfires = 0){
  if(!scanStream) return;                        // torn down mid-flight
  const again = n => { scanRaf = requestAnimationFrame(() => scanLoop(video, decode, n)); };

  // HAVE_CURRENT_DATA is enough to draw a frame; waiting for HAVE_ENOUGH_DATA
  // stalls indefinitely on streams that never advertise it.
  if(video.readyState < video.HAVE_CURRENT_DATA) return again(misfires);

  // The next frame is only queued once this one resolves, so a slow decode
  // falls behind rather than piling up behind itself.
  decode(video).then(text => {
    if(!scanStream) return;                      // closed while decoding
    if(text) onScanned(text);
    else     again(0);                           // a frame with no code is normal
  }).catch(() => {
    if(!scanStream) return;
    if(misfires + 1 >= SCAN_GIVE_UP){
      scanFail("The camera is running but the reader keeps failing. Enter the code manually instead.");
      return;
    }
    again(misfires + 1);
  });
}

function onScanned(text){
  const target = scanTarget;
  const code = String(text || "").trim();
  stopScanner();

  if(!code) return scanFail("That code was empty. Try again, or enter it manually.");

  const input = target && $(target);
  if(input){
    input.value = code;
    input.hidden = false;                        // masked, but visibly filled
    const flag = $(target === "connInput" ? "connScanned" : "teamCodeScanned");
    if(flag) flag.hidden = false;
  }
  closeScanner();
}

async function openScanner(targetId){
  $("scanErr").hidden = true;
  openModal("scanModal");
  // Set after openModal: it stops any previous scan, which clears scanTarget.
  scanTarget = targetId;

  try{
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
  }catch(err){
    return scanFail(cameraTrouble(err));
  }

  // The dialog can be dismissed while the permission prompt is up; a stream
  // handed back after that would run with nothing on screen to show for it.
  if(!$("scanModal").classList.contains("on")){
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
    return;
  }

  const video = $("scanVideo");
  video.srcObject = scanStream;
  try{ await video.play(); }catch{ /* autoplay attributes cover the usual case */ }

  let decode;
  try{ decode = await makeDecoder(); }
  catch{ return scanFail("Couldn't load the QR reader. Check your connection, or enter the code manually."); }

  if(!scanStream) return;
  scanLoop(video, decode);
}

/* ───────────────────────────── user modal ──────────────────────────────── */

function myPendingRequest(){
  const n = me();
  if(!n) return null;
  return (state.data.requests || []).find(r => r.from === n) || null;
}

function openUserModal(){
  const nameSet   = !!me();
  const needsCode = repoConfigured() && !token();

  $("userModalTitle").textContent = nameSet ? "Your details" : "Welcome";

  const nameInput = $("userInput");
  nameInput.value = me() || "";
  nameInput.readOnly = nameSet;                 // locked once set
  nameInput.classList.toggle("locked", nameSet);
  $("userHint").hidden = nameSet;               // the "choose carefully" note is only for first run

  // Request-a-change block, only once a name is locked in.
  $("reqBlock").hidden = !nameSet;
  const pend = myPendingRequest();
  const pd = $("reqPending");
  const reqInput = $("reqNameInput");
  const reqBtn = $("reqChange");
  if(pend){
    pd.hidden = false;
    pd.innerHTML = `Pending: <strong>${escHtml(pend.from)}</strong> → <strong>${escHtml(pend.to)}</strong>. An admin will review it.`;
    reqInput.hidden = true;
    reqBtn.textContent = "Cancel request";
    reqBtn.dataset.mode = "cancel";
  }else{
    pd.hidden = true;
    reqInput.hidden = false;
    reqInput.value = "";
    reqBtn.textContent = "Request change";
    reqBtn.dataset.mode = "request";
  }

  $("teamCodeField").hidden = !needsCode;
  $("teamCodeInput").value = "";
  // Back behind the two buttons on every open — but only where there is a
  // choice to make. With no camera the field is the only way in and stays out.
  $("teamCodeInput").hidden = cameraPossible();
  $("teamCodeScanned").hidden = true;
  $("userErr").hidden = true;

  // The solid button: sets the name on first run; only connects a code once the
  // name is locked; and disappears when there's nothing for it to do.
  const save = $("userSave");
  if(!nameSet){
    save.hidden = false;
    save.textContent = needsCode ? "Save and connect" : "Save";
  }else if(needsCode){
    save.hidden = false;
    save.textContent = "Connect";
  }else{
    save.hidden = true;
  }
  $("userCancel").textContent = nameSet ? "Close" : "Cancel";

  openModal("userModal");
}

async function saveUserName(){
  const input  = $("userInput");
  const codeEl = $("teamCodeInput");
  const err    = $("userErr");
  const btn    = $("userSave");
  const firstRun = !me();

  const fail = (msg, focusEl) => {
    err.textContent = msg;
    err.hidden = false;
    (focusEl || input).focus();
  };
  err.hidden = true;

  // Set the name only on first run — it's locked afterwards.
  if(firstRun){
    const next = input.value.trim();
    if(next.length < 2)  return fail("Please enter at least two characters.");
    if(next.length > 40) return fail("That's a bit long — 40 characters max.");
    setMe(next);
  }

  // Connect a team code if one was entered.
  const code = $("teamCodeField").hidden ? "" : codeEl.value.trim();
  if(code){
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Connecting…";
    const result = await connectTeamCode(code);
    btn.disabled = false;
    btn.textContent = label;
    if(!result.ok){
      render();
      return fail(result.error, codeEl);
    }
  }

  closeOverlays();
  render();
  if(firstRun) toast(code ? `Welcome, ${me()}. You can make changes.` : `You're set as ${me()}.`, "good");
}

async function requestNameChange(){
  const btn = $("reqChange");
  const err = $("userErr");
  err.hidden = true;

  if(btn.dataset.mode === "cancel"){
    await commit("Cancel name-change request", data => {
      const before = (data.requests || []).length;
      data.requests = (data.requests || []).filter(r => r.from !== me());
      return data.requests.length === before ? null : { action:"request.cancel", subject: me() };
    });
    openUserModal();
    return;
  }

  const desired = $("reqNameInput").value.trim();
  if(desired.length < 2)  { err.textContent = "Enter a name of at least two characters."; err.hidden = false; return; }
  if(desired.length > 40) { err.textContent = "That's a bit long — 40 characters max.";   err.hidden = false; return; }
  if(desired === me())    { err.textContent = "That's already your name.";                  err.hidden = false; return; }

  const ok = await commit(`Request name change to ${desired}`, data => {
    data.requests = data.requests || [];
    data.requests = data.requests.filter(r => r.from !== me());   // one pending request per person
    data.requests.push({ id: uid("req"), at: nowIso(), from: me(), to: desired });
    return { action:"request.open", subject: desired };
  });

  if(ok){
    toast("Request sent. An admin will review it.", "good");
    openUserModal();
  }
}

/* ──────────────────────────────── events ───────────────────────────────── */

function wireEvents(){
  // Nav
  $("userBtn").addEventListener("click", openUserModal);
  // Wrapped, not passed directly: openAdminModal lives in admin.js, which loads
  // after this file. An arrow defers the lookup until the click.
  $("adminBtn").addEventListener("click", () => openAdminModal());
  $("refreshBtn").addEventListener("click", () => refresh());
  // The chip is a status light now, not a control — connecting happens in the
  // first-run modal for teammates and in Admin → Connection for the owner.

  $("plateBtn").addEventListener("click", e => {
    e.stopPropagation();
    if($("plateMenu").classList.contains("on")) closePlateMenu();
    else if(!me()) openUserModal();
    else openPlateMenu();
  });

  $("plateMenuBody").addEventListener("click", e => {
    const btn = e.target.closest("[data-plate]");
    if(!btn || btn.disabled) return;
    const id = btn.dataset.plate;
    const plate = state.data.plates.find(p => p.id === id);
    closePlateMenu();
    if(plate && plate.checkedOutBy === me()) releasePlate(id);
    else checkoutPlate(id);
  });

  // Team code: scan it, or type it.
  document.querySelectorAll("[data-scan-for]").forEach(btn => {
    btn.addEventListener("click", () => {
      // Remember where we came from so cancelling returns there rather than
      // dumping the user out of a half-finished form.
      scanReturn = OVERLAYS.find(id => $(id).classList.contains("on")) || null;
      openScanner(btn.dataset.scanFor);
    });
  });
  document.querySelectorAll("[data-manual-for]").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.manualFor);
      if(!input) return;
      input.hidden = false;
      input.focus();
    });
  });
  document.querySelectorAll("[data-scan-close]").forEach(btn => {
    btn.addEventListener("click", closeScanner);
  });

  /* No camera reachable — a double-clicked index.html, or a browser without
     getUserMedia. Drop the choice entirely and show the field, which is exactly
     what this looked like before the scanner existed. A button that cannot work
     is worse than no button. */
  if(!cameraPossible()){
    document.querySelectorAll("[data-scan-for]").forEach(btn => { btn.hidden = true; });
    document.querySelectorAll("[data-manual-for]").forEach(btn => {
      const input = $(btn.dataset.manualFor);
      if(input) input.hidden = false;
      btn.hidden = true;
    });
  }

  // Modal close buttons + scrim
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", closeOverlays);
  });
  $("scrim").addEventListener("click", () => {
    if($("scanModal").classList.contains("on")) closeScanner();
    else closeOverlays();
  });
  $("confirmScrim").addEventListener("click", () => closeConfirm(false));
  $("confirmNo").addEventListener("click", () => closeConfirm(false));
  $("confirmYes").addEventListener("click", () => closeConfirm(confirmAnswer()));
  $("confirmInput").addEventListener("input", () => {
    if(confirmRequire) $("confirmYes").disabled = !$("confirmInput").value.trim();
  });
  $("confirmInput").addEventListener("keydown", e => {
    if(e.key !== "Enter") return;
    if(confirmRequire && !e.target.value.trim()) return;   // required, still empty
    e.preventDefault();
    closeConfirm(confirmAnswer());
  });

  // Username modal
  $("userSave").addEventListener("click", saveUserName);
  $("userInput").addEventListener("keydown", e => { if(e.key === "Enter") saveUserName(); });

  $("teamCodeInput").addEventListener("keydown", e => { if(e.key === "Enter") saveUserName(); });
  $("reqChange").addEventListener("click", requestNameChange);
  $("reqNameInput").addEventListener("keydown", e => { if(e.key === "Enter") requestNameChange(); });

  // Stat filters
  document.querySelectorAll(".strip .stat").forEach(cell => {
    const apply = () => {
      const want = cell.dataset.filter;
      state.filter = (want === state.filter && want !== "all") ? "all" : want;
      state.openTaskId = null;
      render();
    };
    cell.addEventListener("click", apply);
    cell.addEventListener("keydown", e => {
      if(e.key === "Enter" || e.key === " "){ e.preventDefault(); apply(); }
    });
  });
  $("clearFilterBtn").addEventListener("click", () => {
    state.filter = "all"; render();
  });

  // Board — one delegated listener for expand + actions
  $("list").addEventListener("click", e => {
    const toggle = e.target.closest("[data-toggle]");
    if(toggle){
      const id = toggle.dataset.toggle;
      state.openTaskId = state.openTaskId === id ? null : id;
      renderList();
      return;
    }

    const act = e.target.closest("[data-act]");
    if(!act) return;
    const id = act.dataset.id;

    switch(act.dataset.act){
      case "complete":
        setTaskStatus(id, "complete");
        break;
      case "blocked":
        markWithNote(id, "blocked");
        break;
      case "timed-start":
        startTimedTask(id);
        break;
      case "timed-complete":
        completeTimedTask(id);
        break;
      case "reopen":
        requestReopen(id);
        break;
    }
  });

  /* One dismissal rule for the whole page: a click that isn't inside an open
     thing closes that thing. */
  document.addEventListener("click", e => {
    if(!e.target.closest(".nav-anchor")) closePlateMenu();
    if(!e.target.closest(".task") && state.openTaskId !== null){
      state.openTaskId = null;
      renderList();
    }
  });

  // Escape closes the topmost layer only
  document.addEventListener("keydown", e => {
    if(e.key !== "Escape") return;
    if($("confirm").classList.contains("on")){ closeConfirm(false); return; }
    if($("scanModal").classList.contains("on")){ closeScanner(); return; }
    if(anyOverlayOpen()){ closeOverlays(); return; }
    if($("plateMenu").classList.contains("on")){ closePlateMenu(); return; }
    if(state.openTaskId !== null){
      state.openTaskId = null;
      renderList();
    }
  });

  // Come back to a tab that's been idle → get fresh data immediately
  document.addEventListener("visibilitychange", () => {
    if(!document.hidden && state.mode !== "local") refresh({ quiet: true });
  });

  // Relative timestamps go stale while the page sits open
  setInterval(() => {
    if(document.hidden) return;
    renderHero();
    renderChrome();
  }, 60000);
}

/* ──────────────────────────────── boot ─────────────────────────────────── */

(async function boot(){
  console.log(
    `[Task Tracker] build ${BUILD} · repo ${REPO.owner}/${REPO.name}@${REPO.branch} · ` +
    `token ${token() ? "present" : "none"}`
  );

  wireEvents();
  render();                      // paint the empty shell straight away

  try{
    await determineMode();
  }catch(err){
    // determineMode handles its own expected failures; anything reaching here
    // is a genuine bug. Record it rather than leaving the UI mid-paint,
    // insisting it's still "working locally".
    console.error("[Task Tracker] Boot failed:", err);
    state.mode = "local";
    state.lastError = "Something went wrong starting up: " + (err && err.message || err) +
                      " — see the browser console for details.";
  }finally{
    render();                    // must always run, whatever happened above
    startPolling();
  }

  if(!me()) setTimeout(openUserModal, 400);
})();
