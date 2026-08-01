#!/usr/bin/env node
/* ============================================================================
   Task Tracker — daily rollover runner
   ----------------------------------------------------------------------------
   Runs on a GitHub Actions heartbeat. Most invocations decide nothing is due,
   print one line and exit 0 — a red X on this workflow must always mean
   something is genuinely broken, never "it isn't 6am".

   The decision and the mutation both live in rollover-core.js, which the
   browser loads too, so the robot and the admin "Run now" button cannot drift
   apart.

   Node 18+ only: global fetch, no dependencies, no package.json.

   Env:
     GITHUB_TOKEN       required unless DRY_RUN
     GITHUB_REPOSITORY  "owner/repo", supplied by Actions
     BRANCH             default "main"
     DATA_PATH          default "data.json" — point at a scratch file to test
     FORCE              "true" ignores the schedule and rolls over now
     DRY_RUN            "1" decides and prints, writes nothing
   ========================================================================== */
"use strict";

const path = require("path");
const fs   = require("fs");
const core = require(path.join(__dirname, "..", "..", "rollover-core.js"));

const REPO      = process.env.GITHUB_REPOSITORY || "";
const BRANCH    = process.env.BRANCH    || "main";
const DATA_PATH = process.env.DATA_PATH || "data.json";
const TOKEN     = process.env.GITHUB_TOKEN || "";
const FORCE     = process.env.FORCE === "true";
const DRY_RUN   = process.env.DRY_RUN === "1";

const WHO      = "Daily rollover";
const MAX_TRIES = 4;

/* Read the cap from config.js rather than restating it, so the script can't
   quietly disagree with the app about how much history to keep. */
const AUDIT_CAP = (() => {
  try{
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "config.js"), "utf8");
    return Number(src.match(/const AUDIT_CAP\s*=\s*(\d+)/)[1]);
  }catch(err){
    return 500;
  }
})();

const log = msg => console.log(`[rollover] ${msg}`);

/* Same shape as the browser's uid() so ids are indistinguishable in the file. */
let uidCounter = 0;
const uid = prefix => prefix + "_" + Date.now().toString(36) + (++uidCounter).toString(36);

/* ── the file ────────────────────────────────────────────────────────────── */

const api = p => `https://api.github.com/repos/${REPO}/contents/${p}`;

async function gh(url, init){
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${TOKEN}`,
      ...(init && init.headers)
    }
  });
  return res;
}

async function readBoard(){
  const res = await gh(`${api(DATA_PATH)}?ref=${encodeURIComponent(BRANCH)}`);
  if(!res.ok) throw new Error(`GET ${DATA_PATH} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return {
    data: JSON.parse(Buffer.from(json.content, "base64").toString("utf8")),
    sha : json.sha
  };
}

/* PUT with the sha we read IS compare-and-swap: if a browser wrote in between,
   GitHub rejects with 409 and we start over against the new file. Exactly the
   contract sync.js's pushWithReplay relies on. */
async function writeBoard(data, sha, message){
  const body = JSON.stringify(data, null, 2) + "\n";   // byte-identical to the browser
  const res  = await gh(api(DATA_PATH), {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(body, "utf8").toString("base64"),
      sha,
      branch: BRANCH
    })
  });
  if(res.ok) return true;
  if(res.status === 409 || res.status === 422) return false;   // someone else wrote
  throw new Error(`PUT ${DATA_PATH} failed: ${res.status} ${await res.text()}`);
}

/* ── deciding ────────────────────────────────────────────────────────────── */

/* Refuse a schedule we can't trust rather than guessing at it. The browser
   normalizes on every write, so this only fires on a hand-edited file — where
   doing nothing is much better than doing something at the wrong hour. */
function usable(s){
  if(!s || typeof s !== "object") return "no schedule configured";
  if(typeof s.time !== "string" || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(s.time)){
    return `schedule.time "${s.time}" is not HH:MM`;
  }
  if(!Array.isArray(s.days)) return "schedule.days is not a list";
  return null;
}

function pushAudit(data, entry){
  data.audit = Array.isArray(data.audit) ? data.audit : [];
  data.audit.unshift({
    id: uid("a"), at: new Date().toISOString(), who: WHO,
    action: entry.action, subject: entry.subject || "", detail: entry.detail || ""
  });
  if(data.audit.length > AUDIT_CAP) data.audit.length = AUDIT_CAP;
}

/* Work out what this run should do to the board. Returns null for "nothing to
   write", otherwise a mutation applied in place plus a commit message.

   Called fresh on every retry against newly-read data, which is what makes the
   whole thing safe under concurrency: if another writer got there first, the
   re-decide simply comes back null and we exit clean. */
function decide(data, now){
  const sched = data.schedule;
  const bad = usable(sched);
  if(bad && !FORCE){ log(bad); return null; }

  const verdict = FORCE
    ? { due:true, reason:"forced", todayKey: core.dateKeyIn((sched && sched.tz) || "UTC", now), advanceKey: null }
    : core.isDue(sched, now);

  log(verdict.reason);

  if(!verdict.due){
    // Not rolling over. Only write if a key needs burning — either seeding on
    // first enable, or retiring a slot that has gone stale so it can't fire
    // late tonight.
    if(!verdict.advanceKey || sched.lastRunKey === verdict.advanceKey) return null;

    const seeding = !sched.lastRunKey;
    sched.lastRunKey = verdict.advanceKey;
    if(!seeding){
      pushAudit(data, {
        action: "board.rollover.skip",
        detail: verdict.reason
      });
    }
    stamp(data);
    return { message: seeding ? "Rollover: start the schedule" : "Rollover: skipped" };
  }

  const summary = core.applyRollover(data, { uid, now: now.toISOString(), who: WHO });

  if(!summary){
    /* Nothing flagged for auto-add. Emptying the board and leaving it empty is
       indistinguishable from someone having unticked the boxes by accident, so
       the core refuses — burn the key and say so out loud. */
    log("no saved tasks are flagged for auto-add — board left alone");
    if(verdict.advanceKey) sched.lastRunKey = verdict.advanceKey;
    pushAudit(data, {
      action: "board.rollover.skip",
      detail: "no saved tasks flagged for auto-add"
    });
    stamp(data);
    return { message: "Rollover: nothing flagged" };
  }

  /* One entry, never one per task. Ten task.add rows a day would flush the
     500-entry log inside a week, and with a daily wipe the log is the only
     history there is. */
  pushAudit(data, { action: "board.rollover", subject: "", detail: summary.detail });

  if(verdict.advanceKey) sched.lastRunKey = verdict.advanceKey;
  sched.lastRunAt = now.toISOString();
  stamp(data);

  log(summary.detail);
  return { message: `Rollover — ${summary.added} tasks` };
}

/* Matches applyMutation in sync.js, so the hero's "last change … by …" line
   reads sensibly after the robot writes. */
function stamp(data){
  data.updatedAt = new Date().toISOString();
  data.updatedBy = WHO;
}

/* ── main ────────────────────────────────────────────────────────────────── */

(async function main(){
  if(!REPO) throw new Error("GITHUB_REPOSITORY is not set");
  if(!TOKEN && !DRY_RUN) throw new Error("GITHUB_TOKEN is not set");

  for(let attempt = 1; attempt <= MAX_TRIES; attempt++){
    const { data, sha } = await readBoard();

    /* Deliberately NOT the browser's normalize(). That function is a whitelist,
       and a copy of it running here would silently delete every field a newer
       browser build had added — every morning, forever. The parsed object is
       passed through untouched except for the keys below. */
    const before = JSON.stringify(data);
    const action = decide(data, new Date());

    if(!action) return;                        // nothing to do; exit 0 quietly
    if(JSON.stringify(data) === before){ log("decided to write but nothing changed"); return; }

    if(DRY_RUN){
      log(`DRY_RUN — would commit "${action.message}", ${Buffer.byteLength(JSON.stringify(data, null, 2))} bytes`);
      return;
    }

    if(await writeBoard(data, sha, `${action.message} — ${WHO}`)){
      log(`committed: ${action.message}`);
      return;
    }

    // 409/422: a browser wrote while we were thinking. Re-read and re-decide —
    // if they already advanced lastRunKey, the next pass exits clean.
    log(`write conflict, re-reading (attempt ${attempt} of ${MAX_TRIES})`);
    await new Promise(r => setTimeout(r, 300 * attempt));
  }

  throw new Error(`gave up after ${MAX_TRIES} write conflicts`);
})().catch(err => {
  console.error(`[rollover] ${err && err.stack || err}`);
  process.exit(1);
});
