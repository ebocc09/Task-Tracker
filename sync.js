/* ============================================================================
   Task Tracker — state store and GitHub sync
   ----------------------------------------------------------------------------
   Three modes, decided at boot by what's available:

     local   no repo configured (or it can't be reached) → localStorage only
     viewer  repo reachable, no token                    → read-only
     member  repo reachable + token                      → read and write

   The important idea in this file is commit(). A change is expressed as a
   FUNCTION over the data, never as a snapshot. That lets us re-run it against
   whatever the server currently has if someone else wrote first — so two people
   completing two different tasks at the same moment both survive.
   ========================================================================== */
"use strict";

/* ─────────────────────────────── state ─────────────────────────────────── */

const state = {
  data   : emptyBoard(),
  sha    : null,           // blob sha of data.json, needed to write
  mode   : "local",        // local | viewer | member
  user   : null,           // GitHub login, once a token is validated
  syncing: false,
  lastSync: null,
  lastError: null,
  filter : "all",
  openTaskId: null
};

function emptyBoard(){
  return { version:1, updatedAt:null, updatedBy:null, plates:[], tasks:[], audit:[], scores:[], blocked:[], templates:[], renames:[], requests:[], reopenRequests:[], resets:[] };
}

/* Defensive: never trust the shape of a file other people can edit. */
function normalize(raw){
  const d = (raw && typeof raw === "object") ? raw : {};
  const board = emptyBoard();
  board.version   = 1;
  board.updatedAt = typeof d.updatedAt === "string" ? d.updatedAt : null;
  board.updatedBy = typeof d.updatedBy === "string" ? d.updatedBy : null;

  board.plates = Array.isArray(d.plates) ? d.plates.filter(p => p && p.id && p.label).map(p => ({
    id           : String(p.id),
    label        : String(p.label),
    note         : p.note ? String(p.note) : "",
    checkedOutBy : p.checkedOutBy ? String(p.checkedOutBy) : null,
    checkedOutAt : p.checkedOutAt ? String(p.checkedOutAt) : null,
    // Set to the admin's name when locked. Only an admin can clear it.
    forcedBy     : p.forcedBy ? String(p.forcedBy) : null,
    forcedAt     : p.forcedAt ? String(p.forcedAt) : null
  })) : [];

  board.blocked = Array.isArray(d.blocked)
    ? [...new Set(d.blocked.filter(n => typeof n === "string" && n.trim()).map(n => n.trim()))]
    : [];

  /* A timer is a whole number of minutes, above zero. Anything else — a string,
     a float, a negative, a hand-edited "60 mins" — becomes null, which reads
     downstream as "not actually a timed task" rather than as a timer that
     expires at a nonsense moment. */
  const minutesOf = v => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };

  // Reusable task templates for the Quick add sidebar. Deliberately survive
  // board resets and wipes — the point is re-adding common tasks fast.
  board.templates = Array.isArray(d.templates) ? d.templates.filter(t => t && t.id && t.title).map(t => {
    // Same rule as a board task, for the same reason — a saved timed task must
    // come back off Quick add still timed, and still without stages.
    const timed = t.timed === true;
    const limit = timed ? minutesOf(t.limitMinutes) : null;
    return {
      id         : String(t.id),
      title      : String(t.title),
      description: t.description ? String(t.description) : "",
      // Carried so a saved task keeps scoring when it's re-added to the board.
      leaderboard: t.leaderboard === true,
      timed      : timed && limit != null,
      limitMinutes: limit,
      // Blueprint only — no status/by/at. taskFromTemplate mints those fresh.
      stages     : (timed || !Array.isArray(t.stages)) ? [] : t.stages.filter(s => s && s.title).map(s => ({
        title      : String(s.title),
        description: s.description ? String(s.description) : ""
      }))
    };
  }) : [];

  // Rename breadcrumbs. A browser can't reach into another's localStorage, so
  // when an admin renames someone the change is logged here; each client checks
  // on sync whether its own name was changed and catches up. Capped so it can't
  // grow without bound.
  board.renames = Array.isArray(d.renames) ? d.renames.filter(r => r && r.from && r.to).map(r => ({
    id  : r.id ? String(r.id) : uid("r"),
    at  : r.at ? String(r.at) : null,
    by  : r.by ? String(r.by) : null,
    from: String(r.from),
    to  : String(r.to)
  })).slice(-200) : [];

  // Pending name-change requests awaiting admin approval.
  board.requests = Array.isArray(d.requests) ? d.requests.filter(r => r && r.id && r.from && r.to).map(r => ({
    id  : String(r.id),
    at  : r.at ? String(r.at) : null,
    from: String(r.from),
    to  : String(r.to)
  })) : [];

  // Pending task-reopen requests awaiting admin approval.
  board.reopenRequests = Array.isArray(d.reopenRequests) ? d.reopenRequests.filter(r => r && r.id && r.taskId).map(r => ({
    id       : String(r.id),
    at       : r.at ? String(r.at) : null,
    by       : r.by ? String(r.by) : "Unknown",
    taskId   : String(r.taskId),
    taskTitle: r.taskTitle ? String(r.taskTitle) : "",
    reason   : r.reason ? String(r.reason) : ""
  })) : [];

  /* in_progress and failed belong to TIMED tasks only — see the timer helpers
     in app.js. They are in the same list because task.status is one field and
     every reader keys off it; nothing else distinguishes them here.

     "partial" was retired in BUILD 29: a task is completed or it is not. It is
     deliberately absent here so no live task can be in it again, and legacy
     data lands on "blocked" — "could not complete" is the nearest surviving
     truth, and the alternative (falling through to "pending") would erase the
     fact that someone worked on it and wrote a note. */
  const OK = ["pending","complete","blocked","in_progress","failed"];
  const statusOf = s => s === "partial" ? "blocked" : (OK.includes(s) ? s : "pending");

  /* Reset snapshots are history, not board state, so they are NOT migrated —
     a board that read "Partial" the day it was cleared has to keep saying so.
     STATUS in app.js keeps a legacy entry purely so these still render. */
  const OK_SNAP = [...OK, "partial"];

  /* A task is optionally broken into ordered stages. An empty array means an
     ordinary single-step task, which is what every task created before this
     existed normalizes to — so old data needs no migration. */
  const stagesOf = t => Array.isArray(t.stages) ? t.stages.filter(s => s && s.title).map((s, i) => ({
    /* Derived from position rather than uid() so a hand-edited file without
       stage ids normalizes to the *same* ids every read. A random id here would
       differ between the optimistic apply and the replay, and the stage-advance
       guard — which matches on id — would reject its own retry. */
    id         : s.id ? String(s.id) : `${t.id}_s${i}`,
    title      : String(s.title),
    description: s.description ? String(s.description) : "",
    status     : statusOf(s.status),
    by         : s.by ? String(s.by) : null,
    at         : s.at ? String(s.at) : null,
    note       : s.note ? String(s.note) : null
  })) : [];

  board.tasks = Array.isArray(d.tasks) ? d.tasks.filter(t => t && t.id && t.title).map(t => {
    /* A timed task is one-step by definition: the timer measures the whole
       task, and a per-stage timer is a different feature that does not exist.
       The add form will not let the two be combined, but data.json is a file
       people can hand-edit, so the invariant is enforced on the way in rather
       than assumed by every reader downstream. */
    const timed  = t.timed === true;
    const limit  = timed ? minutesOf(t.limitMinutes) : null;
    return {
      id         : String(t.id),
      title      : String(t.title),
      description: t.description ? String(t.description) : "",
      createdBy  : t.createdBy ? String(t.createdBy) : null,
      createdAt  : t.createdAt ? String(t.createdAt) : null,
      status     : statusOf(t.status),
      statusBy   : t.statusBy ? String(t.statusBy) : null,
      statusAt   : t.statusAt ? String(t.statusAt) : null,
      statusNote : t.statusNote ? String(t.statusNote) : null,
      // Completing this earns leaderboard credit. Absent on every task created
      // before the leaderboard existed, which normalizes to false — no migration.
      leaderboard: t.leaderboard === true,
      /* Timed tasks: a limit in minutes, a clock that starts on Start, and the
         person it belongs to. `timed` is false on every task that predates the
         feature, so old boards need no migration.

         A ticked box with no usable limit is NOT a timed task — otherwise it
         would sit on the board with a Start button that can never expire. */
      timed      : timed && limit != null,
      limitMinutes: limit,
      startedAt  : t.startedAt ? String(t.startedAt) : null,
      startedBy  : t.startedBy ? String(t.startedBy) : null,
      // Stamped when the expiry is persisted, so a failure keeps the moment it
      // actually ran out rather than the moment a browser noticed.
      failedAt   : t.failedAt ? String(t.failedAt) : null,
      stages     : timed ? [] : stagesOf(t)
    };
  }) : [];

  /* Board snapshots written by Reset board, newest first. Each one is the board
     as it stood the instant before it was cleared: the percentage the hero bar
     was showing, and the status every task and stage was in.

     `pct` is stored rather than recomputed on read. The tasks here are frozen
     copies, so recomputing would give the same answer today — but the formula
     behind the hero bar has changed once already (stages made it fractional)
     and a snapshot has to keep meaning what it meant the day it was taken. */
  const wholeNum = (v, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : 0;
  };

  board.resets = Array.isArray(d.resets) ? d.resets.filter(r => r && r.id).slice(0, RESET_CAP).map(r => ({
    id   : String(r.id),
    at   : r.at ? String(r.at) : null,
    by   : r.by ? String(r.by) : "Unknown",
    total: wholeNum(r.total, Number.MAX_SAFE_INTEGER),
    done : wholeNum(r.done,  Number.MAX_SAFE_INTEGER),
    pct  : wholeNum(r.pct, 100),
    /* Plates handed back by this reset. Entries written before the two resets
       were separated have no such field and read as 0 — those resets did
       release plates, but how many was never recorded. The history shows this
       line only when it is above zero, so an old entry stays silent rather
       than claiming none were released. */
    plates: wholeNum(r.plates, Number.MAX_SAFE_INTEGER),
    tasks: Array.isArray(r.tasks) ? r.tasks.filter(t => t && t.title).map(t => ({
      title : String(t.title),
      status: OK_SNAP.includes(t.status) ? t.status : "pending",
      by    : t.by ? String(t.by) : null,
      at    : t.at ? String(t.at) : null,
      stages: Array.isArray(t.stages) ? t.stages.filter(s => s && s.title).map(s => ({
        title : String(s.title),
        status: OK_SNAP.includes(s.status) ? s.status : "pending",
        by    : s.by ? String(s.by) : null
      })) : []
    })) : []
  })) : [];

  board.audit = Array.isArray(d.audit) ? d.audit.filter(a => a && a.action).slice(0, AUDIT_CAP).map(a => ({
    id     : a.id ? String(a.id) : uid("a"),
    at     : a.at ? String(a.at) : null,
    who    : a.who ? String(a.who) : "Unknown",
    action : String(a.action),
    subject: a.subject ? String(a.subject) : "",
    detail : a.detail ? String(a.detail) : ""
  })) : [];

  /* Leaderboard credit, one event per completion, newest first like the audit.
     It lives here rather than being derived from the audit log because that log
     is capped at 500 entries and an admin can clear it outright — either would
     silently gut month- and quarter-to-date. The title is snapshotted so an
     event stays readable after the task is deleted or renamed. */
  board.scores = Array.isArray(d.scores) ? d.scores.filter(s => s && s.id && s.who).map(s => ({
    id     : String(s.id),
    at     : s.at ? String(s.at) : null,
    who    : String(s.who),
    taskId : s.taskId ? String(s.taskId) : "",
    // null on an unstaged task — the whole task was one award.
    stageId: s.stageId ? String(s.stageId) : null,
    title  : s.title ? String(s.title) : "",
    // A share of one task, so never above 1. A junk value scores nothing
    // rather than poisoning everyone else's percentage.
    value  : Number.isFinite(Number(s.value)) && Number(s.value) > 0
      ? Math.min(Number(s.value), 1) : 0
  })).slice(0, SCORE_CAP) : [];

  return board;
}

/* ───────────────────────────── small helpers ───────────────────────────── */

const $ = id => document.getElementById(id);
const nowIso = () => new Date().toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let uidCounter = 0;
function uid(prefix){
  uidCounter += 1;
  return prefix + "_" + Date.now().toString(36) + uidCounter.toString(36);
}

function escHtml(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function relTime(iso){
  if(!iso) return "—";
  const then = Date.parse(iso);
  if(Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if(s < 45)    return "just now";
  if(s < 90)    return "1 min ago";
  const m = Math.round(s / 60);
  if(m < 60)    return m + " min ago";
  const h = Math.round(m / 60);
  if(h < 24)    return h === 1 ? "1 hour ago" : h + " hours ago";
  const d = Math.round(h / 24);
  if(d < 30)    return d === 1 ? "yesterday" : d + " days ago";
  return new Date(then).toLocaleDateString();
}

function fullTime(iso){
  if(!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString();
}

/* Start of the week / month / quarter to date, as a local-midnight epoch.
   Local rather than UTC deliberately: relTime and fullTime already render in
   the reader's zone, and "this week" has to mean the week they're standing in,
   not one that turns over mid-afternoon. Returns null for "all", which callers
   read as "no lower bound".
     back:  how many whole periods to step back. windowStart("qtd") is this
            quarter; windowStart("qtd", 1) is the start of the previous one,
            which is where score pruning cuts. */
function windowStart(key, back = 0){
  if(key === "all") return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if(key === "wtd"){
    const offset = (d.getDay() - WEEK_STARTS_ON + 7) % 7;
    d.setDate(d.getDate() - offset - back * 7);
  }else if(key === "mtd"){
    d.setDate(1);
    d.setMonth(d.getMonth() - back);
  }else if(key === "qtd"){
    d.setDate(1);
    d.setMonth(Math.floor(d.getMonth() / 3) * 3 - back * 3);
  }else{
    return null;
  }
  return d.getTime();
}

/* A filter key as a half-open interval [from, to) of local-midnight epochs.
   `to` is null for the to-date keys, which run to now — only a closed period
   like last week carries an upper bound, and it has to be EXCLUSIVE or a
   completion stamped exactly at this week's first midnight lands in both
   weeks and the two columns no longer sum to the quarter. */
function windowRange(key){
  if(key === "lastweek") return { from: windowStart("wtd", 1), to: windowStart("wtd") };
  return { from: windowStart(key), to: null };
}

/* Is a timestamp inside that window? An unparseable date is inside "all time"
   and outside everything else — the same rule the to-date filters have always
   applied, kept here so a closed window doesn't quietly invent a second one. */
function inWindow(at, range){
  const { from, to } = range;
  if(from == null && to == null) return true;
  const t = Date.parse(at);
  if(Number.isNaN(t)) return false;
  return (from == null || t >= from) && (to == null || t < to);
}

/* Identity — the name every action is stamped with. */
function me(){
  const v = localStorage.getItem(LS.name);
  return v && v.trim() ? v.trim() : null;
}
function setMe(name){ localStorage.setItem(LS.name, name.trim()); }

function token(){
  const v = localStorage.getItem(LS.token);
  return v && v.trim() ? v.trim() : null;
}
function setToken(t){
  if(t) localStorage.setItem(LS.token, t.trim());
  else  localStorage.removeItem(LS.token);
}
function maskToken(t){
  if(!t) return "—";
  return t.length <= 10 ? "•".repeat(t.length) : t.slice(0,7) + "…" + "•".repeat(4) + t.slice(-4);
}

const repoConfigured = () =>
  REPO.owner && !/^YOUR-GITHUB-USERNAME$/i.test(REPO.owner) && REPO.name;

const canWrite = () => (state.mode === "member" || state.mode === "local") && !amBlocked();

/* Blocked is advisory — the team code is shared, so this stops a cooperative
   person, not a determined one. Admin → People says as much. */
function amBlocked(){
  const n = me();
  return !!n && Array.isArray(state.data.blocked) && state.data.blocked.includes(n);
}

/* Did an admin rename me since I last looked? Follow the breadcrumb chain
   (BadName → X → Y handles two renames while I was offline), update my own
   localStorage identity, and tell me firmly. Self-limiting: once my stored
   name is the chain's end, nothing matches on the next pass. */
function applyIdentityRenames(){
  const original = me();
  const renames = state.data && state.data.renames;
  if(!original || !Array.isArray(renames) || !renames.length) return;

  let name = original;
  [...renames]
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0))
    .forEach(r => { if(r.from === name) name = r.to; });

  if(name !== original){
    setMe(name);
    if(typeof renderChrome === "function") renderChrome();
    if(typeof askConfirm === "function"){
      askConfirm({
        title: "Your display name was changed",
        text : `An admin changed your display name to “${name}”. It's now used for everything you do on the board.`,
        yes  : "OK", solo: true
      });
    }
  }
}

/* UTF-8 safe base64 — btoa alone mangles anything non-ASCII. */
function b64encode(str){
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for(let i = 0; i < bytes.length; i += 0x8000){
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function b64decode(b64){
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ─────────────────────────── local persistence ─────────────────────────── */

function saveLocal(){
  try{ localStorage.setItem(LS.local, JSON.stringify(state.data)); }
  catch(e){ /* private mode / quota — nothing useful to do */ }
}
function loadLocal(){
  try{
    const raw = localStorage.getItem(LS.local);
    return raw ? normalize(JSON.parse(raw)) : emptyBoard();
  }catch(e){ return emptyBoard(); }
}

/* ───────────────────────────── GitHub calls ────────────────────────────── */

const contentsUrl = () =>
  `https://api.github.com/repos/${encodeURIComponent(REPO.owner)}/${encodeURIComponent(REPO.name)}` +
  `/contents/${REPO.path.split("/").map(encodeURIComponent).join("/")}`;

class GhError extends Error{
  constructor(message, status, body){
    super(message);
    this.name = "GhError";
    this.status = status;
    this.body = body;
  }
}

async function gh(url, opts = {}){
  const headers = Object.assign({
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  }, opts.headers || {});

  const t = token();
  if(t) headers.Authorization = "Bearer " + t;
  if(opts.body) headers["Content-Type"] = "application/json";

  /* Hard timeout. A corporate proxy that blackholes a request leaves fetch
     pending forever, which would strand boot on an await and leave the UI
     showing a stale banner. Better to fail loudly after 15s. */
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try{
    res = await fetch(url, Object.assign({}, opts, {
      headers, cache: "no-store", signal: ctrl.signal
    }));
  }catch(networkErr){
    const timedOut = networkErr && networkErr.name === "AbortError";
    throw new GhError(
      timedOut ? `No response within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s` : "Network unreachable",
      timedOut ? 408 : 0, null);
  }finally{
    clearTimeout(timer);
  }

  if(res.ok) return res;

  let body = null;
  try{ body = await res.json(); }catch(e){ /* not json */ }
  throw new GhError((body && body.message) || res.statusText || "Request failed", res.status, body);
}

/* Read data.json. Falls back to the raw CDN if the anonymous API budget is
   spent — 60 req/hr is shared per IP, which a whole office can burn through. */
async function pull(){
  const res  = await gh(contentsUrl() + `?ref=${encodeURIComponent(REPO.branch)}&t=${Date.now()}`);
  const json = await res.json();
  return { data: normalize(JSON.parse(b64decode(json.content))), sha: json.sha };
}

async function pullRawFallback(){
  const url = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/${REPO.path}?t=${Date.now()}`;

  // Same timeout discipline as gh(). This runs on the failure path, so a stall
  // here would hang boot at exactly the moment something is already wrong.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try{
    res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
  }catch(e){
    throw new GhError(e && e.name === "AbortError" ? "Backup route timed out" : "Backup route unreachable", 0, null);
  }finally{
    clearTimeout(timer);
  }

  if(!res.ok) throw new GhError("Raw fetch failed", res.status, null);
  return { data: normalize(await res.json()), sha: null };  // no sha → read-only
}

async function putFile(data, sha, message){
  const res = await gh(contentsUrl(), {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: b64encode(JSON.stringify(data, null, 2) + "\n"),
      sha,
      branch: REPO.branch
    })
  });
  const json = await res.json();
  return json.content.sha;
}

/* ──────────────────────────────── audit ────────────────────────────────── */

function pushAudit(data, entries){
  const list = !entries ? [] : (Array.isArray(entries) ? entries : [entries]);
  const who = me() || "Unknown";
  list.filter(Boolean).forEach(e => {
    data.audit.unshift({
      id: uid("a"), at: nowIso(),
      /* Almost always the person clicking, which is why it defaults. The
         exception is a timed task running out: whichever teammate's browser
         happens to notice is the one that writes it, but the entry has to read
         "Bob failed X" — Bob being whoever started the clock, not the witness. */
      who: e.who ? String(e.who) : who,
      action : e.action,
      subject: e.subject || "",
      detail : e.detail || ""
    });
  });
  if(data.audit.length > AUDIT_CAP) data.audit.length = AUDIT_CAP;
}

/* ────────────────────────────── leaderboard ────────────────────────────── */

/* Record one completion's worth of credit. Called from inside a mutator, so it
   has to be replay-safe: the id and timestamp are minted by the CALLER outside
   commit(), because uid() increments a module counter and a fresh call on each
   replay pass would mint a different id every time. The id guard below then
   makes a second pass over the same data a no-op rather than a double-credit. */
function awardScore(data, entry){
  data.scores = data.scores || [];
  if(data.scores.some(s => s.id === entry.id)) return;
  data.scores.unshift({
    id     : entry.id,
    at     : entry.at,
    who    : entry.who,
    taskId : entry.taskId,
    stageId: entry.stageId || null,
    title  : entry.title || "",
    value  : entry.value
  });
  pruneScores(data);
}

/* Bounded by age first, count second. The age floor is the start of the
   previous quarter, so quarter-to-date can never be showing a truncated
   window; SCORE_CAP is only a backstop against a pathologically busy board. */
function pruneScores(data){
  const floor = windowStart("qtd", 1);
  if(floor != null){
    data.scores = data.scores.filter(s => {
      const t = Date.parse(s.at);
      return Number.isNaN(t) || t >= floor;   // keep undated rather than guess
    });
  }
  if(data.scores.length > SCORE_CAP) data.scores.length = SCORE_CAP;
}

/* Run a mutator against a board and record whatever it reports.
   The mutator may THROW to abort — that's how "someone already took this
   plate" is enforced at the moment of writing rather than at click time. */
function applyMutation(data, mutator){
  const audit = mutator(data);
  pushAudit(data, audit);
  data.updatedAt = nowIso();
  data.updatedBy = me() || "Unknown";
}

/* ─────────────────────────────── commit ────────────────────────────────── */

/**
 * Apply a change everywhere it needs to go.
 * @param {string}   label    short verb for the git commit message
 * @param {Function} mutator  (data) => auditEntry | auditEntry[] | null
 * @returns {Promise<boolean>} whether it stuck
 */
async function commit(label, mutator){
  if(!me()){ openUserModal(); return false; }

  if(state.mode === "viewer"){
    toast("Read-only — enter your team code to make changes.", "bad");
    return false;
  }

  if(amBlocked()){
    toast(`An admin has removed edit access for ${me()}. Ask them to restore it.`, "bad");
    return false;
  }

  const before = structuredClone(state.data);

  // Optimistic: show it immediately, roll back if the write fails.
  try{
    applyMutation(state.data, mutator);
  }catch(err){
    toast(err.message || "That didn't work.", "bad");
    return false;
  }
  render();

  if(state.mode === "local"){ saveLocal(); return true; }

  setSyncing(true);
  try{
    const result = await pushWithReplay(mutator, label);
    state.data = result.data;
    state.sha  = result.sha;
    state.lastSync = Date.now();
    state.lastError = null;
    render();
    return true;
  }catch(err){
    state.data = before;                       // roll the optimistic change back
    render();
    toast(explainError(err, "save"), "bad");
    return false;
  }finally{
    setSyncing(false);
  }
}

/* GET latest → re-apply the mutator → PUT. On a 409 the file moved under us,
   so fetch again and replay. Four attempts, then give up honestly. */
async function pushWithReplay(mutator, label){
  let lastErr = null;

  for(let attempt = 0; attempt < 4; attempt++){
    const fresh = await pull();
    const next  = structuredClone(fresh.data);

    applyMutation(next, mutator);              // may throw → propagate, don't retry

    try{
      const sha = await putFile(next, fresh.sha, `${label} — ${me()}`);
      return { data: next, sha };
    }catch(err){
      const stale = err.status === 409 || err.status === 422;
      if(!stale) throw err;
      lastErr = err;
      await sleep(200 * (attempt + 1) + Math.floor(Math.random() * 120));
    }
  }
  throw lastErr || new GhError("Could not save after several attempts", 409, null);
}

function explainError(err, verb){
  const s = err && err.status;
  if(s === 0)   return "Couldn't reach api.github.com. Check your connection — or whether a network policy is blocking it.";
  if(s === 408) return "api.github.com didn't respond. On a managed network it may be blocked by a proxy or firewall.";
  if(s === 401) return "Your token was rejected. Click the status chip in the top bar to reconnect.";
  if(s === 403){
    const m = (err && err.message) || "";
    if(/rate limit/i.test(m)) return "GitHub rate limit reached. Wait a few minutes and try again.";
    // Pass GitHub's own wording through — it is usually more specific than
    // anything we could guess, and Admin → Connection can test each cause.
    return `GitHub refused that write: “${m}”. The team code needs Contents: ` +
           `Read and write on this repository. Run Admin → Connection → Test connection to find which step fails.`;
  }
  if(s === 404){
    // 404 here is ambiguous on purpose from GitHub's side: a private repo looks
    // exactly like a missing one to an anonymous reader. Name both.
    return `Couldn't find ${REPO.owner}/${REPO.name} → ${REPO.path} on branch "${REPO.branch}". ` +
           `Check config.js matches the repo exactly, that data.json is committed on that branch, ` +
           `and — if the repo is private — that you've connected a token.`;
  }
  if(s === 409) return "Someone else saved at the same moment and we couldn't merge. Try again.";
  if(s === 422) return "GitHub rejected the write. Refresh and try again.";
  return `Couldn't ${verb}: ${(err && err.message) || "unknown error"}`;
}

/* ────────────────────────────── refresh loop ───────────────────────────── */

let pollTimer = null;

async function refresh({ quiet = false } = {}){
  if(state.mode === "local"){ if(!quiet) toast("Local mode — nothing to sync.", ""); return; }

  setSyncing(true);
  try{
    let result;
    try{
      result = await pull();
    }catch(err){
      // Anonymous budget exhausted? The raw CDN still works (up to ~5 min stale).
      if(!token() && (err.status === 403 || err.status === 429)){
        result = await pullRawFallback();
        if(!quiet) toast("Rate limited — showing a slightly delayed copy.", "");
      }else{
        throw err;
      }
    }

    // A half-typed note lives in the confirm dialog now, not in the list, so a
    // poll re-rendering underneath it can't stomp anything.
    state.data = result.data;
    if(result.sha) state.sha = result.sha;

    state.lastSync  = Date.now();
    state.lastError = null;
    applyIdentityRenames();       // catch an admin rename that landed since last poll
    render();
  }catch(err){
    state.lastError = explainError(err, "refresh");
    if(!quiet) toast(state.lastError, "bad");
    renderChrome();
  }finally{
    setSyncing(false);
  }
}

function startPolling(){
  if(pollTimer) clearInterval(pollTimer);
  if(state.mode === "local") return;
  const secs = state.mode === "member" ? POLL_SECONDS.member : POLL_SECONDS.viewer;
  pollTimer = setInterval(() => {
    if(document.hidden) return;                // don't burn quota on a hidden tab
    refresh({ quiet: true });
  }, secs * 1000);
}

function setSyncing(on){
  state.syncing = on;
  const sweep = $("sweep"), fill = $("sweepFill"), icon = $("refreshIcon");
  if(on){
    sweep.classList.add("on");
    fill.style.width = "72%";
    icon.classList.add("spin");
  }else{
    fill.style.width = "100%";
    icon.classList.remove("spin");
    setTimeout(() => {
      if(state.syncing) return;
      sweep.classList.remove("on");
      setTimeout(() => { if(!state.syncing) fill.style.width = "0"; }, 320);
    }, 220);
  }
  renderChrome();
}

/* ──────────────────────────────── boot ─────────────────────────────────── */

async function determineMode(){
  if(!repoConfigured()){
    state.mode = "local";
    state.data = loadLocal();
    return;
  }

  // A token, if present, must be real before we trust it.
  if(token()){
    try{
      const res  = await gh("https://api.github.com/user");
      const user = await res.json();
      state.user = user.login;
      state.mode = "member";
    }catch(err){
      setToken(null);
      state.user = null;
      state.mode = "viewer";
      toast("Saved token is no longer valid — click the status chip to reconnect.", "bad");
    }
  }else{
    state.mode = "viewer";
  }

  try{
    const result = await pull();
    state.data = result.data;
    state.sha  = result.sha;
    state.lastSync = Date.now();
    applyIdentityRenames();
  }catch(err){
    // Print the exact request that failed — guessing at config typos from a
    // rendered error message is miserable.
    console.error(
      "[Task Tracker] Could not load board data.\n" +
      "  Tried : " + contentsUrl() + "?ref=" + REPO.branch + "\n" +
      "  Status: " + (err.status || "network") + " " + (err.message || "") + "\n" +
      "  Config: owner=" + REPO.owner + "  name=" + REPO.name +
      "  branch=" + REPO.branch + "  path=" + REPO.path + "\n" +
      "  Open that URL in a new tab: JSON back = config is right; " +
      '{"message":"Not Found"} = wrong repo/branch/path, or the repo is private.'
    );
    /* If the API is unusable for ANY reason — rate limit, proxy block, DNS —
       the raw CDN is a different host and often still works. Read-only, since
       raw gives us no blob sha to write against. */
    try{
      const result = await pullRawFallback();
      state.data = result.data;
      state.sha  = null;
      state.mode = "viewer";
      state.lastSync = Date.now();
      state.lastError = null;
      console.warn("[Task Tracker] API unreachable; serving read-only from raw.githubusercontent.com.");
      toast("Read-only: reached the board via the backup route. Saving is unavailable.", "bad");
      return;
    }catch(e2){ /* both routes dead — fall through to local mode */ }
    // Can't reach the board at all — degrade to local so the page still works.
    state.mode = "local";
    state.data = loadLocal();
    state.lastError = explainError(err, "load");
  }
}
