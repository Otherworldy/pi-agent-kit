import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import type { NotificationChannelsConfig, TelegramNotificationChannelConfig } from "./config.ts";

export type TaskCompletionNotificationStatus = "completed" | "aborted" | "error";

const TASK_COMPLETED_FALLBACK_TEXT = "任务已完成。";
const TASK_ERROR_NOTIFICATION_TEXT = "任务出错，请回到本地查看详情。";
const WINDOWS_TOAST_APP_ID = "Pi Agent";
const WINDOWS_TOAST_BODY_LIMIT = 240;
const TELEGRAM_MESSAGE_LIMIT = 4096;

const SUBAGENT_ENV_KEYS = [
  "PI_SUBAGENT_CHILD",
  "PI_SUBAGENT_RUN_ID",
  "PI_SUBAGENT_CHILD_AGENT",
  "PI_SUBAGENT_CHILD_INDEX",
] as const;

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

type Env = NodeJS.ProcessEnv;

type TelegramFetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export type TelegramFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<TelegramFetchResponse>;

type AssistantLikeMessage = {
  role?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
  content?: unknown;
  text?: unknown;
  message?: unknown;
};

let telegramProxyAgent: EnvHttpProxyAgent | undefined;

function hasProxyEnv(env: Env = process.env): boolean {
  return PROXY_ENV_KEYS.some((key) => Boolean(env[key]));
}

function defaultTelegramFetch(url: string, init: Parameters<TelegramFetch>[1]): Promise<TelegramFetchResponse> {
  const dispatcher = hasProxyEnv() ? telegramProxyAgent ??= new EnvHttpProxyAgent() : undefined;
  const requestInit = dispatcher ? { ...init, dispatcher } : init;
  return undiciFetch(url, requestInit as any) as unknown as Promise<TelegramFetchResponse>;
}

function getArgValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function windowsToastScript(body: string): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "try {",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "$template = [Windows.UI.Notifications.ToastTemplateType]::ToastText01",
    "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)",
    "$texts = $xml.GetElementsByTagName('text')",
    `$texts.Item(0).AppendChild($xml.CreateTextNode(${powershellSingleQuoted(body)})) > $null`,
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${powershellSingleQuoted(WINDOWS_TOAST_APP_ID)}).Show($toast)`,
    "} catch {}",
  ].join("\n");
}

function isAssistantMessage(message: unknown): message is AssistantLikeMessage {
  return typeof message === "object" && message !== null && (message as AssistantLikeMessage).role === "assistant";
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;
  if (Array.isArray(content)) {
    const parts = content.map(textFromContent).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }
  if (typeof content !== "object" || content === null) return undefined;

  const record = content as Record<string, unknown>;
  if (typeof record.text === "string") return record.text.trim() || undefined;
  if (typeof record.content === "string") return record.content.trim() || undefined;
  return textFromContent(record.content);
}

function assistantMessageText(message: AssistantLikeMessage): string | undefined {
  return textFromContent(message.content) ?? textFromContent(message.text) ?? textFromContent(message.message);
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function getTaskCompletionNotificationAnswer(messages: readonly unknown[]): string | undefined {
  const lastAssistantMessage = [...messages].reverse().find(isAssistantMessage);
  return lastAssistantMessage ? assistantMessageText(lastAssistantMessage) : undefined;
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

export function shouldSendTaskCompletionNotification(status: TaskCompletionNotificationStatus): boolean {
  return status !== "aborted";
}

function taskCompletionNotificationText(
  status: TaskCompletionNotificationStatus,
  answer?: string,
  limit: number = WINDOWS_TOAST_BODY_LIMIT,
): string {
  if (status === "aborted") return "";
  if (status === "error") return TASK_ERROR_NOTIFICATION_TEXT;

  const normalizedAnswer = answer?.trim();
  return truncateText(normalizedAnswer || TASK_COMPLETED_FALLBACK_TEXT, limit);
}

export function taskCompletionNotificationMessage(
  status: TaskCompletionNotificationStatus,
  answer?: string,
  bodyLimit: number = WINDOWS_TOAST_BODY_LIMIT,
): { title: string; body: string } {
  return {
    title: WINDOWS_TOAST_APP_ID,
    body: taskCompletionNotificationText(status, answer, bodyLimit),
  };
}

function telegramNotificationText(status: TaskCompletionNotificationStatus, answer?: string): string {
  return taskCompletionNotificationText(status, answer, TELEGRAM_MESSAGE_LIMIT);
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
): boolean {
  return ctx?.hasUI === true && !isSubagentProcess(env, argv);
}

export function shouldNotifyTaskCompletionWindows(
  ctx: { hasUI?: boolean } | null | undefined,
  env: Env = process.env,
  argv: readonly string[] = process.argv,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return supportsWindowsToast(platform, env) && shouldNotifyTaskCompletion(ctx, env, argv);
}

export function notifyTaskCompleteWindows(
  status: TaskCompletionNotificationStatus = "completed",
  answer?: string,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!shouldSendTaskCompletionNotification(status) || !supportsWindowsToast(platform, env)) return;

  const { body } = taskCompletionNotificationMessage(status, answer);

  try {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(windowsToastScript(body), "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 },
      () => {},
    );
  } catch {
    // Notifications must never affect the agent loop.
  }
}

function readTelegramBotToken(config: TelegramNotificationChannelConfig): string | undefined {
  return config.botToken?.trim();
}

function readTelegramChatId(config: TelegramNotificationChannelConfig): string | undefined {
  return config.chatId?.trim();
}

function telegramApiUrl(config: TelegramNotificationChannelConfig, botToken: string): string {
  return `${config.apiBaseUrl.trim().replace(/\/+$/, "")}/bot${botToken}/sendMessage`;
}

export async function notifyTaskCompleteTelegram(
  status: TaskCompletionNotificationStatus = "completed",
  config: TelegramNotificationChannelConfig,
  answer?: string,
  fetchImpl: TelegramFetch | undefined = defaultTelegramFetch,
): Promise<boolean> {
  if (!config.enabled || !shouldSendTaskCompletionNotification(status)) return false;

  const botToken = readTelegramBotToken(config);
  const chatId = readTelegramChatId(config);
  if (!botToken || !chatId || typeof fetchImpl !== "function") return false;

  const params = new URLSearchParams({
    chat_id: chatId,
    text: telegramNotificationText(status, answer),
    disable_web_page_preview: "true",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, config.timeoutMs));

  try {
    const response = await fetchImpl(telegramApiUrl(config, botToken), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      console.debug(`[pi-agent-kit] Telegram notification failed with status ${response.status}: ${responseBody}`);
      return false;
    }

    return true;
  } catch (error) {
    console.debug("[pi-agent-kit] Telegram notification failed:", error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function notifyTaskComplete(
  status: TaskCompletionNotificationStatus = "completed",
  channels: NotificationChannelsConfig,
  answer?: string,
): void {
  if (!shouldSendTaskCompletionNotification(status)) return;
  if (channels.windowsToast.enabled) notifyTaskCompleteWindows(status, answer);
  if (channels.telegram.enabled) void notifyTaskCompleteTelegram(status, channels.telegram, answer);
}
