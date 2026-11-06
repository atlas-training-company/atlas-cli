# Atlas

The Atlas CLI connects agents to your training account. Read your goals, gym notes, programs, and workout history; author plans and log training with explicitly approved access.

## Install

Requires Node.js 22 or newer.

```sh
npm install -g @atlas-training/cli
atlas help
atlas --skill
```

The package is `@atlas-training/cli`; the command is always `atlas`. To run without a global installation:

```sh
npm exec --yes --package=@atlas-training/cli@latest -- atlas help
```

## Connect

Install or upgrade the CLI, then run:

```sh
atlas connect
```

Open `data.approval_url` from the JSON result on your phone, check that it shows the same `data.code`, and approve full training access once. The approval covers all current training API operations, including your profile, gym notes, plans, workouts, import, and export. It does not grant account administration or device control. Installation and a pending connection grant no training access.

After approval, run the same command again:

```sh
atlas connect
atlas --skill
```

Follow returned `data.next_command` commands to preserve your actual executable, Node launch flags, working directory, origin and credential directory without a registry download. The connected result identifies your account in `data.account`. Repeating `atlas connect` reuses the saved connection. To wait for approval for up to 120 seconds, use `atlas connect --wait 120`. Approval remains active until you disconnect it or stop using it for 30 days. Approval links last ten minutes; that limits setup, not the connection's lifetime.

If the Atlas app gave you a one-time setup link (`/c/CODE`) or a trainer invite (`/invite/CODE`), connect with the code instead. The person approved access when they made it, so it connects at once:

```sh
atlas connect --invite CODE
```

The CLI connects to hosted Atlas at `https://atlas.training` by default. For another Atlas server, keep its exact origin on every network command, or set `ATLAS_URL` to that origin; `--url` overrides that setting. For local development:

```sh
atlas --url http://127.0.0.1:3000 connect
```

Remote connections require HTTPS.

Credentials stay private on the agent's machine under `~/.config/atlas`, with a separate connection per origin. Never put tokens in chat replies, logs, or version control. Disconnect an agent in the Atlas app's **Agents** screen or run `atlas auth logout` with the same origin. Full training access does not authorize unrelated work; agents must stay within your requested task.

An agent key from the Atlas app works as `ATLAS_API_TOKEN` when connecting is not possible. A connection from `atlas connect` takes priority over it.

## Agent handbook

The training handbook and research library ship with the CLI and work offline, before sign-in. The CLI also keeps a daily copy of Atlas's current library, so skills and guides stay current between releases, and a folder written by `skills install` follows it, including on every `atlas update`:

```sh
atlas --skill
atlas skills list
atlas skills install ~/.claude/skills
atlas knowledge list
atlas knowledge get guides/connect
atlas knowledge search --query '{"q":"hypertrophy volume","limit":5}'
atlas knowledge get guides/safe-mutations
```

The agent supplies coaching and programming judgment. Atlas validates, versions, and stores records. It never controls exercise equipment or changes training merely to test a connection.

## Programs and precise writes

The CLI has `profile write`, catalog `replace`, `sessions start` and `sessions patch`. Catalog replacement is a full PUT; session patches preserve omitted fields. Existing `update` and `sessions create` spellings retain identical requests as hidden aliases.

```sh
atlas programs list --query '{"visibility":"shared"}'
atlas programs get atlas:program:bodyweight-3
atlas programs copy atlas:program:bodyweight-3 \
  --data '{"id":"my-program","source_revision":1}' --idempotency-key program-copy-001
```

Program lists default to private and shared programs; status alone implies private. An explicit visibility filter is preserved. Copy uses a separate source ID and destination `id`, defaults to an unscheduled private draft and creates no session. Inspect `schema copy_program` for optional scheduling and activation. Generic `call` executes only discovered public operations.

## Historical workouts

Import another app's whole workout export (Strong, Hevy, Fitbod, a spreadsheet) with one command. It matches every exercise name and imports every workout; a file over 1 MiB is sent in parts that keep each workout whole:

```sh
atlas sessions import-file --file export.csv --data '{"source":"strong"}' --query '{"dry_run":true}' --idempotency-key strong-export-001
atlas sessions import-file --file export.csv --data '{"source":"strong","exercises":{"NAME":"EXERCISE_ID"}}' --idempotency-key strong-export-001
```

Choose an exercise for every name the preview marks `confirm` (or `null` to keep it as your own); until then nothing is written. Repeat the same command to retry. For reviewed payloads built by hand, these commands import one completed workout per request:

```sh
atlas schema import_session
atlas exercises ensure --file exercises.json --idempotency-key history-exercises-001
atlas sessions import --file session.json --query '{"dry_run":true}' --idempotency-key history-workout-001
atlas sessions import --file session.json --idempotency-key history-workout-001
atlas sessions import-status --query '{"provider":"source","namespace":"account","external_id":"workout"}'
```

Read `atlas knowledge get guides/history-metrics` for the payload contract. Import one historical workout and all its sets atomically, without supplying a program or workout object. Stable source IDs prevent duplicate imports; dry runs validate without saving, so a large backfill can commit each workout directly after checking a sample. Preserve unknown observations and apparatus-specific exercise identities. Retain the mapping from earlier manual imports and reconcile those records before resuming them through this endpoint.

## API discovery and output

```sh
atlas --url ATLAS_ORIGIN discover
atlas --url ATLAS_ORIGIN schema write_set
atlas --url ATLAS_ORIGIN sessions list --query '{"limit":20,"sort":"recent"}'
atlas --url ATLAS_ORIGIN weekly-summary
atlas --url ATLAS_ORIGIN body-weights list --query '{"limit":5}'
atlas --url ATLAS_ORIGIN activities list --query '{"from":"2026-10-12"}'
```

Commands emit one JSON envelope on stdout, except `atlas --skill` and `atlas skills get`, which print Markdown. Exit status is zero on success and one on failure. A successful `connect` result with `data.status: "approval_required"` still requires browser approval; `data.status: "connected"` confirms the account. Mutations require approved access and an idempotency key; updates also require the documented revision precondition. After an uncertain write, retry the identical request with the same key. The CLI does not automatically retry writes or overwrite stale revisions.

Update the CLI and its bundled knowledge with `atlas update`. Once a day, results from Atlas include an `update` field when a newer version is on npm; set `ATLAS_NO_UPDATE_CHECK=1` to turn that check off. A copy installed some other way updates with `npm install -g @atlas-training/cli@latest`.

## About this repository

This is a read-only copy of the Atlas CLI, made from the Atlas monorepo at commit `474fb2b2` on each release. Changes
made here are replaced by the next sync. Install the CLI from npm as `@atlas-training/cli`, or build it here with
`npm install && npm run build`.
