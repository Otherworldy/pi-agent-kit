import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

export type TaskCompletionNotificationStatus = "completed" | "aborted" | "error";

const WINDOWS_TOAST_MESSAGES: Record<TaskCompletionNotificationStatus, { title: string; body: string }> = {
  completed: {
    title: "任务已完成",
    body: "Pi Agent 已完成任务，正在等待你的输入。",
  },
  aborted: {
    title: "任务已中断",
    body: "Pi Agent 任务已异常中断，正在等待你的输入。",
  },
  error: {
    title: "任务出错",
    body: "Pi Agent 任务遇到错误，正在等待你的输入。",
  },
};
const WINDOWS_TOAST_APP_ID = "Pi Agent";

const SUBAGENT_ENV_KEYS = [
  "PI_SUBAGENT_CHILD",
  "PI_SUBAGENT_RUN_ID",
  "PI_SUBAGENT_CHILD_AGENT",
  "PI_SUBAGENT_CHILD_INDEX",
] as const;

type Env = NodeJS.ProcessEnv;

type AssistantLikeMessage = {
  role?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
};

function getArgValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function windowsToastScript(title: string, body: string): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "try {",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "$template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02",
    "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)",
    "$texts = $xml.GetElementsByTagName('text')",
    `$texts.Item(0).AppendChild($xml.CreateTextNode(${powershellSingleQuoted(title)})) > $null`,
    `$texts.Item(1).AppendChild($xml.CreateTextNode(${powershellSingleQuoted(body)})) > $null`,
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${powershellSingleQuoted(WINDOWS_TOAST_APP_ID)}).Show($toast)`,
    "} catch {}",
  ].join("\n");
}

function isAssistantMessage(message: unknown): message is AssistantLikeMessage {
  return typeof message === "object" && message !== null && (message as AssistantLikeMessage).role === "assistant";
}

export function getTaskCompletionNotificationStatus(messages: readonly unknown[]): TaskCompletionNotificationStatus {
  const lastAssistantMessage = [...messages].reverse().find(isAssistantMessage);
  const stopReason = typeof lastAssistantMessage?.stopReason === "string" ? lastAssistantMessage.stopReason : undefined;

  if (stopReason === "aborted") return "aborted";
  if (stopReason === "error") return "error";
  if (typeof lastAssistantMessage?.errorMessage === "string" && lastAssistantMessage.errorMessage.trim()) return "error";
  if (stopReason && stopReason !== "stop" && stopReason !== "toolUse") return "error";

  return "completed";
}

export function taskCompletionNotificationMessage(status: TaskCompletionNotificationStatus): { title: string; body: string } {
  return WINDOWS_TOAST_MESSAGES[status];
}

export function isSubagentProcess(env: Env = process.env, argv: readonly string[] = process.argv): boolean {
  if (SUBAGENT_ENV_KEYS.some((key) => Boolean(env[key]))) return true;

  const depth = Number(env.PI_SUBAGENT_DEPTH ?? "0");
  if (Number.isFinite(depth) && depth > 0) return true;

  const mode = getArgValue(argv, "--mode");
  return mode === "json" && (argv.includes("-p") || argv.includes("--print") || argv.includes("--no-session"));
}

export function isWsl(env: Env = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux") return false;
  if (env.WSL_DISTRO_NAME || env.WSLENV) return true;
  if (env !== process.env) return false;

  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

export function supportsWindowsToast(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
): boolean {
  return platform === "win32" || isWsl(env, platform);
}

export function shouldNotifyTaskCompletion(
  ctx: { hasUI?: boolean } | null | undefined,
  env: Env = process.env,
  argv: readonly string[] = process.argv,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return supportsWindowsToast(platform, env) && ctx?.hasUI === true && !isSubagentProcess(env, argv);
}

export function notifyTaskCompleteWindows(status: TaskCompletionNotificationStatus = "completed"): void {
  if (!supportsWindowsToast()) return;

  const { title, body } = taskCompletionNotificationMessage(status);

  try {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(windowsToastScript(title, body), "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 },
      () => {},
    );
  } catch {
    // Notifications must never affect the agent loop.
  }
}
