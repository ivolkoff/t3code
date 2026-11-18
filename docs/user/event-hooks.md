# Event hooks

Event hooks run a shell command on the machine that runs a T3 Code server when one of its
threads starts a turn, finishes, fails, or needs your approval or input. Use them to play a
sound, post to Slack or Telegram, or append to a log. Hooks run whether or not a client is open.

To add one, open **Settings → Threads**, choose one environment, and use **Event hooks**. Pick an
event, enter a command, and save. **Test** runs the row's command right away with a test event,
even before you save, and shows the result under the row. Each row shows its last run: exit code
or timeout, duration, and the end of its output. Last runs are kept until the server restarts.

Editing hooks needs permission to change the environment's settings. Every paired client can read
the commands, so keep secrets out of them: read them from the server's environment instead.

## Events

| Event                | When it runs                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| `turn.started`       | A turn starts. Resuming after an approval does not count as a new turn. |
| `approval.requested` | The agent asks for approval. Each request runs the hook once.           |
| `input.requested`    | The agent asks you a question.                                          |
| `turn.completed`     | The thread finished and did not continue for 5 seconds.                 |
| `turn.failed`        | The turn failed.                                                        |

With queued messages, `turn.started` runs for each turn and `turn.completed` only after the last
one, and a very short turn may skip `turn.started`. Snoozing, settling or archiving a thread does not silence its hooks. Hooks cover threads in
the sidebar: an approval a subagent waits on does not run the parent thread's hook.

## What the command receives

The command runs in `/bin/sh -c` (on Windows, `cmd.exe /c`; not yet verified there) in the
server's working directory. The event arrives as one line of JSON on stdin:

```json
{
  "version": 1,
  "event": "turn.completed",
  "test": false,
  "occurredAt": "2026-11-18T10:00:00.000Z",
  "environmentId": "…",
  "thread": {
    "id": "…",
    "title": "Fix login",
    "projectId": "…",
    "branch": "t3/fix-login",
    "worktreePath": "/…/worktrees/fix-login",
    "runId": "…"
  },
  "project": { "id": "…", "title": "web", "workspaceRoot": "/Users/…/web" },
  "request": null,
  "error": null
}
```

`request` (`id`, `kind`) is set for `approval.requested` and `input.requested`, and `error`
(`message`) for `turn.failed`. The server's environment is passed on, plus `T3_EVENT`,
`T3_THREAD_ID`, `T3_THREAD_TITLE`, `T3_PROJECT_ID`, `T3_PROJECT_TITLE`, `T3_CWD` (the worktree, or
the project folder), `T3_ENVIRONMENT_ID`, and `T3_TEST` (`1` for a test run). Agents write thread
titles, so quote these variables: `"$T3_THREAD_TITLE"`.

## Examples

```sh
# Post the event to a Slack webhook whose URL is set in the server's environment
curl -s -H 'Content-Type: application/json' -d @- "$SLACK_WEBHOOK_URL"

# macOS notification
terminal-notifier -title "$T3_PROJECT_TITLE" -message "$T3_THREAD_TITLE: $T3_EVENT"

# Append every event to a log
cat >> ~/t3-events.jsonl
```

## Limits

- A run is stopped after 30 seconds and shows as timed out, without output.
- The run ends when its output closes, so start long-lived programs detached:
  `my-app >/dev/null 2>&1 &`.
- At most four hooks run at once; the rest wait their turn.
