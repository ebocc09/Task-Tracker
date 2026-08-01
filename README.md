# Task Tracker

A shared task board for a small team. Everyone sees the same tasks, marks them
**Complete**, **Partial**, or **Could Not Complete**, and can check out a license
plate so nobody doubles up. Every action is attributed by name in an audit log.

No server, no database, no build step, no dependencies. The board data lives in
`data.json` in this repository, and the page reads and writes it through the
GitHub API.

---

## Contents

- [How it works](#how-it-works)
- [Setup (repo owner)](#setup-repo-owner)
- [Setup (each teammate)](#setup-each-teammate)
- [Using the board](#using-the-board)
- [The admin menu](#the-admin-menu)
- [What's honest about the limits](#whats-honest-about-the-limits)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

---

## How it works

```
  Marisol's browser ─┐
                     ├──►  data.json  (this repo)  ◄── the single source of truth
  Danny's browser  ──┘         ▲
                               │
  Anyone with the link ────────┘   (read-only, no setup)
```

Three roles, picked automatically:

| Role | When | Can do |
|---|---|---|
| **Viewer** | no team code saved | Read the board. Refreshes every 2 min. |
| **Member** | valid team code saved | Everything. Refreshes every 20 s. |
| **Local** | no repo configured, or GitHub unreachable | Everything, but only in their own browser. |

Local mode is the graceful fallback — open `index.html` with no setup at all and
the whole app still works against `localStorage`. A banner says so plainly.

### Concurrent edits

Two people finishing two different tasks at the same second is normal, so writes
are **replayed rather than overwritten**. Each change is a function applied to
whatever the file currently contains. If someone else saved first, GitHub returns
a conflict, the page re-reads the file, re-applies your change on top, and retries
(up to four times). Both changes survive.

Two people editing *the same* task resolves last-write-wins, which is the right
answer for this kind of board.

---

## Setup (repo owner)

**1. Create the repository and push this folder.**

```bash
git remote add origin https://github.com/YOUR-USERNAME/task-tracker.git
git branch -M main
git push -u origin main
```

**2. Point the app at your repo.** Edit `config.js`:

```js
const REPO = {
  owner : "YOUR-GITHUB-USERNAME",   // ← your GitHub username or org
  name  : "task-tracker",
  branch: "main",
  path  : "data.json"
};
```

**3. Change the admin passcode.** Also in `config.js`:

```js
const ADMIN_PASSCODE = "226565";   // ← change this
```

Read [the limits section](#whats-honest-about-the-limits) before you pick one.

**4. Turn on GitHub Pages.** Settings → Pages → Source: `Deploy from a branch`,
branch `main`, folder `/ (root)`. Your board appears at
`https://YOUR-USERNAME.github.io/task-tracker/` in a minute or two.

**5. Give teammates write access.** Settings → Collaborators → Add people.
Without this their token will be rejected no matter what the page lets them click.

**6. Commit and push those config changes.**

---

## Setup (the team code)

There is **one code for the whole team**. You create it once; everyone else
pastes it once per device.

### You, once

1. Open the board → **Admin** → passcode → **Connection**.
2. Click **Create a token on GitHub**. On that page:
   - **Token name**: anything, e.g. `task-tracker`
   - **Expiration**: your call — you'll redo this when it lapses
   - **Repository access**: *Only select repositories* → pick your repo
   - **Permissions** → *Repository permissions* → **Contents: Read and write**
     *(the only permission needed — leave everything else alone)*
3. Generate, copy, paste it into **Team code**, click **Connect**.
4. Hit **Copy** and send that code to your team.

### Each teammate, once per device

Open the link, type their name, paste the code, done. No GitHub account, no
token page, nothing to configure.

Viewing needs nothing at all — no code, no account.

### Why the code can't just be built into the site

Because GitHub would kill it. Secret scanning detects access tokens committed
to public repositories and revokes them automatically, usually within minutes.
Beyond that, anything in `config.js` is served publicly by Pages, so embedding
it would hand write access to anyone who found the URL.

So the code is distributed out-of-band — Slack, text, however you like — and
lives only in each browser's `localStorage`. It is never written into
`data.json` and never committed.

### Treat the code like a door code

Anyone holding it can change the board. If it leaks, revoke the token on GitHub
(Settings → Developer settings → Personal access tokens), generate a new one,
and redistribute. Everyone re-pastes once.

If you'd rather each person be individually revocable, skip the shared code and
have each teammate create their own token with the same settings — the app
treats them identically.

---

## Using the board

**Username** — click it any time to change your name. Every completion, checkout,
and admin action is stamped with it.

**Select Plate** — opens the list of plates. Pick one and it's yours; it greys out
on everyone else's screen with *"Checked out by …"* within one refresh. Click your
own plate again to release it. One plate per person — taking a second releases the
first automatically.

**Tasks** — click a card to open it. Three actions:

| Action | Card border turns | Prompts for a note |
|---|---|---|
| Complete | green | no |
| Partial | amber | yes — *how much got completed*, required |
| Could not complete | red | yes — *what's blocking it*, required |

Partial and Could-not-complete open a dialog and won't let you confirm until
you've typed something. Both take effect immediately — the note is there so the
audit log tells an admin the story, not to gate the change.

Click anywhere outside, or press `Esc`, to collapse. **Reopen** is different: it
sends a request to an admin for approval rather than changing the task itself.

### Staged tasks

A task can optionally be broken into ordered **stages**. The task's own title and
description **are stage 1** — clicking Admin → Tasks → **Add stage** adds stage 2,
then 3, and so on. Add none and the task behaves exactly like any other.

On a staged task the card shows one bubble per stage, and **Complete** advances one
stage at a time rather than finishing the whole thing:

```
  ●──●──○   Stage 3 of 3
  ▲  ▲  ▲
  │  │  └── not started
  │  └───── done
  └──────── done
```

- While stages remain, the task stays in the **Pending** bucket — but the pill reads
  *Stage 2 of 3* rather than *Pending*, so the board still tells you where it is.
- The final stage completing is the task completing.
- **Partial** and **Could not complete** apply to the *current stage* and stop the
  task there. Finished stages are kept, and the audit log records which stage it
  stalled on.
- **Reopen** starts the whole task over from stage 1.
- Saving a staged task to **Quick add** keeps its stages, so you can re-add the
  whole sequence in one click.

**Progress bar** — how much of the board is done, in task-equivalents. A plain
task counts once it's addressed; a staged one earns partial credit as its stages
land, so finishing 2 of 3 moves the bar by two thirds of a task. Turns green when
every task is addressed.

**Stat strip** — click any cell to filter the board. Click again to clear.

---

## The admin menu

Unlock with the passcode. Stays unlocked for that tab only.

- **Tasks** — add a task (title + optional description), reorder with the arrows,
  delete.
- **Plates** — add a plate (with an optional note like *"Model Y — bay 3"*),
  delete, or **force release** one somebody forgot to hand back.
- **Audit log** — everything that has happened, newest first, filterable by person
  and by action. Hover a timestamp for the exact time. **Export CSV** downloads it,
  and **Clear audit log** sits at the bottom of the same section.
- **Reset** — see below.

### Reset board

Sets every task back to **Pending** and releases every plate.

**Tasks, plates, and the audit log are all kept.** Resetting starts a new round;
it does not erase history. That's deliberate — an audit log you can wipe with one
button isn't much of an audit log.

One separately-confirmed destructive action lives below it: **Delete all tasks
and plates**. (**Clear audit log** lives in the Audit section, next to the log
it clears.)

---

## What's honest about the limits

**The admin passcode is not security.** In a public repo anyone can read
`config.js` and see it. It stops a teammate wandering into Admin by accident. It
stops nothing else. Don't reuse a passcode from any other system here.

**The real access control is GitHub's.** Only people you've granted repository
write access can actually save anything. Someone without it can type the passcode,
click Reset Board, and watch it fail with a 403 — because the API rejects their
token. That's the boundary that actually holds.

**Changes are not instant.** Members see each other's changes within ~20 seconds,
viewers within ~2 minutes. It's a polling loop against a file, not a live socket.

**Anonymous viewers share a rate limit.** GitHub allows 60 unauthenticated API
requests per hour *per IP*. A whole office behind one IP can exhaust that; the app
then falls back to the raw file CDN, which can be up to 5 minutes stale. It says so
when this happens. Anyone with a token is unaffected (5,000/hr, per person).

**Every save is a commit.** Your repo history will fill with `Complete "…" — Name`
commits. That's a feature for auditing and noise for browsing. `data.json` also
grows with the audit log, which is capped at the most recent 500 entries.

**Don't put anything sensitive on a public board.** Plate numbers and task text in
a public repo are readable by anyone, and git history keeps them even after
deletion. `data.json` ships empty for exactly this reason. Use a private repo if
the content is sensitive — note that Pages on a private repo needs a paid plan, so
teammates would open the file locally or you'd host it elsewhere.

---

## Project layout

| File | What's in it |
|---|---|
| `index.html` | markup only |
| `styles.css` | the ZO-1 house theme |
| `config.js` | **the only file you need to edit** — repo, passcode, poll rates |
| `sync.js` | state, GitHub read/write, conflict replay |
| `app.js` | rendering, overlays, the board |
| `admin.js` | the admin panel |
| `data.json` | the shared board data |

Plain `<script>` tags, deliberately not ES modules — modules are blocked by CORS
on `file://`, and double-clicking `index.html` should work.

### Data shape

```jsonc
{
  "version": 1,
  "updatedAt": "2026-07-31T20:14:02Z",
  "updatedBy": "Marisol",
  "plates": [
    { "id": "p_x1", "label": "8ABC123", "note": "Model Y — bay 3",
      "checkedOutBy": "Marisol", "checkedOutAt": "2026-07-31T19:02:00Z" }
  ],
  "tasks": [
    { "id": "t_a2", "title": "Pre-delivery inspection",
      "description": "Panel gaps, paint, badge alignment.",
      "createdBy": "Danny", "createdAt": "2026-07-30T15:00:00Z",
      "status": "complete",        // pending | complete | partial | blocked
      "statusBy": "Marisol", "statusAt": "2026-07-31T19:40:00Z",
      "statusNote": null,
      "stages": [] }               // empty = an ordinary one-step task
  ],
  "audit": [
    { "id": "a_b3", "at": "2026-07-31T19:40:00Z", "who": "Marisol",
      "action": "task.complete", "subject": "Pre-delivery inspection", "detail": "" }
  ]
}
```

The app re-validates this on every read, so a hand-edited or malformed file
degrades gracefully instead of breaking the page.

---

## Troubleshooting

**Chip says `READ ONLY` and I entered the code** — it was rejected. Re-enter it
via **USERNAME**, or **Admin → Connection**. Most often the token expired, was
copied incompletely, or wasn't scoped to this repository.

**"That token can't write to this repo"** — either the token is missing
**Contents: Read and write**, or you haven't been added as a collaborator.

**"Repository or data.json not found"** — `REPO` in `config.js` doesn't match
reality, or `data.json` was never pushed.

**My change vanished a few seconds later** — the save failed and the page rolled
back to the server's version. A toast explains why.

**Board is empty for everyone after a reset** — Reset Board keeps tasks. If they're
actually gone, someone used *Delete all tasks and plates*. Check the audit log for
a `board.wipe` entry, and recover `data.json` from the repo history:
`git log -- data.json`.

**Nothing works and there's a yellow banner** — you're in local mode. Either
`config.js` still has the placeholder owner, or GitHub couldn't be reached.

---

## License

MIT — see [LICENSE](LICENSE).
