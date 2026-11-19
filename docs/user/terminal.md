# Terminal history

Each terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. T3 Code removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when T3 Code restores saved terminal
history. A client can show less scrollback than the server keeps.

On web and desktop, use Shift+PageUp and Shift+PageDown to read scrollback
without leaving terminal input. Ctrl+Shift+Home and Ctrl+Shift+End jump to the
start and latest output; use Cmd instead of Ctrl on macOS. Full-screen terminal
programs keep these navigation keys.

To copy all retained output, choose Select all in the terminal's context menu,
then copy. Cmd+A on macOS and Ctrl+Shift+A elsewhere select the same output.
Ctrl+A still moves to the beginning of shell input on Windows and Linux.
Jump to latest in the context menu returns to the current output.

On iPhone and iPad, long-press the terminal to paste or to choose Select Text.
Select Text shows the visible output, where you can copy text or tap a link.

## Agents in the terminal

In full-access threads, the agent can open a terminal in the thread's drawer,
type into it, and read what it shows, so it can drive interactive programs such
as `psql` or a REPL. It can also use terminals you opened in that thread. When a
program asks for a password, the agent tells you which terminal to type it in;
it waits for the program's prompt and then carries on. Terminals the agent
opened close when the thread settles.

Scripts can do the same with `t3 terminal`, for example:

```sh
t3 terminal open --thread <thread-id> --command psql
t3 terminal wait --thread <thread-id> <terminal-id> --regex '=> $'
t3 terminal send-text --thread <thread-id> <terminal-id> $'select 1;\n'
t3 terminal read --thread <thread-id> <terminal-id> --source visible
```

## fish

T3 Code starts fish with `no-query-term`, avoiding startup waits for terminal
replies. This disables optional fish features that depend on those replies.
T3 Code's exported `fish_features` also hides any universal flags you set with
`set -U fish_features`.

To preserve those flags or enable queries with `query-term`, include them in
`fish_features` in the environment that launches T3 Code. A shell export applies
when you launch T3 Code from that shell; it does not configure a desktop app
launched from the Dock or Finder. Enabling queries can restore the startup wait.
