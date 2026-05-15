# pi-footer-fixed

Pi Agent extension that keeps the editor/input cluster fixed at the bottom of the terminal while chat output scrolls above it.

Based on the Fixed editor cluster idea from [`nicobailon/pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer).

## Install

```bash
npm install
npm run validate
pi install -l D:/Study/Code/Node/pi-footer-fixed
```

## Task completion notification

On native Windows, and on Windows 11 WSL with `powershell.exe`/WSL interop available, the extension sends a Chinese toast notification when the main interactive Pi Agent finishes a task and waits for input.

Subagent processes are skipped via the `PI_SUBAGENT_*` environment markers used by `pi-subagents`, with a JSON print-mode fallback guard. The notification can be disabled in `/footer-fixed` via `Task completion notification`. If no toast appears in WSL, check `command -v powershell.exe` and Windows notification / Do Not Disturb settings.

## Settings UI

```text
/footer-fixed
```

Opens a settings panel with:

- Fixed editor
- Mouse scroll
- Extension status
- Task completion notification
- Collapse plugin outputs

## Settings file

Global: `~/.pi/agent/settings.json`

Project: `.pi/settings.json`

```json
{
  "footerFixed": {
    "fixedEditor": true,
    "mouseScroll": true,
    "showExtensionStatus": true,
    "taskCompletionNotification": true,
    "collapsePluginOutputs": true
  }
}
```

`collapsePluginOutputs` starts Pi tool/plugin output rows in collapsed mode; Pi's normal tool-output shortcut (Ctrl+O by default) can still toggle them.

`powerline.fixedEditor` and `powerline.mouseScroll` are also read as compatibility aliases.

## Notes

This is terminal/TUI code, not CSS. It uses ANSI scroll regions and a bottom compositor copied/adapted from `pi-powerline-footer` at commit `22dc838dcd5489806bbb41e0df773d2eda6fe5e1`.
