export interface FastModelLike {
  id?: string;
  provider?: string;
  api?: string;
}

export interface FastModePatchOptions {
  enabled: boolean;
  model: FastModelLike | null | undefined;
  supportedModels: readonly string[];
  serviceTier?: string;
}

export type FastCommandAction = "toggle" | "on" | "off" | "status" | "reload" | "help";

export interface ParsedFastCommand {
  action: FastCommandAction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitArgs(args: string | string[] | undefined): string[] {
  if (Array.isArray(args)) return args;
  if (!args) return [];
  return args.trim().split(/\s+/).filter(Boolean);
}

export function parseFastCommand(args: string | string[] | undefined): ParsedFastCommand {
  const [action = "toggle"] = splitArgs(args).map((arg) => arg.toLowerCase());

  switch (action) {
    case "on":
    case "enable":
    case "enabled":
      return { action: "on" };
    case "off":
    case "disable":
    case "disabled":
      return { action: "off" };
    case "status":
    case "stat":
      return { action: "status" };
    case "reload":
      return { action: "reload" };
    case "help":
    case "-h":
    case "--help":
      return { action: "help" };
    default:
      return { action: "toggle" };
  }
}

export function getModelKey(model: FastModelLike | null | undefined): string | null {
  if (!model?.id) return null;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

export function supportsFast(model: FastModelLike | null | undefined, supportedModels: readonly string[]): boolean {
  const key = getModelKey(model);
  if (!key) return false;
  if (supportedModels.includes(key)) return true;
  if (model?.id && supportedModels.includes(model.id)) return true;
  return false;
}

export function patchFastPayload(payload: unknown, options: FastModePatchOptions): unknown | undefined {
  if (!options.enabled || !supportsFast(options.model, options.supportedModels) || !isRecord(payload)) return undefined;
  if (Object.prototype.hasOwnProperty.call(payload, "service_tier")) return undefined;
  return { ...payload, service_tier: options.serviceTier || "priority" };
}

export function formatFastStatusLabel(
  enabled: boolean,
  model: FastModelLike | null | undefined,
  supportedModels: readonly string[],
): string | undefined {
  if (!enabled) return undefined;
  return supportsFast(model, supportedModels) ? "⚡ fast" : "⚡ fast*";
}

export function formatFastStatusMessage(
  enabled: boolean,
  model: FastModelLike | null | undefined,
  supportedModels: readonly string[],
  serviceTier: string,
): string {
  const key = getModelKey(model) ?? "unknown model";
  if (!enabled) return `Fast mode is off. Current model: ${key}`;
  if (supportsFast(model, supportedModels)) {
    return `Fast mode is on for ${key}; provider payloads will request service_tier=${serviceTier || "priority"}.`;
  }
  return `Fast mode is requested, but ${key} is not in footerFixed.fast.supportedModels.`;
}

export function formatFastHelp(): string {
  return [
    "Usage: /fast [on|off|status|reload|help]",
    "Adds service_tier=priority to provider payloads for allow-listed OpenAI-compatible models.",
    "For custom providers, add provider/modelId to footerFixed.fast.supportedModels.",
  ].join("\n");
}
