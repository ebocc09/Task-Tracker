/* ============================================================================
   Task Tracker — admin panel
   ----------------------------------------------------------------------------
   The passcode gate is deliberately modest. On a public repo the code is in the
   source, so this stops a teammate wandering in by accident — it does not stop
   anyone determined. Actual write access is enforced by GitHub: without a token
   that has Contents: Read and write on the repo, nothing here can persist.
   ========================================================================== */
"use strict";

const UNLOCK_KEY = "tt.unlocked";

/* The first text field of whichever section is showing — what focus should land
   on when the panel opens, so you can just start typing. */
const ADMIN_FIRST_FIELD = "#adminPane .sec.on .inp";

const isUnlocked = () => sessionStorage.getItem(UNLOCK_KEY) === "1";

/* ─────────────────────────────── open / gate ───────────────────────────── */

function openAdminModal(){
  // Never reopen into a half-finished edit from last time the panel was open.
  cancelTemplateEdit();
  const unlocked = isUnlocked();
  $("adminGate").hidden = unlocked;
  $("adminBody").hidden = !unlocked;
  $("adminModal").classList.toggle("wide", unlocked);
  $("gateErr").textContent = "";
  $("otp").classList.remove("bad");
  if(unlocked){
    renderAdmin();
  }else{
    otpClear(false);
  }
  // One focus decision, made by openModal — a second timer here just raced it.
  openModal("adminModal", unlocked ? ADMIN_FIRST_FIELD : "#otp .otp-box");
}

/* ── six-digit gate ─────────────────────────────────────────────────────── */

const otpBoxes = Array.from(document.querySelectorAll("#otp .otp-box"));
const otpValue = () => otpBoxes.map(b => b.value).join("");

function otpClear(focus){
  otpBoxes.forEach(b => { b.value = ""; b.classList.remove("filled"); });
  if(focus) otpBoxes[0].focus();
}

function otpFill(digits){
  otpBoxes.forEach((b, i) => {
    b.value = digits[i] || "";
    b.classList.toggle("filled", Boolean(b.value));
  });
  const nextEmpty = otpBoxes.findIndex(b => !b.value);
  (nextEmpty === -1 ? otpBoxes[5] : otpBoxes[nextEmpty]).focus();
  if(digits.length >= 6) submitGate();
}

otpBoxes.forEach((box, i) => {
  box.addEventListener("input", () => {
    // Keep digits only; a fast typist can land two characters in one box.
    const digits = box.value.replace(/\D/g, "");
    box.value = digits.slice(0, 1);
    box.classList.toggle("filled", Boolean(box.value));
    $("gateErr").textContent = "";
    $("otp").classList.remove("bad");

    if(digits.length > 1){ otpFill(otpValue().slice(0, i) + digits); return; }
    if(box.value && i < 5) otpBoxes[i + 1].focus();
    if(otpValue().length === 6) submitGate();
  });

  box.addEventListener("keydown", e => {
    if(e.key === "Backspace" && !box.value && i > 0){
      e.preventDefault();
      otpBoxes[i - 1].value = "";
      otpBoxes[i - 1].classList.remove("filled");
      otpBoxes[i - 1].focus();
    }
    if(e.key === "ArrowLeft"  && i > 0){ e.preventDefault(); otpBoxes[i - 1].focus(); }
    if(e.key === "ArrowRight" && i < 5){ e.preventDefault(); otpBoxes[i + 1].focus(); }
    if(e.key === "Enter") submitGate();
  });

  box.addEventListener("paste", e => {
    e.preventDefault();
    const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if(digits) otpFill(digits);
  });

  box.addEventListener("focus", () => box.select());
});

function submitGate(){
  const code = otpValue();
  if(code.length < 6){
    $("gateErr").textContent = "Enter all six digits.";
    return;
  }
  if(code === String(ADMIN_PASSCODE)){
    sessionStorage.setItem(UNLOCK_KEY, "1");
    otpClear(false);
    $("gateErr").textContent = "";
    $("adminGate").hidden = true;
    $("adminBody").hidden = false;
    $("adminModal").classList.add("wide");
    renderAdmin();
    showSection("tasks");
    // The box that had focus is now hidden; carry it into the panel instead of
    // dropping it on <body> and making you click.
    focusFirst($("adminModal"), ADMIN_FIRST_FIELD);
  }else{
    $("otp").classList.add("bad");
    $("gateErr").textContent = "Incorrect code.";
    setTimeout(() => { $("otp").classList.remove("bad"); otpClear(true); }, 420);
  }
}

function showSection(name){
  document.querySelectorAll("#adminRail .rail-item").forEach(b => b.classList.toggle("on", b.dataset.sec === name));
  document.querySelectorAll("#adminPane .sec").forEach(s => s.classList.toggle("on", s.dataset.sec === name));
  $("adminPane").scrollTop = 0;
}

function flash(message){
  const el = $("adminFlash");
  el.textContent = message;
  el.classList.add("on");
  setTimeout(() => el.classList.remove("on"), 1800);
}

/* ───────────────────────────────── render ──────────────────────────────── */

function renderAdmin(){
  renderAdminTasks();
  renderQuickAdd();
  renderTaskFormMode();
  renderLeaderboard();
  renderAdminPlates();
  renderAdminPeople();
  renderApprovals();
  renderAdminAudit();
  renderConnection();
  renderRailFoot();
}

/* Reopen and Reset both put a staged task back to stage 1 rather than to
   wherever it stopped — both mean "start this over", so finished stages are
   cleared along with everything else. */
const resetStages = t => (t.stages || []).forEach(s => {
  s.status = "pending"; s.by = null; s.at = null; s.note = null;
});

/* ─────────────────────────── rename engine ─────────────────────────────── */

/* Rewrite one display name everywhere it appears in the shared data, and drop
   a breadcrumb so the affected browser updates itself (see applyIdentityRenames
   in sync.js). Shared by the People pencil and by approving a request. Runs
   inside a commit mutator, so it must be a pure function of `data`. */
function applyRename(data, oldName, newName){
  (data.tasks || []).forEach(t => {
    if(t.statusBy  === oldName) t.statusBy  = newName;
    if(t.createdBy === oldName) t.createdBy = newName;
    // Per-stage attribution counts as history too — the whole point of a
    // rename is that the old name survives nowhere.
    (t.stages || []).forEach(s => { if(s.by === oldName) s.by = newName; });
  });
  (data.plates || []).forEach(p => {
    if(p.checkedOutBy === oldName) p.checkedOutBy = newName;
    if(p.forcedBy     === oldName) p.forcedBy     = newName;
  });
  if(Array.isArray(data.blocked)){
    data.blocked = [...new Set(data.blocked.map(n => n === oldName ? newName : n))];
  }
  // Scrub the old name from history too — the whole point when it's a bad name.
  (data.audit || []).forEach(a => { if(a.who === oldName) a.who = newName; });
  // Miss this and a rename splits one person into two leaderboard rows, each
  // with a share of the credit they actually earned as one person.
  (data.scores || []).forEach(s => { if(s.who === oldName) s.who = newName; });
  data.renames = data.renames || [];
  data.renames.push({ id: uid("r"), at: nowIso(), by: me() || "an admin", from: oldName, to: newName });
  if(data.renames.length > 200) data.renames = data.renames.slice(-200);
}

async function renamePerson(oldName){
  const next = await askConfirm({
    title: "Change display name",
    text : `Rename “${oldName}” everywhere on the board, including past audit entries. They'll be told their name was changed the next time their page syncs.`,
    input: { value: oldName, placeholder: "New display name", maxlength: 40 },
    yes  : "Rename"
  });
  if(!next) return;                        // false (cancel) or empty
  const clean = String(next).trim();
  if(clean.length < 2)  { toast("Name needs at least two characters.", "bad"); return; }
  if(clean.length > 40) { toast("That's too long (40 max).", "bad"); return; }
  if(clean === oldName) return;

  await commit(`Rename ${oldName}`, data => {
    applyRename(data, oldName, clean);
    // If they had a pending request, it's moot now.
    data.requests = (data.requests || []).filter(r => r.from !== oldName);
    return { action:"person.rename", subject: clean };
  });
  render();
  renderAdmin();
  flash("Renamed");
}

/* ────────────────────────────── approvals ──────────────────────────────── */

function renderApprovals(){
  const reqs   = state.data.requests || [];
  const reopen = state.data.reopenRequests || [];
  const total  = reqs.length + reopen.length;
  $("apprCount").textContent = total;
  $("apprDot").hidden = total === 0;

  const box = $("admApprovals");
  if(!total){
    box.innerHTML = `<div class="adm-empty">No pending requests.</div>`;
    return;
  }

  let html = "";

  if(reopen.length){
    html += `<div class="adm-subhead">Task reopens</div>`;
    html += reopen.map(r => `
<div class="adm-row">
  <div class="am">
    <div class="adm-t">${escHtml(r.taskTitle)}</div>
    <div class="adm-s">${escHtml(r.by)} · ${escHtml(relTime(r.at))} — “${escHtml(r.reason)}”</div>
  </div>
  <button class="mini" data-roapprove="${r.id}">Approve</button>
  <button class="mini red" data-roreject="${r.id}">Reject</button>
</div>`).join("");
  }

  if(reqs.length){
    html += `<div class="adm-subhead">Name changes</div>`;
    html += reqs.map(r => `
<div class="adm-row">
  <div class="am">
    <div class="adm-t">${escHtml(r.from)} → ${escHtml(r.to)}</div>
    <div class="adm-s">Requested ${escHtml(relTime(r.at))}</div>
  </div>
  <button class="mini" data-approve="${r.id}">Approve</button>
  <button class="mini red" data-reject="${r.id}">Reject</button>
</div>`).join("");
  }

  box.innerHTML = html;
}

async function approveReopen(id){
  const r = (state.data.reopenRequests || []).find(x => x.id === id);
  if(!r) return;

  await commit(`Approve reopen: ${r.taskTitle}`, data => {
    const req = (data.reopenRequests || []).find(x => x.id === id);
    if(!req) return null;
    data.reopenRequests = (data.reopenRequests || []).filter(x => x.id !== id);
    const task = data.tasks.find(t => t.id === req.taskId);
    if(!task) return null;                  // task deleted meanwhile — just drop the request

    /* A timed task that ran out is terminal for everyone, admins included.
       There is no route to a pending reopen request on one — the button is
       hidden and requestReopen refuses — but a request raised before the clock
       expired can still be sitting here when it does. Dropping the request and
       refusing is the honest outcome; the alternative is an admin quietly
       undoing a failure the whole team saw. */
    if(task.status === "failed"){
      throw new Error(`“${task.title}” ran out of time and is locked. It cannot be reopened.`);
    }

    /* Hand back this round's leaderboard credit. A board reset keeps credit —
       it starts a new round, and the work really was done. A reopen says the
       opposite: it wasn't. Without this, complete → reopen → complete scores
       the same task twice. Read before resetStages, which clears the stage
       state this needs, and take only the NEWEST event per stage — scores is
       newest-first, so findIndex is that — leaving earlier rounds alone. */
    const marks = (task.stages || []).length
      ? task.stages.filter(s => s.status === "complete").map(s => s.id)
      : (task.status === "complete" ? [null] : []);
    let revoked = 0;
    marks.forEach(stageId => {
      const i = (data.scores || []).findIndex(s => s.taskId === task.id && s.stageId === stageId);
      if(i !== -1){ revoked += data.scores[i].value; data.scores.splice(i, 1); }
    });

    task.status = "pending"; task.statusBy = null; task.statusAt = null; task.statusNote = null;
    resetStages(task);
    const detail = revoked
      ? `${req.reason}${req.reason ? " · " : ""}${fmtCredit(revoked)} leaderboard credit revoked`
      : req.reason;
    return { action:"reopen.approve", subject: task.title, detail };
  });
  render();
  renderAdmin();
  flash("Reopened");
}

async function rejectReopen(id){
  const r = (state.data.reopenRequests || []).find(x => x.id === id);
  if(!r) return;

  const ok = await askConfirm({
    title: "Reject reopen request?",
    text : `“${r.taskTitle}” stays as it is.`,
    facts: [["Requested by", r.by], ["Reason", r.reason]],
    yes  : "Reject", danger: true
  });
  if(!ok) return;

  await commit("Reject reopen", data => {
    const req = (data.reopenRequests || []).find(x => x.id === id);
    if(!req) return null;
    data.reopenRequests = (data.reopenRequests || []).filter(x => x.id !== id);
    return { action:"reopen.reject", subject: req.taskTitle };
  });
  renderAdmin();
  flash("Rejected");
}

async function approveRequest(id){
  const req = (state.data.requests || []).find(r => r.id === id);
  if(!req) return;

  await commit(`Approve name change to ${req.to}`, data => {
    const r = (data.requests || []).find(x => x.id === id);
    if(!r) return null;
    applyRename(data, r.from, r.to);
    data.requests = (data.requests || []).filter(x => x.id !== id);
    return { action:"request.approve", subject: r.to };
  });
  render();
  renderAdmin();
  flash("Approved");
}

async function rejectRequest(id){
  const req = (state.data.requests || []).find(r => r.id === id);
  if(!req) return;

  const ok = await askConfirm({
    title: "Reject this request?",
    text : `“${req.from}” stays as they are. They'll see the request is gone next time they open their name panel.`,
    facts: [["Requested", `${req.from} → ${req.to}`]],
    yes  : "Reject", danger: true
  });
  if(!ok) return;

  await commit("Reject name change", data => {
    const r = (data.requests || []).find(x => x.id === id);
    if(!r) return null;
    data.requests = (data.requests || []).filter(x => x.id !== id);
    return { action:"request.reject", subject: r.to };
  });
  renderAdmin();
  flash("Rejected");
}

/* ────────────────────────────── quick add ──────────────────────────────── */

function renderQuickAdd(){
  const tpls = state.data.templates || [];

  /* This runs on every poll, so it's also where an edit finds out its template
     was deleted by someone else. Drop out of edit mode but keep what they've
     typed — losing their work to another admin's Delete is the wrong trade. */
  if(editingTemplateId && !tpls.some(t => t.id === editingTemplateId)){
    cancelTemplateEdit(true);
    toast("That saved task was removed by someone else. Your text is still in the form.", "bad");
  }

  $("qaCount").textContent = tpls.length;
  $("qaRailCount").textContent = tpls.length;
  $("qaAddAll").hidden = tpls.length === 0;

  const box = $("admQuick");
  if(!tpls.length){
    box.innerHTML = `<div class="adm-empty">No saved tasks yet. In <strong>Tasks</strong>, fill one in and click <strong>Save task</strong>.</div>`;
    return;
  }

  box.innerHTML = tpls.map(tp => {
    const n = (tp.stages || []).length;
    return `
<div class="adm-row">
  <div class="am">
    <div class="adm-t">${escHtml(tp.title)}</div>
    <div class="adm-s">${tp.description ? escHtml(tp.description) : "No description"}</div>
  </div>
  ${tp.leaderboard ? `<span class="pill ok">Leaderboard</span>` : ""}
  ${tp.timed && tp.limitMinutes ? `<span class="pill info">${tp.limitMinutes}m timed</span>` : ""}
  ${n ? `<span class="pill info">${n} stages</span>` : ""}
  <button class="mini" data-qaadd="${tp.id}">Add to board</button>
  <button class="mini" data-qaedit="${tp.id}">Edit</button>
  <button class="mini red" data-qadel="${tp.id}">Delete</button>
</div>`;
  }).join("");
}

/* ── editing a saved task ──
   The Add-a-task form is retargeted rather than duplicated, so the stage editor,
   validation and the leaderboard checkbox all behave identically either way.
   Which template is live is held here; null means the form is in add mode. */
let editingTemplateId = null;

/* One clear path for both Submit and Save. They each did this by hand before,
   which was survivable while it was two text fields — miss the checkbox and the
   NEXT task an admin submits is silently flagged for the leaderboard. */
function clearTaskForm(){
  $("taskTitle").value = "";
  $("taskDesc").value  = "";
  $("taskLb").checked  = false;
  $("taskTimed").checked = false;
  $("taskTimerMins").value = "10";
  syncTimedFields();
  clearStageRows();
}

/* Ticking Timed swaps the stage editor for an explanation and reveals the
   minutes box. Called from the checkbox, from clearTaskForm and from
   loadTemplateIntoForm, so the three can never disagree about what is on
   screen. */
function syncTimedFields(){
  const on = $("taskTimed").checked;
  $("taskTimerWrap").hidden     = !on;
  $("taskStagesField").hidden   = on;
  $("taskStagesBlocked").hidden = !on;
}

/* The minutes box, validated. Returns null when Timed is off, or when the
   value is not a whole number of minutes above zero — the caller turns that
   second case into an error rather than silently adding an untimed task. */
function readTimerMinutes(){
  if(!$("taskTimed").checked) return null;
  const n = Number($("taskTimerMins").value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : NaN;
}

/* Excludes the template being edited, or changing only a description would
   collide with itself. */
function templateTitleTaken(title, exceptId){
  const want = title.toLowerCase();
  return (state.data.templates || []).some(t => t.id !== exceptId && t.title.toLowerCase() === want);
}

function loadTemplateIntoForm(tp){
  /* Fields first: renderStageRows ends in refreshStageBase, which reads
     #taskTitle to paint the stage-1 preview. */
  $("taskTitle").value = tp.title;
  $("taskDesc").value  = tp.description || "";
  $("taskLb").checked  = tp.leaderboard === true;
  $("taskTimed").checked   = tp.timed === true;
  $("taskTimerMins").value = tp.limitMinutes || 10;
  // Before renderStageRows: a timed template has no stages and the stage
  // editor must already be hidden when it runs.
  syncTimedFields();
  /* slice(1) is load-bearing. stages[0] IS the title and description above —
     see stagesToSave, which prepends them — and the base row already renders
     it. Passing the whole array shows stage 1 twice and re-saving keeps the
     duplicate, so the list would grow by one on every edit round trip. */
  renderStageRows((tp.stages || []).slice(1));
}

function beginTemplateEdit(id){
  const tp = (state.data.templates || []).find(t => t.id === id);
  if(!tp) return;
  editingTemplateId = id;
  loadTemplateIntoForm(tp);
  renderTaskFormMode();
  showSection("tasks");
  $("taskTitle").focus();
}

/* keepText: the template was deleted by someone else mid-edit. Losing their
   typed work to that is the wrong trade, so the form is left as it stands. */
function cancelTemplateEdit(keepText){
  if(!editingTemplateId) return;
  editingTemplateId = null;
  if(!keepText) clearTaskForm();
  renderTaskFormMode();
}

/* Swaps the heading, banner and button row between add and edit. */
function renderTaskFormMode(){
  const tp = editingTemplateId
    ? (state.data.templates || []).find(t => t.id === editingTemplateId)
    : null;
  const editing = Boolean(tp);

  $("taskFormHead").textContent = editing ? "Edit saved task" : "Add a task";
  $("taskFormSub").textContent  = editing
    ? "Changes are saved to Quick add."
    : "Appears on the active board for everyone as soon as it saves.";

  const banner = $("taskEditBanner");
  banner.hidden = !editing;
  if(editing){
    banner.innerHTML = `Editing <strong>${escHtml(tp.title)}</strong> — changes apply to Quick add only, not to tasks already on the board.`;
  }

  $("taskBtns").hidden     = editing;
  $("taskEditBtns").hidden = !editing;
}

async function updateTemplate(){
  const id = editingTemplateId;
  if(!id) return;

  const titleEl = $("taskTitle"), descEl = $("taskDesc");
  const title = titleEl.value.trim();
  const desc  = descEl.value.trim();
  const mins  = readTimerMinutes();
  const timed = mins !== null;
  // A timed task is single-step, so its stage rows are hidden and ignored.
  const stages = timed ? [] : stagesToSave(title, desc);
  const leaderboard = $("taskLb").checked;

  if(!title){ toast("Give the task a title.", "bad"); titleEl.focus(); return; }
  if(Number.isNaN(mins)){
    toast("A timed task needs a limit of at least 1 minute.", "bad");
    $("taskTimerMins").focus();
    return;
  }
  if(templateTitleTaken(title, id)){
    toast(`"${title}" is already in Quick add.`, "bad");
    return;
  }

  const ok = await commit(`Update saved task "${title}"`, data => {
    const t = (data.templates || []).find(x => x.id === id);
    if(!t) throw new Error("That saved task no longer exists.");
    t.title = title; t.description = desc; t.stages = stages; t.leaderboard = leaderboard;
    t.timed = timed; t.limitMinutes = mins;
    return { action:"template.edit", subject: title };
  });

  if(ok){
    editingTemplateId = null;
    clearTaskForm();
    renderTaskFormMode();
    flash("Saved task updated");
    renderAdmin();
    showSection("quickadd");
  }
}

/* ── stage rows in the Add-a-task form ──
   These are pure DOM until Submit or Save reads them. There's nothing to put
   on the board until the task itself is created, so nothing to sync and no
   state to keep anywhere else. Rows are re-rendered from their own current
   values on every add/remove, which is what keeps typed text from being lost. */
function readStageRows(){
  // :not(.base) — the stage-1 preview row is in here too and has no inputs.
  return [...document.querySelectorAll("#stageList .stage-row:not(.base)")].map(row => ({
    title      : row.querySelector(".stage-row-t").value.trim(),
    description: row.querySelector(".stage-row-d").value.trim()
  }));
}

/* The task's own title and description ARE stage 1, so "Add stage" starts at
   stage 2 and the rows here are only the ones after the first. No extra rows
   means an ordinary one-step task, not a one-stage one.

   An admin who adds a row and changes their mind shouldn't get a blank stage on
   the board, so untitled rows are dropped rather than rejected. */
function stagesToSave(title, description){
  const extra = readStageRows().filter(s => s.title);
  return extra.length ? [{ title, description }, ...extra] : [];
}

function renderStageRows(rows){
  const box = $("stageList");
  if(!rows.length){ box.innerHTML = ""; return; }

  // Stage 1 is shown but not editable here — it mirrors the fields above.
  box.innerHTML = `
<div class="stage-row base">
  <div class="stage-row-h">
    <span class="stage-row-n">Stage 1</span>
    <span class="stage-row-tag">the title above</span>
  </div>
  <div class="stage-base-t" id="stageBaseTitle"></div>
</div>` + rows.map((s, i) => `
<div class="stage-row">
  <div class="stage-row-h">
    <span class="stage-row-n">Stage ${i + 2}</span>
    <button class="mini red" data-stagedel="${i}">Remove</button>
  </div>
  <input class="inp stage-row-t" maxlength="90" autocomplete="off"
         placeholder="e.g. Upload the photos to Teams" value="${escHtml(s.title)}">
  <textarea class="inp ta stage-row-d" maxlength="400" rows="2"
            placeholder="What does this stage involve? (optional)">${escHtml(s.description)}</textarea>
</div>`).join("");

  refreshStageBase();
}

/* Keep the stage-1 preview in step with the title field as it's typed. Set as
   text, not markup, so this can't disturb focus in the rows below it. */
function refreshStageBase(){
  const el = $("stageBaseTitle");
  if(el) el.textContent = $("taskTitle").value.trim() || "Untitled task";
}

function addStageRow(){
  const rows = readStageRows();
  rows.push({ title:"", description:"" });
  renderStageRows(rows);
  const inputs = document.querySelectorAll("#stageList .stage-row-t");
  if(inputs.length) inputs[inputs.length - 1].focus();
}

function removeStageRow(i){
  const rows = readStageRows();
  rows.splice(i, 1);
  renderStageRows(rows);
}

const clearStageRows = () => renderStageRows([]);

async function saveTaskTemplate(){
  const titleEl = $("taskTitle"), descEl = $("taskDesc");
  const title = titleEl.value.trim();
  const desc  = descEl.value.trim();
  const mins  = readTimerMinutes();
  const timed = mins !== null;
  const stages = timed ? [] : stagesToSave(title, desc);

  if(!title){ toast("Give the task a title to save it.", "bad"); titleEl.focus(); return; }
  if(Number.isNaN(mins)){
    toast("A timed task needs a limit of at least 1 minute.", "bad");
    $("taskTimerMins").focus();
    return;
  }
  if(templateTitleTaken(title, null)){
    toast(`"${title}" is already in Quick add.`, "bad");
    return;
  }

  const leaderboard = $("taskLb").checked;
  const id = uid("q");
  const ok = await commit(`Save task template "${title}"`, data => {
    data.templates = data.templates || [];
    data.templates.push({ id, title, description: desc, leaderboard, stages,
                          timed, limitMinutes: mins });
    return { action:"template.save", subject: title };
  });

  if(ok){
    // Clear like Submit does, so building a library is a fast type-Save-repeat.
    clearTaskForm();
    titleEl.focus();
    flash("Saved to Quick add");
    renderAdmin();
  }
}

/* Build a fresh board task from a stored template. The template holds only the
   blueprint — titles and descriptions — so every stage starts pending with a
   new id and no attribution. */
function taskFromTemplate(tp){
  const timed = tp.timed === true && Number(tp.limitMinutes) > 0;
  return {
    id: uid("t"), title: tp.title, description: tp.description,
    createdBy: me(), createdAt: nowIso(),
    status: "pending", statusBy: null, statusAt: null, statusNote: null,
    // Carried here rather than at the call sites, so Add to board and Add all
    // both pick it up.
    leaderboard: tp.leaderboard === true,
    /* The limit is part of the blueprint; the clock is not. Every re-add starts
       unstarted, which is what makes a saved timed task reusable. */
    timed, limitMinutes: timed ? Math.floor(Number(tp.limitMinutes)) : null,
    startedAt: null, startedBy: null, failedAt: null,
    stages: timed ? [] : (tp.stages || []).map(s => ({
      id: uid("s"), title: s.title, description: s.description || "",
      status: "pending", by: null, at: null, note: null
    }))
  };
}

async function addTemplateToBoard(id){
  const tp = (state.data.templates || []).find(t => t.id === id);
  if(!tp) return;

  await commit(`Add task "${tp.title}"`, data => {
    const t = (data.templates || []).find(x => x.id === id);
    if(!t) return null;                       // deleted underneath us
    data.tasks.push(taskFromTemplate(t));
    return { action:"task.add", subject: t.title };
  });

  render();
  renderAdmin();
  flash("Added to board");
}

async function addAllTemplates(){
  const tpls = state.data.templates || [];
  if(!tpls.length){ toast("Nothing saved to add.", ""); return; }

  const ok = await askConfirm({
    title: `Add all ${tpls.length} saved task${tpls.length === 1 ? "" : "s"}?`,
    text : "Each is added to the board as a new pending task. Duplicates of tasks already on the board are allowed.",
    yes  : "Add all"
  });
  if(!ok) return;

  // One commit for the whole batch, not one per task — reads from fresh data
  // so a 409 replay re-adds against the current board correctly.
  const done = await commit(`Add ${tpls.length} saved tasks`, data => {
    const entries = [];
    (data.templates || []).forEach(tp => {
      data.tasks.push(taskFromTemplate(tp));
      entries.push({ action:"task.add", subject: tp.title });
    });
    return entries;
  });

  if(done){
    render();
    renderAdmin();
    flash("Added all to board");
  }
}

async function deleteTemplate(id){
  const tp = (state.data.templates || []).find(t => t.id === id);
  if(!tp) return;

  await commit(`Remove saved task "${tp.title}"`, data => {
    const before = (data.templates || []).length;
    data.templates = (data.templates || []).filter(t => t.id !== id);
    if(data.templates.length === before) return null;
    return { action:"template.delete", subject: tp.title };
  });
  renderAdmin();
}

/* ──────────────────────────── leaderboard ──────────────────────────────── */

/* Credit is carried in task-equivalents, so three thirds can land on
   1.0000000000000002. Round the float noise off, then trim so a whole number
   reads "3" rather than "3.00". */
function fmtCredit(n){
  const r = Math.round(n * 1e6) / 1e6;
  return r.toFixed(2).replace(/\.?0+$/, "");
}

/* Largest-remainder apportionment. Rounding each share on its own gives columns
   that total 99 or 101, which looks like a bug in a number whose whole claim is
   "share of the team" — so the leftover points go to the biggest remainders.
   Ties break by position, which keeps it stable between renders. */
function apportion(values, total){
  if(!total) return values.map(() => 0);
  const exact = values.map(v => (v / total) * 100);
  const out   = exact.map(Math.floor);
  const left  = 100 - out.reduce((a, b) => a + b, 0);
  exact.map((e, i) => [e - Math.floor(e), i])
       .sort((a, b) => b[0] - a[0] || a[1] - b[1])
       .slice(0, Math.max(0, left))
       .forEach(([, i]) => out[i]++);
  return out;
}

/* Everyone who earned credit in the window, best first. */
function leaderboardRows(windowKey){
  const from = windowStart(windowKey);
  const events = (state.data.scores || []).filter(s => {
    if(from == null) return true;
    const t = Date.parse(s.at);
    return !Number.isNaN(t) && t >= from;
  });

  const by = new Map();                 // name -> { name, credit, events, lastAt }
  events.forEach(s => {
    const row = by.get(s.who) || { name: s.who, credit: 0, events: 0, lastAt: null };
    row.credit += s.value;
    row.events += 1;
    if(!row.lastAt || Date.parse(s.at) > Date.parse(row.lastAt)) row.lastAt = s.at;
    by.set(s.who, row);
  });

  const rows  = [...by.values()].sort((a, b) => b.credit - a.credit || a.name.localeCompare(b.name));
  const total = rows.reduce((n, r) => n + r.credit, 0);
  const pcts  = apportion(rows.map(r => r.credit), total);
  rows.forEach((r, i) => {
    r.pct   = pcts[i];                          // the claim — sums to exactly 100
    r.share = total ? (r.credit / total) * 100 : 0;   // the picture — unrounded
  });
  return { rows, total, events: events.length };
}

const LB_WINDOW_LABEL = { wtd:"this week", mtd:"this month", qtd:"this quarter", all:"all time" };

function renderLeaderboard(){
  const key = $("lbWindow").value || "wtd";
  const { rows, total, events } = leaderboardRows(key);

  $("lbCount").textContent     = rows.length;
  $("lbRailCount").textContent = rows.length;

  const box = $("lbList");
  if(!rows.length){
    const any = (state.data.tasks || []).some(t => t.leaderboard);
    box.innerHTML = `<div class="adm-empty">${
      any
        ? `No leaderboard completions ${escHtml(LB_WINDOW_LABEL[key] || "yet")}.`
        : `No leaderboard tasks yet. Tick <strong>Leaderboard task</strong> in <strong>Tasks</strong> to start scoring.`
    }</div>`;
    $("lbFoot").textContent = "";
    return;
  }

  box.innerHTML = rows.map((r, i) => `
<div class="audit-row lb-row">
  <span class="aw">${i + 1}</span>
  <span class="ax">
    <div class="lb-name">${escHtml(r.name)}</div>
    <div class="lb-bar"><i style="width:${r.share.toFixed(2)}%"></i></div>
    <span class="lb-sub">${fmtCredit(r.credit)} task${r.credit === 1 ? "" : "s"} · ${r.events} completion${r.events === 1 ? "" : "s"} · last ${escHtml(relTime(r.lastAt))}</span>
  </span>
  <span class="at lb-pct">${r.pct}%</span>
  <button class="mini red" data-lbdel="${escHtml(r.name)}">Remove</button>
</div>`).join("");

  $("lbFoot").textContent =
    `${fmtCredit(total)} task${total === 1 ? "" : "s"} completed ${LB_WINDOW_LABEL[key] || ""} across ${events} completion${events === 1 ? "" : "s"}.`;
}

async function removeFromLeaderboard(name){
  const mine = (state.data.scores || []).filter(s => s.who === name);
  if(!mine.length) return;

  const ok = await askConfirm({
    title: `Remove ${name} from the leaderboard?`,
    text : "Their completions are deleted and everyone else's percentage recalculates. They reappear if they complete another leaderboard task. Tasks and the audit log are untouched.",
    facts: [["Completions", String(mine.length)],
            ["Credit", `${fmtCredit(mine.reduce((n, s) => n + s.value, 0))} tasks`]],
    yes  : "Remove", danger: true
  });
  if(!ok) return;

  await commit(`Remove ${name} from the leaderboard`, data => {
    // Counted from fresh data so a replay reports what it actually removed.
    const before = (data.scores || []).length;
    data.scores = (data.scores || []).filter(s => s.who !== name);
    const gone = before - data.scores.length;
    if(!gone) return null;
    return { action:"leaderboard.remove", subject: name, detail: `${gone} completions removed` };
  });
  renderAdmin();
  flash("Removed");
}

async function resetLeaderboard(){
  const count = (state.data.scores || []).length;
  if(!count){ toast("The leaderboard is already empty.", ""); return; }

  const ok = await askConfirm({
    title: "Reset the leaderboard?",
    text : "Every recorded completion is deleted for everyone, including past quarters. Tasks, plates and the audit log are untouched. This cannot be undone.",
    facts: [["Completions", String(count)]],
    yes  : "Reset", danger: true
  });
  if(!ok) return;

  await commit("Reset the leaderboard", data => {
    const gone = (data.scores || []).length;
    if(!gone) return null;
    data.scores = [];
    return { action:"leaderboard.reset", subject: "", detail: `${gone} completions removed` };
  });
  renderAdmin();
  flash("Leaderboard reset");
}

/* ─────────────────────────────── people ────────────────────────────────── */

/* There are no sessions to enumerate — no server, no logins. The honest
   equivalent is everyone the board has heard from, newest first. */
function knownPeople(){
  const seen = new Map();      // name -> { name, lastAt, actions }
  const note = (name, at) => {
    if(!name) return;
    const e = seen.get(name) || { name, lastAt: null, actions: 0 };
    e.actions++;
    if(at && (!e.lastAt || Date.parse(at) > Date.parse(e.lastAt))) e.lastAt = at;
    seen.set(name, e);
  };

  state.data.audit.forEach(a => note(a.who, a.at));
  state.data.plates.forEach(p => note(p.checkedOutBy, p.checkedOutAt));
  // Scores outlive the audit cap, so without this someone could top the
  // leaderboard while having vanished from this list entirely.
  (state.data.scores || []).forEach(s => note(s.who, s.at));
  const mine = me();
  if(mine && !seen.has(mine)) seen.set(mine, { name: mine, lastAt: null, actions: 0 });

  return [...seen.values()].sort((a, b) => {
    if(!a.lastAt) return 1;
    if(!b.lastAt) return -1;
    return Date.parse(b.lastAt) - Date.parse(a.lastAt);
  });
}

function renderAdminPeople(){
  const people = knownPeople();
  const blocked = state.data.blocked || [];
  $("peopleCount").textContent = people.length;

  const dot = $("peopleDot");
  dot.hidden = blocked.length === 0;

  // Keep the force-assign controls in step with who exists.
  $("knownPeople").innerHTML = people.map(p => `<option value="${escHtml(p.name)}">`).join("");
  const sel = $("forcePlate");
  const keep = sel.value;
  sel.innerHTML = state.data.plates.length
    ? state.data.plates.map(p =>
        `<option value="${escHtml(p.id)}">${escHtml(p.label)}${p.forcedBy ? " — locked" : p.checkedOutBy ? ` — with ${escHtml(p.checkedOutBy)}` : ""}</option>`).join("")
    : `<option value="">No plates yet</option>`;
  if([...sel.options].some(o => o.value === keep)) sel.value = keep;

  const box = $("admPeople");
  if(!people.length){
    box.innerHTML = `<div class="adm-empty">Nobody has used the board yet.</div>`;
    return;
  }

  box.innerHTML = people.map(p => {
    const isBlocked = blocked.includes(p.name);
    const plate = state.data.plates.find(x => x.checkedOutBy === p.name);
    const isMe  = p.name === me();
    const sub = [
      p.lastAt ? `Last active ${relTime(p.lastAt)}` : "No activity yet",
      plate ? `holding ${plate.label}${plate.forcedBy ? " (locked)" : ""}` : null,
      `${p.actions} action${p.actions === 1 ? "" : "s"}`
    ].filter(Boolean).join(" · ");

    return `
<div class="adm-row">
  <div class="am">
    <div class="adm-t">${escHtml(p.name)}${isMe ? ' <span class="pill info">You</span>' : ""}</div>
    <div class="adm-s">${escHtml(sub)}</div>
  </div>
  ${isBlocked ? '<span class="pill bad">Blocked</span>' : ""}
  <button class="mini" data-rename="${escHtml(p.name)}" title="Edit display name">${svg(ICON.pencil)}</button>
  <button class="mini ${isBlocked ? "" : "red"}"
          data-block="${escHtml(p.name)}"
          data-action="${isBlocked ? "unblock" : "block"}">${isBlocked ? "Restore" : "Block"}</button>
</div>`;
  }).join("");
}

async function setBlocked(name, block){
  if(block){
    const ok = await askConfirm({
      title: `Block ${name}?`,
      text : "The board goes read-only for anyone using that name, and any plate they hold is released. They could rename themselves and carry on — the team code is shared — so this is a firm request rather than a lock.",
      facts: [["Name", name]],
      yes  : "Block", danger: true
    });
    if(!ok) return;
  }

  await commit(block ? `Block ${name}` : `Restore ${name}`, data => {
    data.blocked = data.blocked || [];
    const entries = [];

    if(block){
      if(!data.blocked.includes(name)) data.blocked.push(name);
      // Don't leave a blocked person holding a plate nobody can reclaim.
      data.plates.forEach(p => {
        if(p.checkedOutBy === name){
          p.checkedOutBy = null; p.checkedOutAt = null; p.forcedBy = null; p.forcedAt = null;
          entries.push({ action:"plate.force", subject: p.label, detail:`released from ${name}` });
        }
      });
      entries.push({ action:"person.block", subject: name });
    }else{
      data.blocked = data.blocked.filter(n => n !== name);
      entries.push({ action:"person.unblock", subject: name });
    }
    return entries;
  });

  render();
  renderAdmin();
  flash(block ? "Blocked" : "Restored");
}

/* ───────────────────────────── force assign ────────────────────────────── */

async function forceAssignPlate(){
  const plateId = $("forcePlate").value;
  const who     = $("forceWho").value.trim();

  if(!plateId){ toast("Add a plate first.", "bad"); return; }
  if(!who){ toast("Who should it go to?", "bad"); $("forceWho").focus(); return; }

  const plate = state.data.plates.find(p => p.id === plateId);
  if(!plate) return;

  if((state.data.blocked || []).includes(who)){
    toast(`${who} is blocked. Restore them first.`, "bad");
    return;
  }

  const facts = [["Plate", plate.label], ["Assign to", who]];
  if(plate.checkedOutBy && plate.checkedOutBy !== who) facts.push(["Taking from", plate.checkedOutBy]);

  const ok = await askConfirm({
    title: "Lock this plate?",
    text : `${who} won't be able to hand it back — only an admin can unlock it. They'll see a message saying it was assigned by an admin.`,
    facts, yes: "Assign and lock"
  });
  if(!ok) return;

  const admin = me();
  const done = await commit(`Force assign ${plate.label} to ${who}`, data => {
    const p = data.plates.find(x => x.id === plateId);
    if(!p) throw new Error("That plate no longer exists.");
    const from = p.checkedOutBy;
    p.checkedOutBy = who;
    p.checkedOutAt = nowIso();
    p.forcedBy = admin || "an admin";
    p.forcedAt = nowIso();
    return {
      action : "plate.assign",
      subject: p.label,
      detail : from && from !== who ? `to ${who}, taken from ${from}` : `to ${who}`
    };
  });

  if(done){
    $("forceWho").value = "";
    render();
    renderAdmin();
    flash("Assigned");
  }
}

async function unlockPlate(plateId){
  const plate = state.data.plates.find(p => p.id === plateId);
  if(!plate || !plate.forcedBy) return;

  const ok = await askConfirm({
    title: "Unlock this plate?",
    text : `${plate.checkedOutBy} will be able to release it themselves again. It stays checked out to them.`,
    facts: [["Plate", plate.label], ["Locked to", plate.checkedOutBy || "—"], ["Locked by", plate.forcedBy]],
    yes  : "Unlock"
  });
  if(!ok) return;

  await commit(`Unlock ${plate.label}`, data => {
    const p = data.plates.find(x => x.id === plateId);
    if(!p) return null;
    p.forcedBy = null; p.forcedAt = null;
    return { action:"plate.unlock", subject: p.label };
  });
  render();
  renderAdmin();
  flash("Unlocked");
}

/* ───────────────────────────── connection ──────────────────────────────── */

let codeRevealed = false;

function renderConnection(){
  const t = token();
  const configured = repoConfigured();

  $("repoLine").innerHTML = configured
    ? `Board data lives in <strong>${escHtml(REPO.owner)}/${escHtml(REPO.name)}</strong> → ` +
      `<strong>${escHtml(REPO.path)}</strong> on <strong>${escHtml(REPO.branch)}</strong>.`
    : `No repository configured. Edit <strong>config.js</strong> and set <strong>REPO.owner</strong> ` +
      `to share this board with your team.`;

  // Rail dot: green when this device can write, red when it can't.
  const dot = $("connDot");
  dot.className = "warn" + (state.mode === "member" ? " ok" : "");

  $("connActive").hidden = !t;
  $("connSetup").hidden  = !!t;

  if(t){
    $("connUser").textContent = state.user ? `Connected as ${state.user}` : "Connected";
    const field = $("connMask");
    field.type  = codeRevealed ? "text" : "password";
    field.value = codeRevealed ? t : maskToken(t);
    $("connReveal").textContent = codeRevealed ? "Hide" : "Reveal";
  }else{
    $("connInput").value = "";
    // Back behind the Scan / Enter manually pair, but only where a camera
    // makes that a real choice — otherwise the field is the only way in.
    $("connInput").hidden = cameraPossible();
    $("connScanned").hidden = true;
    $("connErr").hidden = true;
    codeRevealed = false;
  }
}

async function saveConnection(){
  const input = $("connInput");
  const err   = $("connErr");
  const btn   = $("connSave");

  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "Connecting…";

  const result = await connectTeamCode(input.value);

  btn.disabled = false;
  btn.textContent = "Connect";

  if(!result.ok){
    err.textContent = result.error;
    err.hidden = false;
    input.focus();
    renderConnection();
    return;
  }

  codeRevealed = false;
  renderAdmin();
  flash("Connected");
  toast(`Connected as ${result.login}. Share the team code so others can edit.`, "good");
}

async function copyTeamCode(){
  const t = token();
  if(!t) return;
  try{
    await navigator.clipboard.writeText(t);
    flash("Copied");
    toast("Team code copied. Send it to your team — treat it like a door code.", "");
  }catch(e){
    // Clipboard API needs a secure context and permission; reveal instead so
    // the value can at least be selected by hand.
    codeRevealed = true;
    renderConnection();
    $("connMask").select();
    toast("Couldn't copy automatically — the code is shown, copy it manually.", "bad");
  }
}

/* Probe each layer separately. A 403 on write has four distinct causes and
   the failing request alone can't distinguish them, so check identity, repo
   visibility, read access, and write access as separate steps. */
async function testConnection(){
  const box = $("connDiag");
  const btn = $("connTest");
  const rows = [];

  const ICONS = {
    ok  : '<path d="M20 6 9 17l-5-5"/>',
    bad : '<path d="M18 6 6 18M6 6l12 12"/>',
    wait: '<circle cx="12" cy="12" r="9"/>'
  };
  const draw = () => {
    box.hidden = false;
    box.innerHTML = rows.map(r =>
      `<div class="diag-row ${r.state}">${svg(ICONS[r.state], "diag-ic")}<span>${escHtml(r.text)}` +
      `${r.fix ? `<span class="diag-fix">${r.fix}</span>` : ""}</span></div>`).join("");
  };
  const step = text => { const r = { state:"wait", text }; rows.push(r); draw(); return r; };

  btn.disabled = true;
  btn.textContent = "Testing…";
  box.innerHTML = "";

  // 1 — is the code itself accepted?
  const s1 = step("Checking the code…");
  let login = null;
  try{
    const u = await (await gh("https://api.github.com/user")).json();
    login = u.login;
    s1.state = "ok"; s1.text = `Code accepted — signed in as ${login}`;
  }catch(e){
    s1.state = "bad";
    s1.text = "Code rejected by GitHub";
    s1.fix  = "It may have expired or been copied incompletely. Generate a new one.";
    draw(); btn.disabled = false; btn.textContent = "Test connection"; return;
  }
  draw();

  // 2 — can the token see this specific repository?
  const s2 = step("Looking for the repository…");
  let repo = null;
  try{
    repo = await (await gh(`https://api.github.com/repos/${REPO.owner}/${REPO.name}`)).json();
    s2.state = "ok";
    s2.text  = `Repository found: ${repo.full_name} (${repo.private ? "private" : "public"})`;
  }catch(e){
    s2.state = "bad";
    s2.text  = `Can't see ${REPO.owner}/${REPO.name}`;
    s2.fix   = "On the token page, Repository access must be <strong>Only select repositories</strong> " +
               "with this repo ticked. <strong>Public repositories (read-only)</strong> — often the default — cannot write.";
    draw(); btn.disabled = false; btn.textContent = "Test connection"; return;
  }
  draw();

  // 3 — does the ACCOUNT have push rights, separately from the token?
  if(repo.permissions){
    const s3 = step("Checking account access…");
    if(repo.permissions.push){
      s3.state = "ok"; s3.text = `${login} has write access to the repository`;
    }else{
      s3.state = "bad";
      s3.text  = `${login} has no write access to this repository`;
      s3.fix   = "Ask the repo owner to add you under Settings → Collaborators. " +
                 "No token can grant more than the account behind it.";
    }
    draw();
  }

  // 4 — can it read the data file?
  const s4 = step("Reading data.json…");
  let sha = null;
  try{
    const r = await pull();
    sha = r.sha;
    s4.state = "ok"; s4.text = "data.json is readable";
  }catch(e){
    s4.state = "bad";
    s4.text  = "Can't read data.json";
    s4.fix   = escHtml(explainError(e, "read"));
    draw(); btn.disabled = false; btn.textContent = "Test connection"; return;
  }
  draw();

  // 5 — the real question. Rewriting the file byte-for-byte proves write
  //     access without altering anything; it does create one commit.
  const s5 = step("Testing write access…");
  try{
    const fresh = await pull();
    await putFile(fresh.data, fresh.sha, `Connection test — ${me() || "unknown"}`);
    state.lastError = null;
    s5.state = "ok";
    s5.text  = "Write access confirmed — you can change the board";
    s5.fix   = "This left one no-op commit in the repository history.";
    await refresh({ quiet:true });
  }catch(e){
    s5.state = "bad";
    if(e.status === 403){
      s5.text = "Write refused";
      s5.fix  = `GitHub said: “${escHtml(e.message || "no detail")}”.<br>` +
                "On the token page, under <strong>Permissions → Repository permissions</strong>, " +
                "set <strong>Contents</strong> to <strong>Read and write</strong>. " +
                "Read-only is the default and is not enough.";
    }else{
      s5.text = "Write failed";
      s5.fix  = escHtml(explainError(e, "write"));
    }
  }
  draw();

  btn.disabled = false;
  btn.textContent = "Test connection";
  renderChrome();
}

async function disconnectConnection(){
  const ok = await askConfirm({
    title: "Remove the team code from this device?",
    text : "You'll still see the board, but you won't be able to change anything until you enter it again. Other people's devices are unaffected.",
    yes  : "Remove", danger: true
  });
  if(!ok) return;

  setToken(null);
  state.user = null;
  state.mode = repoConfigured() ? "viewer" : "local";
  codeRevealed = false;
  startPolling();
  render();
  renderAdmin();
  toast("Team code removed from this device.", "");
}

function renderRailFoot(){
  $("railFoot").textContent =
    state.mode === "member" ? `Saving to ${REPO.owner}/${REPO.name}`
    : state.mode === "viewer" ? "Read-only — connect a token to save changes"
    : "Local mode — changes stay in this browser";
}

function renderAdminTasks(){
  const box = $("admTasks");
  const tasks = state.data.tasks;
  $("taskCount").textContent = tasks.length;

  if(!tasks.length){
    box.innerHTML = `<div class="adm-empty">No tasks yet. Add the first one above.</div>`;
    return;
  }

  box.innerHTML = tasks.map((t, i) => {
    // Effective, so a timer that ran out reads Failed here too rather than
    // still showing In progress until a write lands.
    const eff = effectiveStatus(t);
    const st = STATUS[eff];
    // Mirror the board: a staged task in flight says where it is, not "Pending".
    const staged = hasStages(t);
    const label  = staged && t.status === "pending" ? stageLabel(t) : st.label;
    const sub = t.statusBy
      ? `${label} · ${escHtml(t.statusBy)} · ${escHtml(relTime(t.statusAt))}`
      : (t.description ? escHtml(t.description) : "No description");
    return `
<div class="adm-row">
  <div class="adm-ord">
    <button data-move="up" data-id="${t.id}" ${i === 0 ? "disabled" : ""} title="Move up">${svg(ICON.up)}</button>
    <button data-move="down" data-id="${t.id}" ${i === tasks.length - 1 ? "disabled" : ""} title="Move down">${svg(ICON.down)}</button>
  </div>
  <div class="am">
    <div class="adm-t">${escHtml(t.title)}</div>
    <div class="adm-s">${sub}</div>
  </div>
  ${t.leaderboard ? `<span class="pill ok" title="Completing this scores on the leaderboard">Leaderboard</span>` : ""}
  ${isTimed(t) ? `<span class="pill info" title="Fails and locks if not completed inside the limit">${t.limitMinutes}m</span>` : ""}
  <span class="pill ${staged && t.status === "pending" ? "info" : st.pill}">${escHtml(label)}</span>
  <button class="mini red" data-deltask="${t.id}">Delete</button>
</div>`;
  }).join("");
}

function renderAdminPlates(){
  const box = $("admPlates");
  const plates = state.data.plates;
  $("plateCount").textContent = plates.length;

  if(!plates.length){
    box.innerHTML = `<div class="adm-empty">No plates yet. Add one above to populate the Select Plate menu.</div>`;
    return;
  }

  box.innerHTML = plates.map(p => {
    const out    = !!p.checkedOutBy;
    const locked = !!p.forcedBy;
    const sub = locked
      ? `Locked to ${escHtml(p.checkedOutBy)} by ${escHtml(p.forcedBy)} · ${escHtml(relTime(p.forcedAt))}`
      : out
        ? `Checked out by ${escHtml(p.checkedOutBy)} · ${escHtml(relTime(p.checkedOutAt))}`
        : (p.note ? escHtml(p.note) : "Available");
    return `
<div class="adm-row">
  <div class="am">
    <div class="adm-t">${escHtml(p.label)}</div>
    <div class="adm-s">${sub}</div>
  </div>
  <span class="pill ${locked ? "bad" : out ? "warm" : "idle"}">${locked ? "Locked" : out ? "Out" : "Free"}</span>
  ${locked ? `<button class="mini" data-unlockplate="${p.id}">Unlock</button>` : ""}
  ${out && !locked ? `<button class="mini" data-freeplate="${p.id}">Force release</button>` : ""}
  <button class="mini red" data-delplate="${p.id}">Delete</button>
</div>`;
  }).join("");
}

function renderAdminAudit(){
  const rows = state.data.audit;
  $("auditCount").textContent = rows.length;

  // Keep the filter dropdowns in step with what's actually in the log
  const whoSel = $("auditWho"), actSel = $("auditAct");
  const people  = [...new Set(rows.map(r => r.who))].sort();
  const actions = [...new Set(rows.map(r => r.action))].sort();

  const repopulate = (sel, values, allLabel) => {
    const current = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      values.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join("");
    if(values.includes(current)) sel.value = current;
  };
  repopulate(whoSel, people, "Everyone");
  repopulate(actSel, actions, "All actions");

  const filtered = rows.filter(r =>
    (!whoSel.value || r.who === whoSel.value) &&
    (!actSel.value || r.action === actSel.value));

  const box = $("auditList");
  if(!filtered.length){
    box.innerHTML = `<div class="adm-empty">${rows.length ? "Nothing matches that filter." : "No activity recorded yet."}</div>`;
    return;
  }

  box.innerHTML = filtered.slice(0, 250).map(r => `
<div class="audit-row">
  <span class="aw">${escHtml(r.who)}</span>
  <span class="ax">${escHtml(auditPhrase(r))}
    ${r.detail && !DETAIL_IN_PHRASE.has(r.action) ? `<span class="ad">“${escHtml(r.detail)}”</span>` : ""}
  </span>
  <span class="at" title="${escHtml(fullTime(r.at))}">${escHtml(relTime(r.at))}</span>
</div>`).join("");
}

/* Actions whose phrase already reads their own detail. The row appends detail
   in quotes after the phrase, which is right for a note someone typed and
   wrong for a duration the sentence is built around — "took 8m 30s to complete
   X “8m 30s”". */
const DETAIL_IN_PHRASE = new Set(["task.timedComplete", "task.timeout"]);

function auditPhrase(r){
  const s = r.subject;
  switch(r.action){
    case "task.complete":  return `completed “${s}”`;
    // A stage landing that didn't finish the whole task. The stage number is
    // carried in the subject, so this reads "completed X · stage 2 of 3".
    case "task.stage":     return `completed “${s}”`;
    case "task.partial":   return `partially completed “${s}”`;
    case "task.blocked":   return `could not complete “${s}”`;
    case "task.pending":   return `reopened “${s}”`;
    /* Timed tasks. The detail carries the duration, so the row reads
       "Bob · took 8m 30s of 10 minutes to complete X" — and a timeout reads
       "Bob failed X", attributed to whoever started the clock rather than to
       whichever browser noticed it run out. */
    case "task.start":     return `started “${s}”`;
    case "task.timedComplete": return `took ${r.detail || "—"} to complete “${s}”`;
    case "task.timeout":   return `failed “${s}” — ${r.detail || "ran out of time"}`;
    case "task.add":       return `added task “${s}”`;
    case "template.save":  return `saved “${s}” to Quick add`;
    case "template.edit":  return `edited saved task “${s}”`;
    case "template.delete":return `removed “${s}” from Quick add`;
    case "leaderboard.remove": return `removed ${s} from the leaderboard`;
    case "leaderboard.reset":  return `reset the leaderboard`;
    case "task.delete":    return `deleted task “${s}”`;
    case "task.move":      return `reordered “${s}”`;
    case "plate.checkout": return `checked out plate ${s}`;
    case "plate.release":  return `released plate ${s}`;
    case "plate.add":      return `added plate ${s}`;
    case "plate.delete":   return `deleted plate ${s}`;
    case "plate.force":    return `force-released plate ${s}`;
    case "plate.assign":   return `force-assigned plate ${s}`;
    case "plate.unlock":   return `unlocked plate ${s}`;
    case "person.block":   return `blocked ${s} from editing`;
    case "person.unblock": return `restored edit access for ${s}`;
    case "person.rename":  return `renamed a teammate to “${s}”`;
    case "request.open":   return `requested the name “${s}”`;
    case "request.cancel": return `withdrew a name-change request`;
    case "request.approve":return `approved a name change to “${s}”`;
    case "request.reject": return `rejected a name-change request`;
    case "reopen.request": return `requested a reopen of “${s}”`;
    case "reopen.approve": return `approved a reopen of “${s}”`;
    case "reopen.reject":  return `rejected a reopen of “${s}”`;
    case "board.reset":    return `reset the board`;
    case "audit.clear":    return `cleared the audit log`;
    case "board.wipe":     return `deleted all tasks and plates`;
    case "identity.rename":return `changed their display name`;
    default:               return `${r.action}${s ? " " + s : ""}`;
  }
}

/* ──────────────────────────────── tasks ────────────────────────────────── */

async function addTask(){
  const titleEl = $("taskTitle"), descEl = $("taskDesc");
  const title = titleEl.value.trim();
  const desc  = descEl.value.trim();
  const mins  = readTimerMinutes();
  const timed = mins !== null;
  const stages = timed ? [] : stagesToSave(title, desc);

  if(!title){ toast("Give the task a title.", "bad"); titleEl.focus(); return; }
  if(Number.isNaN(mins)){
    toast("A timed task needs a limit of at least 1 minute.", "bad");
    $("taskTimerMins").focus();
    return;
  }
  if(state.data.tasks.some(t => t.title.toLowerCase() === title.toLowerCase())){
    const ok = await askConfirm({
      title: "Duplicate title",
      text : `There's already a task called “${title}”. Add another anyway?`,
      yes  : "Add it"
    });
    if(!ok) return;
  }

  const leaderboard = $("taskLb").checked;
  const id = uid("t");
  const ok = await commit(`Add task "${title}"`, data => {
    data.tasks.push({
      id, title, description: desc,
      createdBy: me(), createdAt: nowIso(),
      status: "pending", statusBy: null, statusAt: null, statusNote: null,
      leaderboard,
      // Added unstarted — the clock begins when someone presses Start.
      timed, limitMinutes: mins, startedAt: null, startedBy: null, failedAt: null,
      stages: stages.map(s => ({
        id: uid("s"), title: s.title, description: s.description,
        status: "pending", by: null, at: null, note: null
      }))
    });
    return {
      action : "task.add",
      subject: title,
      detail : timed ? `${mins} minute limit` : (stages.length ? `${stages.length} stages` : "")
    };
  });

  if(ok){
    clearTaskForm();
    titleEl.focus();
    flash(timed ? `Timed task added — ${mins} minute limit`
                : stages.length ? `Task added with ${stages.length} stages` : "Task added");
    renderAdmin();
  }
}

async function deleteTask(id){
  const task = state.data.tasks.find(t => t.id === id);
  if(!task) return;

  const ok = await askConfirm({
    title: "Delete this task?",
    text : "It disappears from everyone's board. The audit log keeps the record of what happened to it.",
    facts: [["Task", task.title], ["Status", STATUS[task.status].label]],
    yes  : "Delete", danger: true
  });
  if(!ok) return;

  await commit(`Delete task "${task.title}"`, data => {
    const i = data.tasks.findIndex(t => t.id === id);
    if(i === -1) return null;
    const [removed] = data.tasks.splice(i, 1);
    return { action:"task.delete", subject: removed.title };
  });
  renderAdmin();
}

async function moveTask(id, dir){
  await commit("Reorder tasks", data => {
    const i = data.tasks.findIndex(t => t.id === id);
    if(i === -1) return null;
    const j = dir === "up" ? i - 1 : i + 1;
    if(j < 0 || j >= data.tasks.length) return null;
    [data.tasks[i], data.tasks[j]] = [data.tasks[j], data.tasks[i]];
    return null;                       // reordering isn't worth an audit entry
  });
  renderAdmin();
}

/* ──────────────────────────────── plates ───────────────────────────────── */

async function addPlate(){
  const labelEl = $("plateLabel"), noteEl = $("plateNote");
  const label = labelEl.value.trim().toUpperCase();
  const note  = noteEl.value.trim();

  if(!label){ toast("Enter a plate.", "bad"); labelEl.focus(); return; }
  if(state.data.plates.some(p => p.label.toUpperCase() === label)){
    toast(`${label} is already in the list.`, "bad");
    labelEl.focus();
    return;
  }

  const id = uid("p");
  const ok = await commit(`Add plate ${label}`, data => {
    data.plates.push({ id, label, note, checkedOutBy: null, checkedOutAt: null });
    return { action:"plate.add", subject: label };
  });

  if(ok){
    labelEl.value = ""; noteEl.value = "";
    labelEl.focus();
    flash("Plate added");
    renderAdmin();
  }
}

async function deletePlate(id){
  const plate = state.data.plates.find(p => p.id === id);
  if(!plate) return;

  const facts = [["Plate", plate.label]];
  if(plate.checkedOutBy) facts.push(["Currently with", plate.checkedOutBy]);

  const ok = await askConfirm({
    title: "Delete this plate?",
    text : plate.checkedOutBy
      ? "It's checked out right now. Deleting it will release it from that person."
      : "It disappears from the Select Plate menu for everyone.",
    facts, yes: "Delete", danger: true
  });
  if(!ok) return;

  await commit(`Delete plate ${plate.label}`, data => {
    const i = data.plates.findIndex(p => p.id === id);
    if(i === -1) return null;
    const [removed] = data.plates.splice(i, 1);
    return { action:"plate.delete", subject: removed.label };
  });
  renderAdmin();
}

async function forceReleasePlate(id){
  const plate = state.data.plates.find(p => p.id === id);
  if(!plate || !plate.checkedOutBy) return;

  const ok = await askConfirm({
    title: "Force release?",
    text : "Use this when someone has finished but forgot to release the plate.",
    facts: [["Plate", plate.label], ["Checked out by", plate.checkedOutBy], ["Since", relTime(plate.checkedOutAt)]],
    yes  : "Release"
  });
  if(!ok) return;

  await commit(`Force release ${plate.label}`, data => {
    const p = data.plates.find(x => x.id === id);
    if(!p || !p.checkedOutBy) return null;
    const was = p.checkedOutBy;
    p.checkedOutBy = null;
    p.checkedOutAt = null;
    return { action:"plate.force", subject: p.label, detail:`was ${was}` };
  });
  renderAdmin();
}

/* ────────────────────────────── destructive ────────────────────────────── */

async function resetBoard(){
  const total = state.data.tasks.length;
  const done  = doneCount();
  const out   = state.data.plates.filter(p => p.checkedOutBy).length;

  if(!total && !out){ toast("Nothing to reset.", ""); return; }

  const first = await askConfirm({
    title: "Reset the board?",
    text : "Every task goes back to Pending and every plate is released. Tasks, plates, the audit log and the leaderboard are kept — completing a task again next round scores again.",
    facts: [["Tasks to reset", `${done} of ${total}`], ["Plates to release", String(out)]],
    yes  : "Continue", danger: true
  });
  if(!first) return;

  const second = await askConfirm({
    title: "Really reset?",
    text : "This affects everyone's board immediately and cannot be undone.",
    yes  : "Reset board", danger: true
  });
  if(!second) return;

  const ok = await commit("Reset board", data => {
    let cleared = 0, released = 0;
    data.tasks.forEach(t => {
      if(t.status !== "pending" || (t.stages || []).some(s => s.status !== "pending")) cleared++;
      t.status = "pending"; t.statusBy = null; t.statusAt = null; t.statusNote = null;
      resetStages(t);
    });
    data.plates.forEach(p => {
      if(p.checkedOutBy) released++;
      p.checkedOutBy = null; p.checkedOutAt = null;
    });
    return { action:"board.reset", subject:"", detail:`${cleared} tasks cleared, ${released} plates released` };
  });

  if(ok){
    state.openTaskId = null;
    state.filter = "all";
    render();
    flash("Board reset");
    toast("Board reset. Everyone starts fresh.", "good");
  }
}

async function clearAuditLog(){
  if(!state.data.audit.length){ toast("The log is already empty.", ""); return; }

  const ok = await askConfirm({
    title: "Clear the audit log?",
    text : "The full history of who did what is erased permanently. Task statuses are untouched.",
    facts: [["Entries", String(state.data.audit.length)]],
    yes  : "Clear log", danger: true
  });
  if(!ok) return;

  const count = state.data.audit.length;
  await commit("Clear audit log", data => {
    data.audit = [];
    return { action:"audit.clear", subject:"", detail:`${count} entries removed` };
  });
  renderAdmin();
  flash("Log cleared");
}

async function wipeEverything(){
  const t = state.data.tasks.length, p = state.data.plates.length;
  if(!t && !p){ toast("Nothing to delete.", ""); return; }

  const first = await askConfirm({
    title: "Delete all tasks and plates?",
    text : "The board is emptied completely. The audit log and the leaderboard are kept as the record.",
    facts: [["Tasks", String(t)], ["Plates", String(p)]],
    yes  : "Continue", danger: true
  });
  if(!first) return;

  const second = await askConfirm({
    title: "This cannot be undone",
    text : "Everyone's board will be empty. Are you certain?",
    yes  : "Delete everything", danger: true
  });
  if(!second) return;

  const ok = await commit("Delete all tasks and plates", data => {
    data.tasks = [];
    data.plates = [];
    return { action:"board.wipe", subject:"", detail:`${t} tasks, ${p} plates` };
  });

  if(ok){
    state.openTaskId = null;
    state.filter = "all";
    render();
    renderAdmin();
    flash("Board emptied");
  }
}

/* ──────────────────────────────── export ───────────────────────────────── */

function exportAuditCsv(){
  const rows = state.data.audit;
  if(!rows.length){ toast("Nothing to export yet.", ""); return; }

  const esc = v => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const csv = [
    ["Timestamp","Who","Action","Subject","Detail"].join(","),
    ...rows.map(r => [
      esc(r.at || ""), esc(r.who), esc(r.action), esc(r.subject), esc(r.detail)
    ].join(","))
  ].join("\r\n");

  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `task-tracker-audit-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash("CSV downloaded");
}

/* ──────────────────────────────── wiring ───────────────────────────────── */

(function wireAdmin(){
  $("gateSubmit").addEventListener("click", submitGate);

  $("forceAssign").addEventListener("click", forceAssignPlate);
  $("admPeople").addEventListener("click", e => {
    const rn = e.target.closest("[data-rename]");
    if(rn) return renamePerson(rn.dataset.rename);
    const block = e.target.closest("[data-block]");
    if(block) return setBlocked(block.dataset.block, block.dataset.action === "block");
  });

  $("admApprovals").addEventListener("click", e => {
    const ap = e.target.closest("[data-approve]");
    if(ap) return approveRequest(ap.dataset.approve);
    const rj = e.target.closest("[data-reject]");
    if(rj) return rejectRequest(rj.dataset.reject);
    const roa = e.target.closest("[data-roapprove]");
    if(roa) return approveReopen(roa.dataset.roapprove);
    const ror = e.target.closest("[data-roreject]");
    if(ror) return rejectReopen(ror.dataset.roreject);
  });

  $("adminRail").addEventListener("click", e => {
    const btn = e.target.closest(".rail-item");
    if(!btn || btn.disabled) return;
    // The edit banner lives inside Tasks, so navigating away would leave an
    // armed editor with nothing on screen saying so.
    if(btn.dataset.sec !== "tasks") cancelTemplateEdit();
    showSection(btn.dataset.sec);
  });

  $("taskAdd").addEventListener("click", addTask);
  $("taskSave").addEventListener("click", saveTaskTemplate);
  $("taskUpdate").addEventListener("click", updateTemplate);
  $("taskEditCancel").addEventListener("click", () => cancelTemplateEdit());
  // Enter has to follow the mode too, or it submits a new task and discards the edit.
  $("taskTitle").addEventListener("keydown", e => {
    if(e.key === "Enter") editingTemplateId ? updateTemplate() : addTask();
  });

  $("stageAdd").addEventListener("click", addStageRow);
  $("taskTitle").addEventListener("input", refreshStageBase);
  $("taskTimed").addEventListener("change", syncTimedFields);
  $("stageList").addEventListener("click", e => {
    const del = e.target.closest("[data-stagedel]");
    if(del) removeStageRow(Number(del.dataset.stagedel));
  });
  // Enter in a stage title adds the next stage rather than submitting the task.
  $("stageList").addEventListener("keydown", e => {
    if(e.key === "Enter" && e.target.classList.contains("stage-row-t")){
      e.preventDefault();
      addStageRow();
    }
  });

  $("lbWindow").addEventListener("change", renderLeaderboard);
  $("lbReset").addEventListener("click", resetLeaderboard);
  $("lbList").addEventListener("click", e => {
    const del = e.target.closest("[data-lbdel]");
    if(del) removeFromLeaderboard(del.dataset.lbdel);
  });

  $("qaAddAll").addEventListener("click", addAllTemplates);
  $("admQuick").addEventListener("click", e => {
    const add = e.target.closest("[data-qaadd]");
    if(add) return addTemplateToBoard(add.dataset.qaadd);
    const ed = e.target.closest("[data-qaedit]");
    if(ed) return beginTemplateEdit(ed.dataset.qaedit);
    const del = e.target.closest("[data-qadel]");
    if(del) return deleteTemplate(del.dataset.qadel);
  });

  $("plateAdd").addEventListener("click", addPlate);
  $("plateLabel").addEventListener("keydown", e => { if(e.key === "Enter") addPlate(); });
  $("plateNote").addEventListener("keydown", e => { if(e.key === "Enter") addPlate(); });

  $("admTasks").addEventListener("click", e => {
    const del  = e.target.closest("[data-deltask]");
    if(del) return deleteTask(del.dataset.deltask);
    const move = e.target.closest("[data-move]");
    if(move && !move.disabled) return moveTask(move.dataset.id, move.dataset.move);
  });

  $("admPlates").addEventListener("click", e => {
    const del = e.target.closest("[data-delplate]");
    if(del) return deletePlate(del.dataset.delplate);
    const free = e.target.closest("[data-freeplate]");
    if(free) return forceReleasePlate(free.dataset.freeplate);
    const unlock = e.target.closest("[data-unlockplate]");
    if(unlock) return unlockPlate(unlock.dataset.unlockplate);
  });

  $("connSave").addEventListener("click", saveConnection);
  $("connInput").addEventListener("keydown", e => { if(e.key === "Enter") saveConnection(); });
  $("connCopy").addEventListener("click", copyTeamCode);
  $("connTest").addEventListener("click", testConnection);
  $("connReveal").addEventListener("click", () => { codeRevealed = !codeRevealed; renderConnection(); });
  $("connDisconnect").addEventListener("click", disconnectConnection);

  $("auditWho").addEventListener("change", renderAdminAudit);
  $("auditAct").addEventListener("change", renderAdminAudit);
  $("auditExport").addEventListener("click", exportAuditCsv);

  $("resetBoard").addEventListener("click", resetBoard);
  $("clearAudit").addEventListener("click", clearAuditLog);
  $("wipeAll").addEventListener("click", wipeEverything);
})();
