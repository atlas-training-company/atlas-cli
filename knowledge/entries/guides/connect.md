# Connect and identify the athlete

Use this guide before authenticated work on a new host/origin or when access fails. Reuse existing authorization and private credentials for later tasks.

## Establish or resume the connection

Install or upgrade `@atlas-training/cli`, then run `atlas connect`, adding `--url EXACT_ORIGIN` when the user supplied another Atlas server. Use the actual installed executable path if it is not on PATH. The default is hosted Atlas. Never guess a different origin or substitute credentials after an access denial.

If the athlete gave you a one-time setup link from their Atlas app (`/c/CODE`) or a trainer invite (`/invite/CODE`), run `atlas connect --invite CODE` instead. They approved it when they made it, so it connects at once, under the name it was made for and with the access it grants; a used or expired code returns `invite_unavailable`, so ask them for a new one.

If approval is needed, `connect` returns `data.approval_url` and a short `data.code`. Give the athlete both. They open the link on their phone or any signed-in browser, check that the code matches, and tap **Allow**; never approve on their behalf. Run the same command after approval, or use `connect --wait SECONDS` for a bounded wait. Report success only when `ok` is true and `data.status` is `connected`, then verify the returned account matches the intended athlete. Follow `data.next_command` to read the training workflow.

The default copyable prompt is **Connect to my Atlas: [server]/skill.md and check in with me after each workout.** The skill's **After a workout** section says how to set up that check-in: an MCP Events subscription to `workout.finished` where the app supports it (renewed within a day, plus `program.changed` for a planning agent), otherwise an evening check of the day's completed sessions. The public link describes setup for that origin and contains no credential. Approval links last ten minutes; rerunning `connect` resumes a waiting request or starts a fresh one. Approved connections persist until disconnected in the Atlas app's **Agents** screen (or the website's **Agent access**) or after 30 days unused. A declined or ended connection needs the athlete's new approval, so ask before running `connect` again.

Full access includes profile, gym notes, plans, workouts, and training import/export. It excludes account administration and device control. Technical approval does not authorize unrelated work: stay within the user's requested task. Keep the private configuration file and do not change training records just to verify setup.

An agent key from the athlete's Atlas app can be supplied as `ATLAS_API_TOKEN` instead. A connection from `connect` takes precedence over it, and a refused connection never silently falls back to the key. `auth status` reports the connected account; `auth logout` ends this computer's connection in Atlas.

Returned `connect` continuations reuse the actual Node executable/entrypoint and launch flags, working directory, origin and credential directory. They do not download a package. Keep using the same private configuration for later work.

## Discover and interpret operations

```sh
atlas discover
atlas schema read_profile
atlas schema write_set
atlas call list_session --data '{"limit":10,"sort":"recent"}'
```

`schema` without an operation returns OpenAPI. Named schemas describe flat arguments for `call`, including path IDs, filters, body, and preconditions. Prefer a convenient alias when available, but use `call` for every implemented operation without one.

Inputs use `--data JSON` or `--file PATH` (`-` for stdin), never both. Queries use `--query JSON`. API success has `ok:true`, `operation`, `status`, `data`, and optionally `etag`, `request_id`, and `replayed`. Failures have `ok:false`, `error.code/message/details`; exit status is 1. Do not mistake JSON output for success without inspecting `ok`. Preserve relevant error details and follow `atlas knowledge get guides/safe-mutations` for write failures.
