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
- Local task notification
- Telegram task notification
- Provider compatibility
- Fast mode

## Settings file

Global: `~/.pi/agent/settings.json`

Project: `.pi/settings.json`

```json
{
  "agentKit": {
    "fixedEditor": true,
    "mouseScroll": true,
    "showExtensionStatus": true,
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
}
```

`powerline.fixedEditor` and `powerline.mouseScroll` are also read as compatibility aliases.

## Fixed editor and editor chrome

The fixed editor keeps the input cluster at the bottom of the terminal while chat output scrolls above it. `editorChrome` shows the current model, thinking level, working directory, git branch, git change summary, provider compatibility label, fast mode label, and context usage directly on the input box border, inspired by `amp-themes`.

## Task completion notification

On native Windows, and on Windows 11 WSL with `powershell.exe`/WSL interop available, the extension can send a local toast notification when the main interactive Pi Agent finishes a task. Telegram push can also be enabled as an additional notification channel. Successful tasks send the final assistant answer, errors send a fixed failure message, and user-aborted tasks do not send a notification.

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

## Fast mode

```text
/fast [on|off|status|reload|help]
pi --fast
```

Fast mode follows `pi-better-openai`: it does not register a provider. Instead, when enabled and the current model key is in `agentKit.fast.supportedModels`, it patches the final provider payload with `service_tier: "priority"` in Pi's `before_provider_request` hook.

For a Pi custom provider, keep your provider registration as-is, then add its `provider/modelId` key to `supportedModels`, for example `"my-openai/gpt-5.5"`. The upstream OpenAI-compatible endpoint/proxy must accept the `service_tier` field.

## Provider compatibility

Some Claude/NewAPI-compatible gateways validate that requests look like Claude Code CLI, and QuantumNous/new-api also includes Codex CLI channel-affinity/header passthrough templates. Provider compatibility is enabled by default; toggle `Provider compatibility` in `/agent-kit` if you want to restore normal provider requests for the current session. When active, the editor chrome shows `CC` or `Codex` next to the thinking level.

`settings.json` only needs the headers you want to override; all omitted headers use built-in Claude Code or Codex CLI defaults:

```json
{
  "agentKit": {
    "providerCompat": {
      "claudeCodeHeaders": {
        "User-Agent": "claude-cli/2.1.75 (external, cli)"
      },
      "codexHeaders": {
        "User-Agent": "codex_cli_rs/0.132.0 (linux; x64) node",
        "X-Codex-Beta-Features": "remote_compaction_v2"
      }
    }
  }
}
```

Claude-like models automatically receive Claude Code headers and payload patching (`metadata.user_id` plus the Claude Code identity system text). Codex/OpenAI Responses-like models automatically receive Codex CLI headers (`Originator`, `Session_id`, `User-Agent`, `OpenAI-Beta`, `X-Codex-Beta-Features`, and `X-Codex-Turn-Metadata`) and Responses payload patching (`prompt_cache_key`, `store`, `instructions`, and `client_metadata.x-codex-installation-id`). Existing provider headers are preserved and compatibility headers override duplicates while the plugin-page switch is on. Run `/fast reload` after editing header overrides to reload fast mode and provider compatibility settings without changing the plugin-page switch state.

Nested header config is also accepted if you prefer grouping by profile:

```json
{
  "agentKit": {
    "providerCompat": {
      "claudeCode": {
        "headers": {
          "User-Agent": "claude-cli/2.1.75 (external, cli)"
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
