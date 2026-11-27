# Terminal

T3 Code includes integrated terminals running on the environment's host machine, with persistent scrollback across reconnects.

## Choose a shell

Set `T3CODE_TERMINAL_SHELL` in the T3 server's environment to an executable name or full path (no quotes or arguments) to override the platform default shell for new terminals. This does not affect agent commands or project setup/settle scripts.

Example for Git Bash on Windows (PowerShell, then fully quit and reopen T3 Code):

```powershell
[Environment]::SetEnvironmentVariable('T3CODE_TERMINAL_SHELL', 'C:\Program Files\Git\bin\bash.exe', 'User')
```

> Note: Use `bin\bash.exe`, not `git-bash.exe`. Remove with `$null` to restore the default.

## Scrollback and navigation

Each terminal retains up to **5,000 lines** and **8 MiB** of scrollback on the server.

| Action                     | macOS                              | Windows / Linux                            |
| -------------------------- | ---------------------------------- | ------------------------------------------ |
| Scroll page up/down        | `Shift+PageUp` / `Shift+PageDown`  | `Shift+PageUp` / `Shift+PageDown`          |
| Jump to start / latest     | `Cmd+Shift+Home` / `Cmd+Shift+End` | `Ctrl+Shift+Home` / `Ctrl+Shift+End`       |
| Select all retained output | `Cmd+A`                            | `Ctrl+Shift+A` (`Ctrl+A` stays shell home) |
| Next / previous terminal   | `Cmd+Shift+]` / `Cmd+Shift+[`      | `Ctrl+Alt+]` / `Ctrl+Alt+[`                |

On iOS/iPadOS, long-press the terminal to paste or choose **Select Text**.

## Agents in the terminal

In full-access threads, an agent can open a terminal in the thread's drawer, type into it, and read its output to drive an interactive program such as `psql` or a REPL. It can also use terminals you opened in the same thread. When a program asks for a password, type it into the terminal the agent names. The agent waits for the program's prompt before continuing. Terminals opened by the agent close when the thread settles.

Scripts can use `t3 terminal` on the host:

```sh
t3 terminal open --thread <thread-id> --command psql
t3 terminal wait --thread <thread-id> <terminal-id> --regex '=> $'
t3 terminal send-text --thread <thread-id> <terminal-id> $'select 1;\n'
t3 terminal read --thread <thread-id> <terminal-id> --source visible
```

## fish shell

T3 Code launches `fish` with `no-query-term` to avoid startup delays, which overrides universal `fish_features`. To keep custom flags or re-enable `query-term`, export `fish_features` in the environment that launches T3 Code.
