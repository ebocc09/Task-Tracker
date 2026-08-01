/* ============================================================================
   Task Tracker — configuration
   ----------------------------------------------------------------------------
   This is the ONLY file you need to edit after cloning.
   ========================================================================== */
"use strict";

/* Bump on every deploy, and match the ?v= on the script tags in index.html.
   Shown in the footer and logged at boot, so "which build am I actually
   running?" is answerable at a glance instead of by guesswork. */
const BUILD = "9";

/* Which repository holds the shared board data.
   Point this at your own repo, then commit and push. */
const REPO = {
  owner : "ebocc09",
  name  : "Task-Tracker",
  branch: "main",
  path  : "data.json"
};

/* Admin passcode.
   ---------------------------------------------------------------------------
   HONEST WARNING: in a public repository this value is readable by anyone who
   views the source. It is friction against accidental edits by teammates, NOT
   security. The real protection is GitHub itself — only people you grant repo
   write access to can actually save a change, because the API rejects everyone
   else's token regardless of what this page lets them click.

   Do not reuse a passcode from any other system here. */
const ADMIN_PASSCODE = "226565";

/* How often to re-read data.json, in seconds.
   Members are authenticated (5000 req/hr) so they can poll briskly.
   Viewers are anonymous and share a 60 req/hr pool per IP — hence the gap. */
const POLL_SECONDS = { member: 20, viewer: 120 };

/* Keep at most this many audit entries so data.json cannot grow forever. */
const AUDIT_CAP = 500;

/* Give up on any single request after this long. Guards against corporate
   proxies that swallow a request without ever answering it. */
const REQUEST_TIMEOUT_MS = 15000;

/* localStorage keys. Namespaced so two dashboards on the same host don't clash. */
const LS = {
  name : "tt.username",
  token: "tt.token",
  local: "tt.localdata"
};
