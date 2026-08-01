/* ============================================================================
   Task Tracker — rendering, overlays, and the main board
   ========================================================================== */
"use strict";

/* ─────────────────────────────── glyphs ────────────────────────────────── */

const ICON = {
  pending : '<circle cx="12" cy="12" r="8.5"/>',
  complete: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.2 2.5 2.5 4.7-5"/>',
  partial : '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
  blocked : '<circle cx="12" cy="12" r="8.5"/><path d="m8.6 8.6 6.8 6.8"/>',
  check   : '<path d="M20 6 9 17l-5-5"/>',
  half    : '<path d="M12 3v18"/><circle cx="12" cy="12" r="9"/>',
  slash   : '<circle cx="12" cy="12" r="9"/><path d="m8.4 8.4 7.2 7.2"/>',
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
  partial : { label:"Partial",            pill:"warm", verb:"partially completed" },
  blocked : { label:"Could not complete", pill:"bad",  verb:"marked blocked on" }
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

const OVERLAYS = ["userModal","adminModal"];
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

function openModal(id){
  lastFocus = document.activeElement;
  closePlateMenu();
  OVERLAYS.forEach(o => { if(o !== id) $(o).classList.remove("on"); });
  $(id).classList.add("on");
  $("scrim").classList.add("on");
  syncScrollLock();
  setTimeout(() => {
    const first = $(id).querySelector("input:not([type=hidden]),textarea,button.solid,button");
    if(first) first.focus();
  }, 90);
}

function closeOverlays(){
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

/* ───────────────────────────── derived data ────────────────────────────── */

const counts = () => {
  const c = { all: state.data.tasks.length, pending:0, complete:0, partial:0, blocked:0 };
  state.data.tasks.forEach(t => { c[t.status] = (c[t.status] || 0) + 1; });
  return c;
};

const doneCount = () => state.data.tasks.filter(t => t.status !== "pending").length;

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
  const pct   = total ? Math.round((done / total) * 100) : 0;

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
    sub.textContent = `${done} of ${total} addressed · ${left} still pending${tail}`;
  }
}

function renderStats(){
  const c = counts();
  $("sAll").textContent      = c.all;
  $("sComplete").textContent = c.complete;
  $("sPartial").textContent  = c.partial;
  $("sBlocked").textContent  = c.blocked;
  $("sPending").textContent  = c.pending;
  document.querySelectorAll(".strip .stat").forEach(cell => {
    cell.classList.toggle("on", cell.dataset.filter === state.filter);
  });
}

function renderList(){
  const list = $("list");
  const all  = state.data.tasks;
  const shown = state.filter === "all" ? all : all.filter(t => t.status === state.filter);

  $("empty").hidden       = all.length > 0;
  $("filterEmpty").hidden = !(all.length > 0 && shown.length === 0);
  $("clearFilterBtn").hidden = state.filter === "all";
  $("listTitle").textContent = state.filter === "all"
    ? "Active board"
    : STATUS[state.filter].label;

  if(!shown.length){ list.innerHTML = ""; return; }

  const readOnly = state.mode === "viewer" || amBlocked();
  list.innerHTML = shown.map(t => taskCard(t, readOnly)).join("");
}

function taskCard(t, readOnly){
  const st   = STATUS[t.status];
  const open = state.openTaskId === t.id;

  const meta = t.statusBy
    ? `${st.label} · ${escHtml(t.statusBy)} · <span title="${escHtml(fullTime(t.statusAt))}">${escHtml(relTime(t.statusAt))}</span>`
    : `Added by ${escHtml(t.createdBy || "—")} · <span title="${escHtml(fullTime(t.createdAt))}">${escHtml(relTime(t.createdAt))}</span>`;

  const noteBlock = t.statusNote
    ? `<div class="dw-note">${escHtml(t.statusNote)}</div>` : "";

  const roPending = (state.data.reopenRequests || []).some(r => r.taskId === t.id);
  const reopenBtn = t.status === "pending" ? ""
    : roPending
      ? `<button class="act ghost" disabled>${svg(ICON.undo)}Reopen requested</button>`
      : `<button class="act ghost" data-act="reopen" data-id="${t.id}">${svg(ICON.undo)}Reopen</button>`;

  const actions = readOnly
    ? `<div class="dw-meta">Connect a token to change this task.</div>`
    : `<div class="acts">
         <button class="act good ${t.status === "complete" ? "on" : ""}" data-act="complete" data-id="${t.id}">
           ${svg(ICON.check)}Complete</button>
         <button class="act warm ${t.status === "partial" ? "on" : ""}" data-act="partial" data-id="${t.id}">
           ${svg(ICON.half)}Partial</button>
         <button class="act bad ${t.status === "blocked" ? "on" : ""}" data-act="blocked" data-id="${t.id}">
           ${svg(ICON.slash)}Could not complete</button>
         ${reopenBtn}
       </div>`;

  return `
<article class="task s-${t.status}${open ? " open" : ""}" data-task="${t.id}">
  <button class="task-head" data-toggle="${t.id}" aria-expanded="${open}">
    <span class="task-glyph">${svg(ICON[t.status])}</span>
    <span class="task-main">
      <span class="task-title">${escHtml(t.title)}</span>
      ${t.description ? `<span class="task-desc">${escHtml(t.description)}</span>` : ""}
    </span>
    <span class="task-right">
      <span class="pill ${st.pill}">${escHtml(st.label)}</span>
      ${svg(ICON.down, "task-chev")}
    </span>
  </button>
  <div class="task-drawer"><div class="dw"><div class="dw-inner">
    ${t.description ? `<p class="dw-desc">${escHtml(t.description)}</p>` : ""}
    ${actions}
    ${noteBlock}
    <div class="dw-meta">${meta}</div>
  </div></div></div>
</article>`;
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
  const title = task.title;

  return commit(`${STATUS[status].label} "${title}"`, data => {
    const t = data.tasks.find(x => x.id === taskId);
    if(!t) throw new Error("That task was deleted by someone else.");
    t.status     = status;
    t.statusBy   = status === "pending" ? null : me();
    t.statusAt   = status === "pending" ? null : nowIso();
    t.statusNote = status === "pending" ? null : (note || null);
    return {
      action : "task." + status,
      subject: t.title,
      detail : note || ""
    };
  });
}

/* Partial and Could-not-complete both take effect immediately — no approval,
   unlike Reopen. But neither is much use to an admin reading the audit log
   without the story behind it, so the note is required rather than optional. */
const NOTE_PROMPT = {
  partial: {
    title: "Partially completed",
    ask  : t => `How much of “${t}” was completed?`,
    ph   : "What got done, and what's left?",
    yes  : "Mark partial"
  },
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

  const answer = await askConfirm({
    title: p.title,
    text : `${p.ask(task.title)} A note is required — it goes in the audit log.`,
    input: { value: "", placeholder: p.ph, maxlength: 200, required: true },
    yes  : p.yes
  });
  if(answer === false || answer == null) return;      // cancelled
  const clean = String(answer).trim();
  if(!clean){ toast("A note is required.", "bad"); return; }

  setTaskStatus(taskId, status, clean);
}

async function requestReopen(taskId){
  const task = state.data.tasks.find(t => t.id === taskId);
  if(!task) return;

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

  // Modal close buttons + scrim
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", closeOverlays);
  });
  $("scrim").addEventListener("click", closeOverlays);
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
      case "partial":
      case "blocked":
        markWithNote(id, act.dataset.act);
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
