/* ============================================================================
   Task Tracker — daily rollover, shared logic
   ----------------------------------------------------------------------------
   Loaded two ways, deliberately:

     • the browser, as a plain <script> like every other file here, so the
       admin "Run now" button performs exactly the rollover the robot does;
     • Node, via the CommonJS guard at the bottom, so .github/scripts runs the
       same code rather than a second implementation that drifts from this one.

   Everything here is PURE. `now` is a parameter, never `new Date()`, and ids
   and timestamps arrive through a ctx object. That's what makes the awkward
   cases — spring forward, the doubled hour in autumn, a run that arrives six
   hours late — testable from a one-line node invocation.
   ========================================================================== */
"use strict";

/* How long after the scheduled time a rollover may still fire.

   This window is the whole reason a missed run is survivable, and the reason
   it isn't catastrophic. Without an upper bound, "is it past 06:00?" stays
   true all day: an outage lasting until 23:52 would wipe the board eight
   minutes before midnight, which is the worst possible moment for it. Two
   hours covers a late GitHub queue comfortably and still means a rollover
   only ever lands in the morning. */
const ROLLOVER_GRACE_MIN = 120;

const DAY_INDEX = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

/* ── reading the clock in someone else's timezone ────────────────────────── */

/* The board's day, as the people looking at it experience it. en-CA because it
   formats as YYYY-MM-DD, which sorts and compares as a string. Never
   toISOString().slice(0,10) — that's UTC, and would roll the key over in the
   middle of a California afternoon. */
function dateKeyIn(tz, now){
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit"
  }).format(now);
}

/* "HH:MM" in the target zone. hourCycle h23 rather than hour12:false: some ICU
   builds render midnight as "24:00" under the latter, which would quietly stop
   a 00:00 schedule from ever matching. */
function timeIn(tz, now){
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle:"h23", hour:"2-digit", minute:"2-digit"
    }).formatToParts(now).map(x => [x.type, x.value])
  );
  return `${p.hour}:${p.minute}`;
}

/* Weekday in the target zone. NOT getDay(), which reads the *runner's* clock —
   on a UTC machine every Californian evening reports as the following day. */
function weekdayIn(tz, now){
  const short = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday:"short" }).format(now);
  return DAY_INDEX[short];
}

const minutesOf = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/* Yesterday's key in the target zone, by stepping back a day and re-reading.
   Going through the formatter rather than subtracting 86400000 from a local
   midnight keeps it correct across a DST boundary, where a day isn't 24h. */
function previousKey(tz, now){
  return dateKeyIn(tz, new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/* ── the decision ────────────────────────────────────────────────────────── */

/* Should a rollover happen right now?

   Returns { due, reason, todayKey, advanceKey }.

     due        — perform the rollover.
     advanceKey — write this key to lastRunKey even though nothing rolled over.
                  Used to burn a slot that has already gone stale, so it can't
                  detonate later in the day, and to seed lastRunKey the first
                  time the schedule is switched on.
     reason     — plain English, printed by the Action on every run. This is
                  what someone reads at 09:00 asking why the board is stale.

   Everything is compared as wall-clock strings in the schedule's own zone. No
   epoch arithmetic and no offset maths, which is what keeps the DST cases from
   needing special handling. */
function isDue(sched, now){
  const out = (due, reason, extra) => Object.assign({ due, reason, todayKey:null, advanceKey:null }, extra);

  if(!sched || sched.enabled !== true) return out(false, "schedule is off");
  if(!Array.isArray(sched.days) || !sched.days.length) return out(false, "no days selected");

  let todayKey, nowHHMM, weekday;
  try{
    todayKey = dateKeyIn(sched.tz, now);
    nowHHMM  = timeIn(sched.tz, now);
    weekday  = weekdayIn(sched.tz, now);
  }catch(err){
    // Unknown timezone. normalize() should have caught it; refuse rather than
    // throw, so a bad value can't turn into a failing job twice an hour.
    return out(false, `unusable timezone "${sched.tz}"`);
  }

  /* First time the schedule is switched on. Seed rather than fire: nobody
     should turn a setting on and have the board wiped out from under them in
     the same breath. seedKey decides whether today still counts. */
  if(!sched.lastRunKey){
    return out(false, "first run — seeding, will start from the next occurrence",
      { todayKey, advanceKey: seedKey(sched, now) });
  }

  if(sched.lastRunKey === todayKey) return out(false, `already rolled over today (${todayKey})`, { todayKey });
  if(!sched.days.includes(weekday)) return out(false, `${todayKey} isn't a scheduled day`, { todayKey });

  const target = minutesOf(sched.time);
  const cur    = minutesOf(nowHHMM);

  if(cur < target){
    return out(false, `too early — ${nowHHMM}, scheduled ${sched.time}`, { todayKey });
  }

  /* Past the window. Don't roll over — but do burn the key, so this morning's
     missed slot can't fire tonight the moment a delayed run lands.

     >= rather than == throughout is also what makes spring forward work: with
     a 02:30 schedule in a zone that jumps 02:00 to 03:00, 02:30 never exists,
     and the first reading after the jump is "03:00" — still inside the window,
     so it fires half an hour late instead of never. Don't "fix" this into an
     exact match. */
  if(cur >= target + ROLLOVER_GRACE_MIN){
    return out(false,
      `missed the window — ${nowHHMM}, scheduled ${sched.time} (+${ROLLOVER_GRACE_MIN}m grace)`,
      { todayKey, advanceKey: todayKey });
  }

  return out(true, `due — ${nowHHMM} in ${sched.tz}, scheduled ${sched.time}`,
    { todayKey, advanceKey: todayKey });
}

/* Where lastRunKey should start when the schedule is switched on, or when the
   time or days are changed. Today's key if the moment has already passed
   (so today is treated as done), otherwise yesterday's (so today still runs).

   Alarm-clock semantics: setting an alarm for 06:00 at 05:00 rings in an hour;
   setting one at 07:00 rings tomorrow. */
function seedKey(sched, now){
  try{
    return minutesOf(timeIn(sched.tz, now)) >= minutesOf(sched.time)
      ? dateKeyIn(sched.tz, now)
      : previousKey(sched.tz, now);
  }catch(err){
    return null;
  }
}

/* Next time a rollover will happen, for the "Next rollover: …" line in the UI.
   Walks forward a day at a time, which is short enough to be obviously correct
   and sidesteps every offset calculation. Returns null when it can't happen. */
function describeNextRun(sched, now){
  if(!sched || sched.enabled !== true) return null;
  if(!Array.isArray(sched.days) || !sched.days.length) return null;

  try{
    const todayKey = dateKeyIn(sched.tz, now);
    const past     = minutesOf(timeIn(sched.tz, now)) >= minutesOf(sched.time);
    const ranToday = sched.lastRunKey === todayKey;

    for(let i = 0; i < 8; i++){
      const when = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const key  = dateKeyIn(sched.tz, when);
      if(!sched.days.includes(weekdayIn(sched.tz, when))) continue;
      if(i === 0 && (past || ranToday)) continue;    // today's slot is spent
      return { key, time: sched.time, days: i };
    }
  }catch(err){
    return null;
  }
  return null;
}

/* ── the mutation ────────────────────────────────────────────────────────── */

/* Empty the board and rebuild it from the saved tasks flagged `auto`, then
   release every plate. Mutates `data` in place and returns a summary, or null
   when it deliberately did nothing.

   ctx supplies everything impure:
     uid(prefix) — id minter
     now         — ISO string
     who         — name to stamp on the audit entry

   Scores are untouched on purpose. A rollover is a new round, not an erasure —
   the leaderboard is supposed to accumulate across them. */
function applyRollover(data, ctx){
  const templates = (data.templates || []).filter(t => t && t.auto === true);

  /* Nothing flagged. Taken literally the rule says empty the board and leave it
     empty, which is indistinguishable from someone having unticked the boxes by
     mistake — and it's a bad thing to discover at 06:00. Do nothing instead. */
  if(!templates.length) return null;

  const before     = (data.tasks || []).length;
  const incomplete = (data.tasks || []).filter(t => t.status === "pending").length;

  data.tasks = templates.map(tp => ({
    id         : ctx.uid("t"),
    title      : tp.title,
    description: tp.description || "",
    createdBy  : ctx.who,
    createdAt  : ctx.now,
    status     : "pending", statusBy: null, statusAt: null, statusNote: null,
    leaderboard: tp.leaderboard === true,
    stages     : (tp.stages || []).map(s => ({
      id: ctx.uid("s"), title: s.title, description: s.description || "",
      status: "pending", by: null, at: null, note: null
    }))
  }));

  let released = 0;
  (data.plates || []).forEach(p => {
    if(p.checkedOutBy) released++;
    p.checkedOutBy = null; p.checkedOutAt = null;
    p.forcedBy     = null; p.forcedAt     = null;
  });

  return {
    removed: before,
    incomplete,
    added: data.tasks.length,
    released,
    /* The count of unfinished work is the first thing anyone asks about the
       morning after a board they didn't expect to be empty. */
    detail: `${before} task${before === 1 ? "" : "s"} removed (${incomplete} still pending), ` +
            `${data.tasks.length} rebuilt, ${released} plate${released === 1 ? "" : "s"} released`
  };
}

/* Inert in the browser — there is no `module` there. In Node this is what lets
   .github/scripts/rollover.js require the very same file the page loads. */
if(typeof module !== "undefined" && module.exports){
  module.exports = {
    ROLLOVER_GRACE_MIN, isDue, seedKey, describeNextRun, applyRollover,
    dateKeyIn, timeIn, weekdayIn
  };
}
