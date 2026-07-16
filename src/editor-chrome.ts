import { execFileSync } from "node:child_process";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const GIT_CACHE_MS = 2000;
const MIN_CHROME_WIDTH = 16;
const BODY_TOP_PADDING = 1;
const BODY_META_GAP = 1; // gap between input body and bottom meta
const PANEL_BOTTOM_PADDING = 1; // gap under meta before panel edge
const PAD_X = 1; // equal inset after left bar / before right edge
const LEFT_BAR = "▌";
// Solid mid-gray panel when theme bg is unavailable.
const FALLBACK_PANEL_BG_ANSI = "\x1b[48;2;51;51;51m";
const PANEL_BG_KEYS = ["selectedBg", "userMessageBg"] as const;

type ThemeLike = {
  fg?: (color: ThemeColor, text: string) => string;
  bg?: (color: never, text: string) => string;
  getBgAnsi?: (color: never) => string;
};

export interface EditorChromeContextLike {
  cwd?: string;
  model?: { contextWindow?: number; id?: string; name?: string; provider?: string };
  ui?: { theme?: ThemeLike };
  getContextUsage?: () => { percent?: number | null; contextWindow?: number; tokens?: number | null } | undefined;
}

export interface EditorChromeRenderInput {
  width: number;
  enabled: boolean;
  context: EditorChromeContextLike | null | undefined;
  thinkingLevel: string;
  providerCompatLabel?: string;
  fastLabel?: string;
  showGitStatus?: boolean;
  /** Left-outside working label, e.g. "⠋ working". Empty when idle. */
  workingLabel?: string;
  borderColor?: (text: string) => string;
  renderBase: (width: number) => string[];
}

interface GitInfo {
  branch: string | null;
  changedFiles: number;
  added: number;
  removed: number;
  isRepository: boolean;
}

let gitCache: { cwd: string; at: number; info: GitInfo } | undefined;

export function clearEditorChromeGitCache(): void {
  gitCache = undefined;
}

function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    }).trim();
  } catch {
    return "";
  }
}

function getGitInfo(cwd: string): GitInfo {
  const now = Date.now();
  if (gitCache && gitCache.cwd === cwd && now - gitCache.at < GIT_CACHE_MS) return gitCache.info;

  const isRepository = runGit(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!isRepository) {
    const info = { branch: null, changedFiles: 0, added: 0, removed: 0, isRepository };
    gitCache = { cwd, at: now, info };
    return info;
  }

  const branch = runGit(cwd, ["branch", "--show-current"])
    || runGit(cwd, ["rev-parse", "--short", "HEAD"])
    || null;
  const porcelain = runGit(cwd, ["status", "--short"]);
  const changedFiles = porcelain ? porcelain.split("\n").filter(Boolean).length : 0;
  const numstat = [runGit(cwd, ["diff", "--numstat"]), runGit(cwd, ["diff", "--cached", "--numstat"])]
    .filter(Boolean)
    .join("\n");
  let added = 0;
  let removed = 0;

  for (const line of numstat.split("\n")) {
    const [addedText, removedText] = line.split("\t");
    const addedCount = Number(addedText);
    const removedCount = Number(removedText);
    if (Number.isFinite(addedCount)) added += addedCount;
    if (Number.isFinite(removedCount)) removed += removedCount;
  }

  const info = { branch, changedFiles, added, removed, isRepository };
  gitCache = { cwd, at: now, info };
  return info;
}

function stripOscSequences(line: string): string {
  return line.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function stripAnsi(line: string): string {
  return stripOscSequences(line).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function isEditorRule(line: string): boolean {
  const plain = stripAnsi(line).trim();
  return plain.includes("─") && [...plain].every((char) => "─↑↓ 0123456789more".includes(char));
}

function splitEditorRender(lines: string[]): { bodyLines: string[]; popupLines: string[] } | null {
  if (lines.length < 2 || !isEditorRule(lines[0] ?? "")) return null;

  const withoutTop = lines.slice(1);
  let bottomRuleIndex = -1;
  for (let index = withoutTop.length - 1; index >= 0; index -= 1) {
    if (isEditorRule(withoutTop[index] ?? "")) {
      bottomRuleIndex = index;
      break;
    }
  }
  if (bottomRuleIndex === -1) return null;

  return {
    bodyLines: withoutTop.slice(0, bottomRuleIndex),
    popupLines: withoutTop.slice(bottomRuleIndex + 1),
  };
}

function fg(theme: ThemeLike | undefined, color: ThemeColor, text: string): string {
  try {
    return theme?.fg?.(color, text) ?? text;
  } catch {
    return text;
  }
}

function panelBgOpen(theme: ThemeLike | undefined): string {
  for (const key of PANEL_BG_KEYS) {
    try {
      const ansi = theme?.getBgAnsi?.(key as never);
      if (ansi && ansi !== "\x1b[49m") return ansi;
    } catch {
      // try next / fallback
    }
  }
  return FALLBACK_PANEL_BG_ANSI;
}

// Full-line panel fill. Re-open bg after full SGR resets (editor cursor uses \x1b[0m).
function withPanelBg(theme: ThemeLike | undefined, text: string): string {
  const open = panelBgOpen(theme);
  const repaired = text.replace(/\x1b\[0m/g, `\x1b[0m${open}`);
  return `${open}${repaired}\x1b[49m`;
}

function thinkingColor(level: string): ThemeColor {
  switch (level) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "off":
    default:
      return "thinkingOff";
  }
}

function compactModelId(modelId: string, maxWidth: number): string {
  if (visibleWidth(modelId) <= maxWidth) return modelId;

  const slashIndex = modelId.indexOf("/");
  const prefix = slashIndex === -1 ? "" : modelId.slice(0, slashIndex + 1);
  const id = slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
  const simplifiedId = id
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/-20\d{6}$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const simplified = `${prefix}${simplifiedId}`;

  if (visibleWidth(simplified) <= maxWidth) return simplified;
  return truncateToWidth(simplified, maxWidth, "…");
}

function modelChromeLabel(context: EditorChromeContextLike): string {
  const modelId = context.model?.name ?? context.model?.id ?? "model unknown";
  return context.model?.provider ? `${context.model.provider}/${modelId}` : modelId;
}

function formatGitLabel(theme: ThemeLike | undefined, git: GitInfo, maxWidth: number): string {
  const contentWidth = Math.max(0, maxWidth);
  if (contentWidth === 0) return "";

  if (!git.isRepository) return "";
  if (!git.branch && git.changedFiles === 0) return "";

  const separator = fg(theme, "dim", " · ");
  const branch = git.branch ? `${fg(theme, "accent", "⑂")} ${fg(theme, "muted", git.branch)}` : "";
  const compactStatus = git.changedFiles === 0
    ? fg(theme, "success", "✓")
    : `${fg(theme, "warning", "●")} ${fg(theme, "warning", `${git.changedFiles}Δ`)}`;
  const fullStatus = git.changedFiles === 0
    ? `${fg(theme, "success", "✓")} ${fg(theme, "success", "clean")}`
    : [
      compactStatus,
      git.added > 0 ? fg(theme, "toolDiffAdded", `+${git.added}`) : "",
      git.removed > 0 ? fg(theme, "toolDiffRemoved", `-${git.removed}`) : "",
    ].filter(Boolean).join(" ");

  const fullLabel = branch ? `${branch}${separator}${fullStatus}` : fullStatus;
  if (visibleWidth(fullLabel) <= contentWidth) return fullLabel;

  const compactLabel = branch ? `${branch}${separator}${compactStatus}` : compactStatus;
  if (visibleWidth(compactLabel) <= contentWidth) return compactLabel;

  if (branch) {
    const branchWidth = contentWidth - visibleWidth(separator) - visibleWidth(compactStatus);
    if (branchWidth > 0) return `${truncateToWidth(branch, branchWidth, "…")}${separator}${compactStatus}`;
  }

  if (visibleWidth(fullStatus) <= contentWidth) return fullStatus;
  if (visibleWidth(compactStatus) <= contentWidth) return compactStatus;

  return truncateToWidth(compactStatus, contentWidth, "…");
}

function padLine(line: string, width: number): string {
  const clipped = truncateToWidth(line, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

// Shared light tone for model / ctx / provider-compat meta items.
const META_LIGHT: ThemeColor = "muted";

function formatContextUsage(context: EditorChromeContextLike, theme: ThemeLike | undefined): string {
  try {
    const usage = context.getContextUsage?.();
    if (!usage || usage.percent === null || usage.percent === undefined) return "";

    const percent = Math.max(0, Math.round(usage.percent));
    const contextWindow = usage.contextWindow ?? context.model?.contextWindow;
    const suffix = contextWindow ? `/${Math.round(contextWindow / 1000)}k` : "";
    return fg(theme, META_LIGHT, `ctx ${percent}%${suffix}`);
  } catch {
    return "";
  }
}

function buildMetaLine(
  context: EditorChromeContextLike,
  thinkingLevel: string,
  width: number,
  providerCompatLabel?: string,
  fastLabel?: string,
): string {
  const theme = context.ui?.theme;
  const separator = fg(theme, "dim", " · ");

  const thinkingText = thinkingLevel || "off";
  const thinking = thinkingText === "off"
    ? ""
    : fg(theme, thinkingColor(thinkingText), thinkingText);
  // Model / ctx / header-compat share the same light theme color.
  const providerCompat = providerCompatLabel ? fg(theme, META_LIGHT, providerCompatLabel) : "";
  const fast = fastLabel ? fg(theme, fastLabel.includes("*") ? "warning" : "accent", fastLabel) : "";
  const contextUsage = formatContextUsage(context, theme);

  const optional = [thinking, providerCompat, fast, contextUsage].filter(Boolean);
  let extras = [...optional];
  const modelLabel = modelChromeLabel(context);
  const pack = (modelText: string, parts: string[]) => [modelText, ...parts].filter(Boolean).join(separator);

  let model = fg(theme, META_LIGHT, compactModelId(modelLabel, Math.max(1, width)));
  let left = pack(model, extras);
  while (extras.length > 0 && visibleWidth(left) > width) {
    extras = extras.slice(0, -1);
    left = pack(model, extras);
  }
  if (visibleWidth(left) > width) {
    model = fg(theme, META_LIGHT, compactModelId(modelLabel, Math.max(1, width)));
    left = pack(model, []);
  }
  if (visibleWidth(left) > width) {
    left = truncateToWidth(left, width, "…");
  }

  return padLine(left, width);
}

/** Status row outside the input panel: working (left) · git (right). */
function buildExternalStatusLine(
  context: EditorChromeContextLike,
  width: number,
  options: { showGitStatus?: boolean; workingLabel?: string },
): string {
  const theme = context.ui?.theme;
  const working = options.workingLabel?.trim() ? options.workingLabel.trim() : "";
  const git = options.showGitStatus
    ? formatGitLabel(theme, getGitInfo(context.cwd ?? process.cwd()), width)
    : "";

  if (!working && !git) return "";
  if (!git) return padLine(working, width);
  if (!working) {
    const pad = Math.max(0, width - visibleWidth(git));
    return " ".repeat(pad) + git;
  }

  const gap = Math.max(1, width - visibleWidth(working) - visibleWidth(git));
  return padLine(`${working}${" ".repeat(gap)}${git}`, width);
}

function paintPanelLine(
  theme: ThemeLike | undefined,
  thinkingLevel: string,
  content: string,
  contentWidth: number,
): string {
  const bar = fg(theme, thinkingColor(thinkingLevel || "off"), LEFT_BAR);
  const pad = " ".repeat(PAD_X);
  // ▌ | pad | content | pad — equal inset under solid panel bg; no ─ borders
  return withPanelBg(theme, bar + pad + padLine(content, contentWidth) + pad);
}

export function renderEditorChrome(input: EditorChromeRenderInput): string[] {
  const width = Math.max(1, Math.floor(input.width));
  if (!input.enabled || !input.context || width < MIN_CHROME_WIDTH) return input.renderBase(input.width);

  const barWidth = visibleWidth(LEFT_BAR);
  const contentWidth = Math.max(1, width - barWidth - PAD_X * 2);
  // Base editor still draws ─ rules; strip them (no chrome ─ borders).
  const baseLines = input.renderBase(contentWidth);
  const split = splitEditorRender(baseLines);
  if (!split) return input.renderBase(input.width);

  const theme = input.context.ui?.theme;
  const thinkingLevel = input.thinkingLevel || "off";
  const paint = (content: string) => paintPanelLine(theme, thinkingLevel, content, contentWidth);
  const topPad = Array.from({ length: BODY_TOP_PADDING }, () => paint(""));
  const metaGap = Array.from({ length: BODY_META_GAP }, () => paint(""));
  const bottomPad = Array.from({ length: PANEL_BOTTOM_PADDING }, () => paint(""));
  const meta = buildMetaLine(
    input.context,
    thinkingLevel,
    contentWidth,
    input.providerCompatLabel,
    input.fastLabel,
  );
  const externalStatus = buildExternalStatusLine(input.context, width, {
    showGitStatus: input.showGitStatus,
    workingLabel: input.workingLabel,
  });

  return [
    ...topPad,
    ...split.bodyLines.map((line) => paint(line)),
    ...metaGap,
    paint(meta),
    ...bottomPad,
    ...(externalStatus ? [externalStatus] : []),
    ...split.popupLines.map((line) => padLine(line, width)),
  ];
}
