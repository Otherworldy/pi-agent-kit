# pi-agent-kit

Pi Agent terminal productivity kit with a fixed editor/input cluster, editor chrome, task completion notifications, fast mode, and provider compatibility helpers.

Based on the fixed editor cluster idea from [`nicobailon/pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer).

## Install

```bash
npm install
npm run validate
pi install -l D:/Study/Code/Node/pi-agent-kit
```

## Settings UI

```text
/agent-kit
```

The settings panel includes:

- Fixed editor
- Mouse scroll
- Extension status
- Editor chrome
- Git status
- Local task notification
- Telegram task notification
- Provider compatibility
- Fast mode

## Settings file

**Primary (recommended):** `~/.pi/agent/extensions/pi-agent-kit/config.json`  
(legacy typo path also accepted: `~/.pi/agent/extensions/pi-agent-ket/config.json`)

Also merged (later wins): global `~/.pi/agent/settings.json` → `agentKit`, project `.pi/settings.json` → `agentKit`.

Extension config is **flat** (not nested under `agentKit`):

```json
{
  "fixedEditor": true,
  "mouseScroll": true,
  "showExtensionStatus": true,
  "showGitStatus": true,
  "notificationChannels": {
    "windowsToast": {
      "enabled": true
    },
    "telegram": {
      "enabled": false,
      "botToken": "123456:example",
      "chatId": "123456789",
      "apiBaseUrl": "https://api.telegram.org",
      "timeoutMs": 5000
    }
  },
  "editorChrome": true,
  "chrome": {
    "left": ["model", "thinking", "timer", "providerCompat", "fast"],
    "right": ["cost", "context"]
  },
  "providerCompat": {
    "enabled": true
  },
  "fast": {
    "enabled": false,
    "persistState": true,
    "serviceTier": "priority",
    "supportedModels": [
      "openai/gpt-5.4",
      "openai/gpt-5.5",
      "openai-codex/gpt-5.4",
      "openai-codex/gpt-5.5",
      "my-openai/gpt-5.5"
    ]
  }
}
```

`powerline.fixedEditor` and `powerline.mouseScroll` are also read as compatibility aliases.

## Fixed editor and editor chrome

The fixed editor keeps the input cluster at the bottom of the terminal while chat output scrolls above it. `editorChrome` restyles the input as a solid gray panel with a left `▌` rail colored by thinking level, or green in bash (`!`) mode (no top/bottom `─` borders), equal side insets, and a bottom meta line. Layout is controlled by `agentKit.chrome.left` / `agentKit.chrome.right` slot arrays (order = display order; omit a slot to hide it). Available slots: `model`, `thinking`, `timer` (last agent working duration, live while working), `providerCompat`, `fast`, `context` (`34k/500k`), `cost`. Default: left `model · thinking · timer · providerCompat · fast`, right `cost · context`. Outside the panel: dual-dot bounce on the bottom-left for agent working (`esc interrupt`) and context compaction (`Compacting context...`), and the current project folder name (`showProjectDir`, left) next to the optional `showGitStatus` git branch/changes on the bottom-right. Sent user messages use the same solid gray panel + `▌` rail styling as the input box.

## Task completion notification

On native Windows, and on Windows 11 WSL with `powershell.exe`/WSL interop available, the extension can send a local toast notification when the main interactive Pi Agent finishes a task. Telegram push can also be enabled as an additional notification channel. Successful tasks send the final assistant answer, errors send a fixed failure message, and user-aborted tasks do not send a notification. Error notifications are delayed and coalesced; if the agent auto-retries (or otherwise starts another run), the pending error notification is cancelled so only a final stop notifies.

Subagent processes are skipped via the `PI_SUBAGENT_*` environment markers used by `pi-subagents`, with a JSON print-mode fallback guard. Local and Telegram notifications can be enabled separately in `/agent-kit`. If no toast appears in WSL, check `command -v powershell.exe` and Windows notification / Do Not Disturb settings.

To enable Telegram, create a bot with `@BotFather`, send it `/start`, and configure the bot token and chat id in settings:

```json
{
  "agentKit": {
    "notificationChannels": {
      "telegram": {
        "enabled": true,
        "botToken": "123456:example",
        "chatId": "123456789"
      }
    }
  }
}
```

You can also set `apiBaseUrl` and `timeoutMs` under `notificationChannels.telegram`.

## Continue after failure

```text
/continue
```

When the most recent agent run stopped on an assistant/provider error, `/continue` starts one manual retry from just before the failed assistant response. It hides the failed assistant error and the extension's internal trigger message from the next model request, so the model sees the conversation at the failure point again.

`/continue` is only available after an error stop. If there is no failed assistant response to continue, if Pi Agent is still running, or if a continue request is already pending, the command shows a notice and does not start another turn. User-aborted runs are not retried.

## Fast mode

```text
/fast [on|off|status|reload|help]
pi --fast
```

Fast mode follows `pi-better-openai`: it does not register a provider. Instead, when enabled and the current model key is in `agentKit.fast.supportedModels`, it patches the final provider payload with `service_tier: "priority"` in Pi's `before_provider_request` hook.

For a Pi custom provider, keep your provider registration as-is, then add its `provider/modelId` key to `supportedModels`, for example `"my-openai/gpt-5.5"`. The upstream OpenAI-compatible endpoint/proxy must accept the `service_tier` field.

## Provider compatibility

Some Claude/NewAPI-compatible gateways validate that requests look like Claude Code CLI, and QuantumNous/new-api also includes Codex CLI channel-affinity/header passthrough templates. Provider compatibility is enabled by default; toggle `Provider compatibility` in `/agent-kit` if you want to restore normal provider requests for the current session. When active, the editor chrome shows `⇄ CC` or `⇄ Codex` next to the thinking level.

`settings.json` only needs the headers you want to override; all omitted headers use built-in Claude Code or Codex CLI defaults:

```json
{
  "agentKit": {
    "providerCompat": {
      "claudeCodeHeaders": {
        "User-Agent": "claude-cli/2.1.212 (external, cli)"
      },
      "codexHeaders": {
        "User-Agent": "codex_cli_rs/0.144.5 (Linux 6.8.0; x86_64) unknown",
        "X-Codex-Beta-Features": "remote_compaction_v2"
      }
    }
  }
}
```

Claude-like models automatically receive Claude Code headers generated like the official client (`User-Agent` = `claude-cli/{version} (external, cli)`, `X-App`, Stainless platform headers, `Anthropic-Version` / `Anthropic-Beta`, plus `X-Claude-Code-Session-Id` from Pi's session), the Claude Code identity system text, and a `metadata.user_id` JSON body field (`device_id` + Pi session) for gateway client checks. Override with `claudeCodeCompat.metadataUserId` if needed. Codex/OpenAI-compatible models automatically receive Codex CLI headers generated like the official client: `Originator` / `User-Agent` (`{originator}/{version} ({os} {os_version}; {arch}) {terminal}`), `session-id` + `thread-id` (and legacy `Session_id` / `Thread_id`), `X-Client-Request-Id`, `X-Codex-Window-Id`, `OpenAI-Beta`, optional `X-Codex-Beta-Features`, and `X-Codex-Turn-Metadata`. Session fields and a missing Responses `prompt_cache_key` use Pi's real session ID. Body also gets official-style `client_metadata` (`x-codex-installation-id` + session/thread/window/turn); existing `x-codex-installation-id` is preserved. Override installation id with `PI_CODEX_COMPAT_INSTALLATION_ID`. Existing provider headers are preserved and compatibility headers override duplicates while the plugin-page switch is on. Run `/fast reload` after editing header overrides to reload fast mode and provider compatibility settings without changing the plugin-page switch state.

Nested header config is also accepted if you prefer grouping by profile:

```json
{
  "agentKit": {
    "providerCompat": {
      "claudeCode": {
        "headers": {
          "User-Agent": "claude-cli/2.1.212 (external, cli)"
        }
      },
      "codex": {
        "headers": {
          "X-Codex-Beta-Features": "remote_compaction_v2"
        }
      }
    }
  }
}
```

## Notes

This is terminal/TUI code, not CSS. It uses ANSI scroll regions and a bottom compositor copied/adapted from `pi-powerline-footer` at commit `22dc838dcd5489806bbb41e0df773d2eda6fe5e1`.
