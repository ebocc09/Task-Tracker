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
  openTaskId: null,
  noteDraft : null         // {taskId, status} while typing a note
};

function emptyBoard(){
  return { version:1, updatedAt:null, updatedBy:null, plates:[], tasks:[], audit:[], blocked:[], templates:[] };
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

  // Reusable task templates for the Quick add sidebar. Deliberately survive
  // board resets and wipes — the point is re-adding common tasks fast.
  board.templates = Array.isArray(d.templates) ? d.templates.filter(t => t && t.id && t.title).map(t => ({
    id         : String(t.id),
    title      : String(t.title),
    description: t.description ? String(t.description) : ""
  })) : [];

  const OK = ["pending","complete","partial","blocked"];
  board.tasks = Array.isArray(d.tasks) ? d.tasks.filter(t => t && t.id && t.title).map(t => ({
    id         : String(t.id),
    title      : String(t.title),
    description: t.description ? String(t.description) : "",
    createdBy  : t.createdBy ? String(t.createdBy) : null,
    createdAt  : t.createdAt ? String(t.createdAt) : null,
    status     : OK.includes(t.status) ? t.status : "pending",
    statusBy   : t.statusBy ? String(t.statusBy) : null,
    statusAt   : t.statusAt ? String(t.statusAt) : null,
    statusNote : t.statusNote ? String(t.statusNote) : null
  })) : [];

  board.audit = Array.isArray(d.audit) ? d.audit.filter(a => a && a.action).slice(0, AUDIT_CAP).map(a => ({
    id     : a.id ? String(a.id) : uid("a"),
    at     : a.at ? String(a.at) : null,
    who    : a.who ? String(a.who) : "Unknown",
    action : String(a.action),
    subject: a.subject ? String(a.subject) : "",
    detail : a.detail ? String(a.detail) : ""
  })) : [];

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
      id: uid("a"), at: nowIso(), who,
      action : e.action,
      subject: e.subject || "",
      detail : e.detail || ""
    });
  });
  if(data.audit.length > AUDIT_CAP) data.audit.length = AUDIT_CAP;
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

    // Don't stomp a note the user is mid-way through typing.
    const draft = state.noteDraft;
    state.data = result.data;
    if(result.sha) state.sha = result.sha;
    state.noteDraft = draft;

    state.lastSync  = Date.now();
    state.lastError = null;
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
