# Working with threads

Use a separate thread for each task. Choose **New worktree** when a task needs its own Git branch and working directory; threads sharing a checkout share its branch, so T3 Code blocks branch switches while one is running.

## Start a thread

- **Web and desktop**: **New thread** opens the project picker when you have multiple open projects (unless the sidebar is filtered to one project). `Shift`-click to start in the current project. To reuse an existing worktree, choose **New thread in this worktree** from the branch toolbar.
- **Mobile**: **New thread** uses the current, filtered, or last-opened project. Disable **Settings → General → Use last project** to pick every time.
- **Defaults**: New threads inherit your last model and mode unless the project sets its own model default.

### Start without a project

Threads don't require a project. Pick **No project** (or press `mod+alt+n` on web/desktop) to start a scratch thread in `~/.t3/scratch/<date>-<slug>-<id>`.

- Deleting a scratch thread leaves its folder on disk.
- Git branch, worktree, and diff controls are hidden (and scratch threads are unavailable if your T3 data directory itself is inside a Git repo).
- Choose **Turn into project** from the thread menu to promote the folder into a real project in place, then **Initialize Git** if needed.

### Continue a terminal conversation

On web and desktop, right-click a project in the sidebar and choose **Import CLI
conversation…**, or use **Import CLI conversation into…** in the command palette.
It lists the Claude Code, Codex and Pi conversations that ran in the project's
folder on its machine, newest first. Pick one to import it as a thread, or
**Open** one already in T3 Code.

The thread keeps up to 200 messages of text, without tool activity or
attachments. Your next message continues the same conversation in that agent.
On that first message T3 Code also sends a copy of the imported history once.
The original transcript is not changed. A conversation whose thread you deleted
cannot be imported again.

### Start in the background and multi-model runs

- **Background start** (web/desktop): Press `Cmd+Enter` (macOS) or `Ctrl+Enter` (Windows/Linux) in a new thread to submit it and immediately open another draft with the same workspace mode and base branch.
- **Same prompt, multiple models** (web/desktop, Git projects): `Shift`-click models in a new thread's model picker to select several. Sending starts a separate thread and worktree for each model.

## Sidebar layout and organization

- **Resize or hide** (web/desktop): Drag the sidebar's right edge past its minimum width to hide it; hover the left window edge and click or drag the handle to bring it back.
- **Drop files onto a thread** (web/desktop): Drag files from your computer onto any thread row to open it and attach them to its composer.
- **Pin and reorder**: Pin a thread from its menu or drag threads between **Pinned**, **Active**, and **Settled** (or drag out of **Snoozed** to wake). On mobile, use **Arrange threads** or **Move up / Move down** in the thread menu. Custom order syncs across devices (requires an up-to-date server).
- **Undo** (web/desktop): Unpinning, settling, snoozing, archiving, or discarding a draft shows a 5-second **Undo** toast (`mod+z`).
- **Titles**: Choose **Regenerate title** from a thread's menu, or customize title style in **Settings → Threads → Text generation → Thread title instructions** (global or per-project).
- **Dock menu** (macOS desktop): Right-click the T3 Code icon to open a thread that needs your approval or input, has failed, or finished since you last viewed it. The menu includes threads from every connected environment while the app window is open, including when it is minimized or hidden.

### Working section (beta)

Enabled by default (**Settings → General → Working section**, per device). Unpinned threads that are actively running—or waiting on subagents, watched PRs, or monitors—collapse into a **Working** section below Active, and return to the top of Active when they finish, fail, or need input.

While enabled, Active is sorted by most recent return (manual reordering is paused until you turn it off).

### Group threads by project (beta)

Enable **Settings → Labs → Boring sidebar (group by project)** on web/desktop (per device) to group active threads into collapsible project folders. Pinned threads stay above; Snoozed and Settled stay below. In this mode, the Working section and sidebar drag-reordering are disabled (dragging a thread onto the composer still works).

To keep folders in a fixed order, choose **Manual** under **Settings → General → Project order** and drag projects into place in **Settings → Projects**.

## Tag threads

Tags group threads that belong together across projects and states, such as `review`,
`auth`, or `later`. A thread can carry several tags, and forks keep them.

Open a thread's menu and choose **Tags…**. Check or uncheck as many tags as you like, or
type to search and create a new one; press Esc or click away when done. On web and
desktop, clicking a thread's tags in its header and **Edit tags** in the command palette
open the same list. Tags ignore case, so `bug` and `Bug` are one tag, and a tag keeps the
spelling it was first created with. Tags are up to 64 characters.

To rename or delete a tag everywhere, open **Settings → Threads → Tags** on web and desktop, or
**Settings → Tags** on mobile. Both change every thread on that machine, archived ones too, and
renaming onto an existing tag merges the two.

Three tags are always offered, even before any thread carries them: `critical`, `background`,
and `private`. Besides those and the tags you placed in settings, the tag picker only suggests
tags of threads that are not settled or archived. In the same settings page you can give each tag a color and move it up or down;
tags show in that order everywhere, and tags you have not placed follow alphabetically. Order
and colors are saved on the machine, so every device connected to it agrees.

To show only tagged threads, pick a tag in the sidebar's filter menu, which lists tags
below projects and searches both, or use **Filter sidebar by tag** in the command palette.
On web and desktop, a click picks one tag; Shift+click adds or removes a tag and keeps the
menu open. The sidebar shows threads with any of the picked tags, inside the picked
projects. Typing a project or tag name in the sidebar search on web and desktop also lists
it above matching threads; pick it to filter the same way. Clear the filter with its **×**
button or **Clear tag filter**. On mobile, use the
**Tag** option in the thread list's filter menu, and choose **All tags** to clear it.
Each device remembers its own filter.

Agents can tag their own thread or another one with `t3_thread_organize`, so you can
ask an agent to "tag this thread `review`". Threads an agent starts can carry tags from
the start, and scripts can tag threads with `t3 thread tag`.

Tags need a server version with tag support. On older servers, the tag controls are
hidden.

## Working-on line

A thread can show one line naming the task it works on now, such as a ticket or bug. It
appears after the title in the thread header, and on web and desktop under the title in the
two-line sidebar layouts; the compact sidebar shows it when you hover the thread. Agents set it
on multi-step tasks and clear it when the task is done. To set, change or clear it yourself,
click the line in the header or choose **Set working-on line…** from the header's thread menu,
then press Enter; an empty line clears it. Scripts use `t3 thread working-on "$id" "…"` or
`--clear`.

When the thread's own agent clears its line and the run ends, the timeline shows **Task looks
done** with **Settle** and **Continue**. Continue dismisses it on every device. Clearing the line
yourself or from a script does not offer to settle.

## Settle, snooze, and archive

| Action      | When to use          | Effect                                                                                                                                                  |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settle**  | Task is done for now | Moves to **Settled**; stays searchable; any new message reactivates it. Closes idle terminals (and stops actions with `stopOnSettle: true`).            |
| **Snooze**  | Defer until later    | Hides until wake time (thread keeps working in the background). Wakes early on approvals, questions, errors, or new messages.                           |
| **Archive** | Out of the way       | Leaves sidebar and search; lives in **Settings → Archived threads**. Refuses new messages (including from agents and scheduled tasks) until unarchived. |

> Tip: If a scheduled task targets a thread, settle it instead of archiving—archiving causes scheduled runs to fail.

### Settlement rules and hooks

- **Automatic settlement**: By default, environments settle threads after 7 days of inactivity or when their linked PR merges/closes (even while your apps are closed). Active work, pending questions/approvals, and waited-on background work block auto-settlement. Configure rules in **Settings → Threads** (per environment or **All environments**), including **Keep threads with a PR**.
- **Per-thread override**: Open a thread's menu → **Auto-settle behavior → Never** to exempt a single thread.
- **Drag-to-settle** (web/desktop): Press and drag down/up from a thread's **Settle**, **Un-settle**, or **Wake** button to act on a contiguous range (`Esc` cancels).
- **Offline settle/snooze**: Queues locally (**Pending** / **Waiting to sync**) and syncs on reconnect; remote changes take precedence if the thread changed in the meantime.
- **Worktree cleanup on settle**: Enable **Run in the thread's worktree when the thread settles** on a project action (or `"runOnSettle": true` in `t3.json`), e.g. `cargo clean`, to reclaim disk space automatically in worktree threads.

### Snooze options

Customize presets in **Settings → Threads → Snooze options** (durations like `3 hours` or times like `9:00 PM tomorrow`), or pick **Snooze → Custom…** for an exact date/time or duration. Choose **Wake thread** to bring a thread back early.

### Clean up archived threads

**Settings → Archived threads** lists archived threads by project. On web and desktop,
**Delete all** next to a project deletes its archived threads, and **Delete all archived
threads** deletes every archived thread in the selected scope. Both ask once and cannot be undone;
their worktrees stay unless worktree cleanup on delete is on.

You can also [archive settled threads and delete archived threads automatically](./project-settings.md#archive-or-delete-inactive-threads).

## Link a pull request

The server automatically links open PRs matching an unsettled thread's branch. On web/desktop, right-click any PR link in a thread and choose **Link to thread** or **Unlink from thread** to override it. Linked PRs participate in auto-settlement.

## Find and reference work

- **Command palette** (`Cmd/Ctrl+K`): Searches threads across connected environments by title, branch, PR, project, and message contents (use `"exact phrase"` for exact matches). On mobile, use the thread list search (or `Cmd+K` on iPad with a keyboard).
- **Copy reference**: Copies the linked PR URL if one exists, otherwise a thread link that pastes into any composer as a thread chip. Use **Copy → Thread** (or **Copy thread** on mobile) to force a thread link, or **Thread ID** for scripts and the `t3` CLI.

## Usage limits, subagents, and thread details

- **Usage limits**: When a provider hits a rate/usage limit (**Limited**), press **Resume** in an empty composer after reset (or send a message). If the provider reports a reset time, choose **Resume at reset** or **Snooze until reset**—or enable defaults in **Settings → Threads** (**Resume after usage limits** / **Snooze until limits reset**).
- **Pace limits**: Turn on **Pause background work ahead of pace** in **Settings → Threads** to defer agent-started and scheduled turns, including all turns tagged `background`, while usage is more than the configured number of points ahead of even pace. Paused turns start once usage comes back within the threshold. **Pace limits by tag** applies even with the main setting off. The lowest matching tag limit wins. Threads tagged `critical` always run unless you set a limit for that tag.
- **Subagents**: Follow delegated work from the conversation card or **Agents**. Stopping a parent thread also stops its delegated subagents. Subagents started internally by the provider are read-only; message the parent thread instead.
- **Running dev servers** (web/desktop): The thread details card lists local servers started by the thread's terminals or Claude agent with their ports. Click one to open it in the browser panel, or **Stop** to end it (macOS/Linux only).
- **Customize thread details**: Right-click the thread details card or open **Settings → Appearance → Thread details** to show/hide rows.

## Open a thread beside the one you are in

On web and desktop, subagents, side chats, and [threads on linked machines](./remote-access.md#read-a-linked-machines-threads) open as a tab in the right panel by default so your main thread stays visible.

- Hold `Cmd`/`Ctrl` while clicking (or middle-click) to open in the main view instead.
- Change the default in **Settings → Chat → Open subagents and side chats in**.
- From a right-panel tab, choose **Open in main view** to promote it.
- On mobile, they open in the inspector where available, or full screen otherwise.

## Side chats

Ask a quick side question about a thread without polluting its history. A side chat starts with the parent thread's context, folder, model, and permissions while the parent keeps working.

- **Start** (web/desktop): Send `/side <question>` or `/btw <question>`, or choose **Side chat** from the right panel's **+** menu.
- **Find later**: Listed under **Side chats** in thread details (web/desktop) or above the composer (mobile); hidden from the main sidebar.
- **Bring results back**: Click **Add to chat** in the side chat, or `@`-mention its title in the parent composer (not readable by external OpenCode servers).
- **Lifecycle**: Closing an unused side chat deletes it. Deleting or archiving the parent thread deletes or archives its side chats.
