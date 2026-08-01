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

const OVERLAYS = ["userModal","tokenModal","adminModal"];
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

function askConfirm({ title, text, facts = [], yes = "Confirm", no = "Cancel", danger = false } = {}){
  if(confirmResolve) closeConfirm(false);
  $("confirmTitle").textContent = title || "Are you sure?";
  $("confirmText").textContent  = text || "";
  $("confirmIc").className = "confirm-ic" + (danger ? "" : " calm");

  const box = $("confirmFacts");
  box.innerHTML = facts.map(([k,v]) =>
    `<div class="cf"><span>${escHtml(k)}</span><span>${escHtml(v)}</span></div>`).join("");
  box.hidden = facts.length === 0;

  const yesBtn = $("confirmYes");
  yesBtn.textContent = yes;
  yesBtn.className = "btn-block " + (danger ? "red" : "solid");
  $("confirmNo").textContent = no;

  $("confirm").classList.add("on");
  $("confirmScrim").classList.add("on");
  syncScrollLock();
  setTimeout(() => yesBtn.focus(), 60);
  return new Promise(resolve => { confirmResolve = resolve; });
}

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
    : state.mode === "member" ? `Connected as ${state.user || "—"} · click to manage`
    : state.mode === "viewer" ? "Viewing only · click to connect a token"
    : "Local mode · changes stay in this browser";

  // Banner
  const banner = $("banner"), text = $("bannerText"), btn = $("bannerBtn");
  let show = null;
  if(state.lastError){
    show = { cls:"bad", msg: state.lastError, action:"Retry", fn: () => refresh() };
  }else if(state.mode === "local" && !repoConfigured()){
    show = { cls:"", msg:"Local mode — changes stay in this browser. Set REPO in config.js to share with your team.", action:null };
  }else if(state.mode === "local"){
    show = { cls:"bad", msg:"Couldn't reach the shared board. Working locally for now.", action:"Retry", fn: () => location.reload() };
  }else if(state.mode === "viewer"){
    show = { cls:"info", msg:"You're viewing the board. Connect a GitHub token to complete tasks and check out plates.", action:"Connect", fn: openTokenModal };
  }
  banner.hidden = !show;
  if(show){
    banner.className = "banner" + (show.cls ? " " + show.cls : "");
    text.textContent = show.msg;
    btn.hidden = !show.action;
    if(show.action){ btn.textContent = show.action; btn.onclick = show.fn; }
  }

  // Footer
  $("footMode").textContent =
    state.mode === "member" ? `Connected as ${state.user || me() || "—"}`
    : state.mode === "viewer" ? "Read-only"
    : "Local mode";
  $("footSync").textContent = state.lastSync
    ? "Last synced " + relTime(new Date(state.lastSync).toISOString())
    : (state.mode === "local" ? "Not syncing" : "Never synced");
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

  const readOnly = state.mode === "viewer";
  list.innerHTML = shown.map(t => taskCard(t, readOnly)).join("");
}

function taskCard(t, readOnly){
  const st   = STATUS[t.status];
  const open = state.openTaskId === t.id;
  const drafting = state.noteDraft && state.noteDraft.taskId === t.id;

  const meta = t.statusBy
    ? `${st.label} · ${escHtml(t.statusBy)} · <span title="${escHtml(fullTime(t.statusAt))}">${escHtml(relTime(t.statusAt))}</span>`
    : `Added by ${escHtml(t.createdBy || "—")} · <span title="${escHtml(fullTime(t.createdAt))}">${escHtml(relTime(t.createdAt))}</span>`;

  const noteBlock = t.statusNote
    ? `<div class="dw-note">${escHtml(t.statusNote)}</div>` : "";

  const actions = readOnly
    ? `<div class="dw-meta">Connect a token to change this task.</div>`
    : drafting
      ? noteForm(t, state.noteDraft.status)
      : `<div class="acts">
           <button class="act good ${t.status === "complete" ? "on" : ""}" data-act="complete" data-id="${t.id}">
             ${svg(ICON.check)}Complete</button>
           <button class="act warm ${t.status === "partial" ? "on" : ""}" data-act="partial" data-id="${t.id}">
             ${svg(ICON.half)}Partial</button>
           <button class="act bad ${t.status === "blocked" ? "on" : ""}" data-act="blocked" data-id="${t.id}">
             ${svg(ICON.slash)}Could not complete</button>
           ${t.status !== "pending"
             ? `<button class="act ghost" data-act="reopen" data-id="${t.id}">${svg(ICON.undo)}Reopen</button>`
             : ""}
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

function noteForm(t, status){
  const st = STATUS[status];
  return `
<div class="note-row">
  <input class="inp" id="noteInput" maxlength="140" autocomplete="off"
         placeholder="Why? (optional — press Enter to save)" value="${escHtml(state.noteDraft.text || "")}">
  <button class="act ${status === "partial" ? "warm" : "bad"} on" data-act="note-save" data-id="${t.id}">Save</button>
  <button class="act" data-act="note-cancel" data-id="${t.id}">Cancel</button>
</div>
<div class="dw-meta">Marking as <strong>${escHtml(st.label)}</strong>.</div>`;
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
    const mine  = name && p.checkedOutBy === name;
    const taken = p.checkedOutBy && !mine;
    const sub = mine  ? "Checked out by you — click to release"
              : taken ? `Checked out by ${p.checkedOutBy}`
              : (p.note || "Available");
    return `
<button class="menu-item ${mine ? "mine" : taken ? "taken" : ""}" role="menuitem"
        data-plate="${p.id}" ${taken ? "disabled" : ""}>
  <span class="mi-main">
    <span class="mi-plate">${escHtml(p.label)}</span>
    <span class="mi-sub">${escHtml(sub)}</span>
  </span>
  ${mine ? '<span class="pill ok">Yours</span>' : taken ? '<span class="pill idle">Taken</span>' : ""}
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

function checkoutPlate(plateId){
  const name = me();
  return commit("Check out plate", data => {
    const p = data.plates.find(x => x.id === plateId);
    if(!p) throw new Error("That plate no longer exists.");
    if(p.checkedOutBy && p.checkedOutBy !== name){
      throw new Error(`${p.label} was just checked out by ${p.checkedOutBy}.`);
    }
    // One plate per person — release any other first.
    const entries = [];
    data.plates.forEach(other => {
      if(other.id !== plateId && other.checkedOutBy === name){
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

function releasePlate(plateId){
  const name = me();
  return commit("Release plate", data => {
    const p = data.plates.find(x => x.id === plateId);
    if(!p) return null;
    if(p.checkedOutBy !== name) throw new Error("That plate isn't checked out to you.");
    p.checkedOutBy = null;
    p.checkedOutAt = null;
    return { action:"plate.release", subject: p.label };
  });
}

/* ───────────────────────────── user modal ──────────────────────────────── */

function openUserModal(){
  $("userInput").value = me() || "";
  $("userErr").hidden = true;
  openModal("userModal");
}

function saveUserName(){
  const input = $("userInput");
  const next = input.value.trim();
  const err  = $("userErr");

  if(next.length < 2){
    err.textContent = "Please enter at least two characters.";
    err.hidden = false;
    input.focus();
    return;
  }
  if(next.length > 40){
    err.textContent = "That's a bit long — 40 characters max.";
    err.hidden = false;
    return;
  }

  const previous = me();
  setMe(next);
  closeOverlays();
  render();

  if(!previous){
    toast(`You're set as ${next}.`, "good");
  }else if(previous !== next){
    toast(`Name changed to ${next}.`, "good");
    // Keep history coherent: reattribute anything this browser still holds.
    if(state.mode !== "viewer"){
      commit("Rename", data => {
        data.plates.forEach(p => { if(p.checkedOutBy === previous) p.checkedOutBy = next; });
        return { action:"identity.rename", subject: next, detail:`was ${previous}` };
      });
    }
  }
}

/* ──────────────────────────── token modal ──────────────────────────────── */

function openTokenModal(){
  const t = token();
  const configured = repoConfigured();

  $("repoLine").innerHTML = configured
    ? `Board data lives in <strong>${escHtml(REPO.owner)}/${escHtml(REPO.name)}</strong> → <strong>${escHtml(REPO.path)}</strong> on <strong>${escHtml(REPO.branch)}</strong>.`
    : `No repository configured yet. Edit <strong>config.js</strong> and set <strong>REPO.owner</strong> to share this board with your team.`;

  $("tokenConnected").hidden = !t;
  $("tokenSetup").hidden     = !!t;
  if(t){
    $("tokenUser").textContent = state.user || "—";
    $("tokenMask").textContent = maskToken(t);
  }else{
    $("tokenInput").value = "";
    $("tokenErr").hidden = true;
    $("tokenLink").href = configured
      ? `https://github.com/settings/personal-access-tokens/new`
      : `https://github.com/settings/personal-access-tokens`;
  }
  openModal("tokenModal");
}

async function saveTokenFromInput(){
  const input = $("tokenInput");
  const err   = $("tokenErr");
  const btn   = $("tokenSave");
  const value = input.value.trim();

  const fail = msg => { err.textContent = msg; err.hidden = false; input.focus(); };

  err.hidden = true;
  if(!value)               return fail("Paste a token first.");
  if(value.length < 20)    return fail("That doesn't look like a GitHub token.");
  if(/\s/.test(value))     return fail("The token shouldn't contain spaces.");

  btn.disabled = true;
  btn.textContent = "Checking…";
  setToken(value);

  try{
    const res  = await gh("https://api.github.com/user");
    const user = await res.json();
    state.user = user.login;
    state.mode = "member";
    state.lastError = null;

    await refresh({ quiet: true });
    startPolling();
    closeOverlays();
    render();
    toast(`Connected as ${user.login}. You can make changes now.`, "good");
  }catch(e){
    setToken(null);
    state.user = null;
    state.mode = repoConfigured() ? "viewer" : "local";
    fail(e.status === 401
      ? "GitHub rejected that token. Check it was copied in full and hasn't expired."
      : explainError(e, "verify the token"));
    render();
  }finally{
    btn.disabled = false;
    btn.textContent = "Connect";
  }
}

async function disconnectToken(){
  const ok = await askConfirm({
    title: "Disconnect token?",
    text : "You'll still be able to view the board, but not change anything until you reconnect.",
    yes  : "Disconnect", danger: true
  });
  if(!ok) return;
  setToken(null);
  state.user = null;
  state.mode = repoConfigured() ? "viewer" : "local";
  startPolling();
  closeOverlays();
  render();
  toast("Token removed from this browser.", "");
}

/* ──────────────────────────────── events ───────────────────────────────── */

function wireEvents(){
  // Nav
  $("userBtn").addEventListener("click", openUserModal);
  // Wrapped, not passed directly: openAdminModal lives in admin.js, which loads
  // after this file. An arrow defers the lookup until the click.
  $("adminBtn").addEventListener("click", () => openAdminModal());
  $("syncChip").addEventListener("click", openTokenModal);
  $("refreshBtn").addEventListener("click", () => refresh());

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
  $("confirmYes").addEventListener("click", () => closeConfirm(true));

  // Username modal
  $("userSave").addEventListener("click", saveUserName);
  $("userInput").addEventListener("keydown", e => { if(e.key === "Enter") saveUserName(); });

  // Token modal
  $("tokenSave").addEventListener("click", saveTokenFromInput);
  $("tokenInput").addEventListener("keydown", e => { if(e.key === "Enter") saveTokenFromInput(); });
  $("tokenDisconnect").addEventListener("click", disconnectToken);

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
      state.noteDraft = null;
      renderList();
      return;
    }

    const act = e.target.closest("[data-act]");
    if(!act) return;
    const id = act.dataset.id;

    switch(act.dataset.act){
      case "complete":
        state.noteDraft = null;
        setTaskStatus(id, "complete");
        break;
      case "partial":
      case "blocked":
        state.noteDraft = { taskId: id, status: act.dataset.act, text: "" };
        renderList();
        setTimeout(() => { const n = $("noteInput"); if(n) n.focus(); }, 40);
        break;
      case "note-save": {
        const input = $("noteInput");
        const status = state.noteDraft ? state.noteDraft.status : null;
        const text = input ? input.value.trim() : "";
        state.noteDraft = null;
        if(status) setTaskStatus(id, status, text);
        break;
      }
      case "note-cancel":
        state.noteDraft = null;
        renderList();
        break;
      case "reopen":
        state.noteDraft = null;
        setTaskStatus(id, "pending");
        break;
    }
  });

  // Enter inside the note field saves it
  $("list").addEventListener("keydown", e => {
    if(e.key !== "Enter" || e.target.id !== "noteInput") return;
    e.preventDefault();
    const draft = state.noteDraft;
    if(!draft) return;
    const text = e.target.value.trim();
    state.noteDraft = null;
    setTaskStatus(draft.taskId, draft.status, text);
  });
  // Keep the draft text if a poll re-renders underneath us
  $("list").addEventListener("input", e => {
    if(e.target.id === "noteInput" && state.noteDraft) state.noteDraft.text = e.target.value;
  });

  /* One dismissal rule for the whole page: a click that isn't inside an open
     thing closes that thing. */
  document.addEventListener("click", e => {
    if(!e.target.closest(".nav-anchor")) closePlateMenu();
    if(!e.target.closest(".task") && state.openTaskId !== null){
      state.openTaskId = null;
      state.noteDraft = null;
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
      state.noteDraft = null;
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
  wireEvents();
  render();                      // paint the empty shell straight away
  await determineMode();
  render();
  startPolling();

  if(!me()) setTimeout(openUserModal, 400);
})();
