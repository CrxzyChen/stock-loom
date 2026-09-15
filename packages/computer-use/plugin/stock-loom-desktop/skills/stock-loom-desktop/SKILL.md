---
name: stock-loom-desktop
description: Observe and operate authorized Windows applications through Stock Loom's desktop MCP tools, including screenshots, controls, typing and dragging. Use for application interaction; prefer the browser tools for ordinary web research.
---

# Desktop interaction

Use the `stock_desktop` tools available in the current turn. Stock Loom supplies the connection and application grants. Do not edit permission files or launch an alternative automation bridge to bypass a denied request. An empty window list may mean the feature is disabled, no apps are authorized, or the authorized apps are closed; report the actual tool result and, when necessary, direct the user to Settings → Tools and MCP → Computer Use.

## Execution

`execute({code})` runs an async JavaScript cell and returns an execution ID. Use `wait({executionId,waitMs})` until its state is completed, failed or cancelled. It does not replay the action. Images arrive as MCP image blocks; inspect them before choosing coordinates. `reset({})` stops pending work and clears variables and old references; it does not undo earlier clicks or edits.

An input call completing means the API accepted the operation, not that the application completed the intended change. Observe the target again before claiming success. Another process or the user can change focus after dispatch; a focus error may therefore describe an uncertain action, not a guaranteed no-op. Do not automatically resend it.

Use `globalThis` for references needed in a later cell. Await every desktop operation. The environment has no Node, filesystem or network globals. A cell has a 30-second limit; maximum VM memory is 32 MiB, and at most eight images / 8 MiB can be returned in one cell. Keep cells small enough to observe the result before deciding the next action. Never start background loops.

Begin with:

```javascript
globalThis.windows = await desktop.listWindows();
return windows;
```

Select a window using its returned ID and the user's intended application/document. Do not assume the first window is the target. Save the selected reference as `globalThis.target`, then observe:

```javascript
globalThis.view = await desktop.inspectWindow({window: target});
return view;
```

An application can contain restored tabs or unrelated documents. Its authorization is not an instruction to edit those documents. Confirm the active document before writing; preserve existing user material and close only the window or tab created for the task when cleanup is needed.

## Desktop API

- `listWindows({})`: current visible windows of authorized applications, including untitled owned popups. If a search/dropdown result is missing from the main-window screenshot, enumerate again and inspect the popup separately; do not guess coordinates from the main window.
- `inspectWindow({window})`: current title, `snapshotId`, `elements`, physical screen `bounds` and `screenshotBounds`, and screenshot dimensions. The screenshot is returned separately as an MCP image.
- `setValue({window,snapshotId,elementId,text})`: UI Automation Value pattern, for supported editable controls.
- `invokeElement({window,snapshotId,elementId})`: perform the supported default control action: Invoke, otherwise SelectionItem.Select, otherwise Toggle. Inspect the result before issuing another action; toggles are not idempotent.
- `typeText({window,snapshotId,elementId,text})`: focus that control and deliver character messages to its verified HWND; does not clear existing contents automatically. Unicode controls accept UTF-16; ANSI controls accept ASCII and, only when explicitly supported by the control, WM_UNICHAR Unicode. Unsupported Unicode is rejected before any text is written. This inserts characters, not physical key presses or IME composition. Some custom controls ignore character messages: inspect the result and use a supported control pattern; never assume successful delivery means the text was accepted.
- `pressKey({window,snapshotId,elementId?,keys})`: one key with optional CTRL, ALT, SHIFT modifiers, e.g. `["CTRL","S"]`. Supply the observed `elementId` for a specific search/edit control so activation cannot redirect the key to the window root. Supported keys include letters, digits, ENTER, TAB, ESCAPE, BACKSPACE, DELETE, SPACE, arrows, HOME, END, PAGEUP, PAGEDOWN.
- `click({window,snapshotId,x,y,button})`: click screenshot coordinates; button is `left` or `right`.
- `scroll({window,snapshotId,x,y,delta})`: wheel at screenshot coordinates; 120 units per notch, positive up, negative down.
- `drag({window,snapshotId,from:{x,y},to:{x,y}})`: short left-button drag between screenshot coordinates. This is not a long press or timed drag API.

Prefer supported control patterns. Coordinate actions use image pixels, not screen pixels. For an observed screen point `(sx,sy)`, convert using `x=(sx-view.screenshotBounds.x)*view.screenshot.width/view.screenshotBounds.width`, and similarly for y. Only use points observed in the current screenshot or control bounds.

## Verify and recover

Controls and coordinates belong to the current snapshot and expire after 30 seconds. Reinspect after layout changes, window movement or a stale-reference error. `FOCUS_CHANGED` means the target did not receive focus or another window covers the operation; do not claim the action happened. `ACCESS_DENIED` is a tool/permission limitation, not evidence that the user clicked Decline.

A clicked popup may close before the next screenshot: enumerate and inspect its main window to verify the result, rather than replaying the click. A hidden window returns `WINDOW_GONE`. `FOCUS_STATE_UNCERTAIN` recycles the execution worker; reset and observe again. Activation does not authorize unrelated windows or bypass application grants.

A locked or disconnected session does not by itself decide whether an operation can work. Use the authorized tools and report their actual results, including in scheduled tasks. Successful enumeration only proves window discovery, not capture or input. On a capture, focus, permission or timeout error, report the failed operation and its concrete reason; do not claim all desktop capabilities are unavailable or replay uncertain input. Earlier actions in the same cell may already have happened.

Input submission is not proof that the application has finished processing it. Inspect the result; if necessary, observe again without replaying the write. After a timeout, disconnect or cancellation, reset and inspect before deciding whether any action remains necessary. Earlier actions may already have completed.

Password controls can be written when the user explicitly authorizes authentication to the named application. Use only credentials supplied for that purpose; do not discover or extract stored credentials. Never put credential values in files, logs, summaries or screenshots. The observation API keeps password names/values redacted. Do not copy passwords or unrelated private data from restored tabs. Screenshots are transient by default; retain research results using the project's ordinary files only when relevant to the user's task, with source and date where applicable.

On failure, read `completedActions` and `uncertainActions` before continuing. Indices count desktop calls within the current cell. A completed call only confirms tool completion, not the application outcome. `retryable:false` means do not replay automatically: observe again, especially after cancellation or a timeout. Summaries contain method names and indices only; the last 64 completed calls are retained with a total count.
