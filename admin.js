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

const isUnlocked = () => sessionStorage.getItem(UNLOCK_KEY) === "1";

/* ─────────────────────────────── open / gate ───────────────────────────── */

function openAdminModal(){
  const unlocked = isUnlocked();
  $("adminGate").hidden = unlocked;
  $("adminBody").hidden = !unlocked;
  $("adminModal").classList.toggle("wide", unlocked);
  $("gateInput").value = "";
  $("gateErr").hidden = true;
  if(unlocked) renderAdmin();
  openModal("adminModal");
}

function submitGate(){
  const input = $("gateInput");
  const err   = $("gateErr");
  if(input.value.trim() !== String(ADMIN_PASSCODE)){
    err.textContent = "Incorrect passcode.";
    err.hidden = false;
    input.value = "";
    input.focus();
    return;
  }
  sessionStorage.setItem(UNLOCK_KEY, "1");
  $("adminGate").hidden = true;
  $("adminBody").hidden = false;
  $("adminModal").classList.add("wide");
  renderAdmin();
  showSection("tasks");
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
  renderAdminPlates();
  renderAdminAudit();
  renderRailFoot();
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
    const st = STATUS[t.status];
    const sub = t.statusBy
      ? `${st.label} · ${escHtml(t.statusBy)} · ${escHtml(relTime(t.statusAt))}`
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
  <span class="pill ${st.pill}">${escHtml(st.label)}</span>
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
    const out = !!p.checkedOutBy;
    const sub = out
      ? `Checked out by ${escHtml(p.checkedOutBy)} · ${escHtml(relTime(p.checkedOutAt))}`
      : (p.note ? escHtml(p.note) : "Available");
    return `
<div class="adm-row">
  <div class="am">
    <div class="adm-t">${escHtml(p.label)}</div>
    <div class="adm-s">${sub}</div>
  </div>
  <span class="pill ${out ? "warm" : "idle"}">${out ? "Out" : "Free"}</span>
  ${out ? `<button class="mini" data-freeplate="${p.id}">Force release</button>` : ""}
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
    ${r.detail ? `<span class="ad">“${escHtml(r.detail)}”</span>` : ""}
  </span>
  <span class="at" title="${escHtml(fullTime(r.at))}">${escHtml(relTime(r.at))}</span>
</div>`).join("");
}

function auditPhrase(r){
  const s = r.subject;
  switch(r.action){
    case "task.complete":  return `completed “${s}”`;
    case "task.partial":   return `partially completed “${s}”`;
    case "task.blocked":   return `could not complete “${s}”`;
    case "task.pending":   return `reopened “${s}”`;
    case "task.add":       return `added task “${s}”`;
    case "task.delete":    return `deleted task “${s}”`;
    case "task.move":      return `reordered “${s}”`;
    case "plate.checkout": return `checked out plate ${s}`;
    case "plate.release":  return `released plate ${s}`;
    case "plate.add":      return `added plate ${s}`;
    case "plate.delete":   return `deleted plate ${s}`;
    case "plate.force":    return `force-released plate ${s}`;
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

  if(!title){ toast("Give the task a title.", "bad"); titleEl.focus(); return; }
  if(state.data.tasks.some(t => t.title.toLowerCase() === title.toLowerCase())){
    const ok = await askConfirm({
      title: "Duplicate title",
      text : `There's already a task called “${title}”. Add another anyway?`,
      yes  : "Add it"
    });
    if(!ok) return;
  }

  const id = uid("t");
  const ok = await commit(`Add task "${title}"`, data => {
    data.tasks.push({
      id, title, description: desc,
      createdBy: me(), createdAt: nowIso(),
      status: "pending", statusBy: null, statusAt: null, statusNote: null
    });
    return { action:"task.add", subject: title };
  });

  if(ok){
    titleEl.value = ""; descEl.value = "";
    titleEl.focus();
    flash("Task added");
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
    text : "Every task goes back to Pending and every plate is released. Tasks, plates, and the audit log are kept.",
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
      if(t.status !== "pending") cleared++;
      t.status = "pending"; t.statusBy = null; t.statusAt = null; t.statusNote = null;
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
    text : "The board is emptied completely. The audit log is kept as the record.",
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
  $("gateInput").addEventListener("keydown", e => { if(e.key === "Enter") submitGate(); });

  $("adminRail").addEventListener("click", e => {
    const btn = e.target.closest(".rail-item");
    if(btn && !btn.disabled) showSection(btn.dataset.sec);
  });

  $("taskAdd").addEventListener("click", addTask);
  $("taskTitle").addEventListener("keydown", e => { if(e.key === "Enter") addTask(); });

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
  });

  $("auditWho").addEventListener("change", renderAdminAudit);
  $("auditAct").addEventListener("change", renderAdminAudit);
  $("auditExport").addEventListener("click", exportAuditCsv);

  $("resetBoard").addEventListener("click", resetBoard);
  $("clearAudit").addEventListener("click", clearAuditLog);
  $("wipeAll").addEventListener("click", wipeEverything);
})();
