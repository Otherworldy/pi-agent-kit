import { UserMessageComponent, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

const LEFT_BAR = "▌";
const PAD_X = 1;
const VERTICAL_PAD = 1;
const FALLBACK_PANEL_BG_ANSI = "\x1b[48;2;51;51;51m";
const PANEL_BG_KEYS = ["selectedBg", "userMessageBg"] as const;

type ThemeLike = {
  fg?: (color: string, text: string) => string;
  bg?: (color: string, text: string) => string;
  getBgAnsi?: (color: string) => string;
  bold?: (text: string) => string;
  italic?: (text: string) => string;
  underline?: (text: string) => string;
  strikethrough?: (text: string) => string;
};

type RenderFn = (width: number) => string[];
type InvalidateFn = () => void;

type PatchablePrototype = {
  render: RenderFn;
  invalidate?: InvalidateFn;
  __agentKitUserMessageOriginalRender?: RenderFn;
  __agentKitUserMessageWrapper?: RenderFn;
  __agentKitUserMessagePatched?: boolean;
  __agentKitUserMessageActive?: boolean;
  __agentKitUserMessageGetTheme?: () => ThemeLike | undefined;
  __agentKitUserMessageGetThinkingLevel?: () => string;
  __agentKitUserMessageIsEnabled?: () => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function findMarkdownText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.text === "string") return value.text;
  if (!Array.isArray(value.children)) return undefined;
  for (const child of value.children) {
    const text = findMarkdownText(child);
    if (text !== undefined) return text;
  }
  return undefined;
}

function fg(theme: ThemeLike | undefined, color: string, text: string): string {
  try {
    return theme?.fg?.(color, text) ?? text;
  } catch {
    return text;
  }
}

function thinkingColor(level: string): string {
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
    case "max":
      return "thinkingMax";
    case "off":
    default:
      return "thinkingOff";
  }
}

function panelBgOpen(theme: ThemeLike | undefined): string {
  for (const key of PANEL_BG_KEYS) {
    try {
      const ansi = theme?.getBgAnsi?.(key);
      if (ansi && ansi !== "\x1b[49m") return ansi;
    } catch {
      // try next
    }
  }
  return FALLBACK_PANEL_BG_ANSI;
}

function withPanelBg(theme: ThemeLike | undefined, text: string): string {
  const open = panelBgOpen(theme);
  const repaired = text.replace(/\x1b\[0m/g, `\x1b[0m${open}`);
  return `${open}${repaired}\x1b[49m`;
}

function padLine(line: string, width: number): string {
  const clipped = truncateToWidth(line, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function paintPanelLine(
  theme: ThemeLike | undefined,
  thinkingLevel: string,
  content: string,
  contentWidth: number,
): string {
  const bar = fg(theme, thinkingColor(thinkingLevel || "off"), LEFT_BAR);
  const pad = " ".repeat(PAD_X);
  return withPanelBg(theme, bar + pad + padLine(content, contentWidth) + pad);
}

function renderUserMessageChrome(
  instance: unknown,
  width: number,
  theme: ThemeLike | undefined,
  thinkingLevel: string,
): string[] | undefined {
  const text = findMarkdownText(instance);
  if (text === undefined) return undefined;
  if (width <= 0) return [""];

  const barWidth = visibleWidth(LEFT_BAR);
  const contentWidth = Math.max(1, width - barWidth - PAD_X * 2);

  const mdTheme = {
    heading: (t: string) => fg(theme, "mdHeading", t),
    link: (t: string) => fg(theme, "mdLink", t),
    linkUrl: (t: string) => fg(theme, "mdLinkUrl", t),
    code: (t: string) => fg(theme, "mdCode", t),
    codeBlock: (t: string) => fg(theme, "mdCodeBlock", t),
    codeBlockBorder: (t: string) => fg(theme, "mdCodeBlockBorder", t),
    quote: (t: string) => fg(theme, "mdQuote", t),
    quoteBorder: (t: string) => fg(theme, "mdQuoteBorder", t),
    hr: (t: string) => fg(theme, "mdHr", t),
    listBullet: (t: string) => fg(theme, "mdListBullet", t),
    bold: (t: string) => theme?.bold?.(t) ?? t,
    italic: (t: string) => theme?.italic?.(t) ?? t,
    underline: (t: string) => theme?.underline?.(t) ?? t,
    strikethrough: (t: string) => theme?.strikethrough?.(t) ?? t,
  };

  // Prefer Pi's markdown theme when available for full fidelity.
  let body: string[];
  try {
    const builtIn = getMarkdownTheme();
    const md = new Markdown(text, 0, 0, builtIn, {
      color: (content) => fg(theme, "userMessageText", content),
    });
    body = md.render(contentWidth);
  } catch {
    const md = new Markdown(text, 0, 0, mdTheme as never, {
      color: (content) => fg(theme, "userMessageText", content),
    });
    body = md.render(contentWidth);
  }

  const contentLines = body.length > 0 ? body : [""];
  const paint = (content: string) => paintPanelLine(theme, thinkingLevel, content, contentWidth);
  const vpad = Array.from({ length: VERTICAL_PAD }, () => paint(""));

  const lines = [
    ...vpad,
    ...contentLines.map((line) => paint(line)),
    ...vpad,
  ];

  if (lines.length === 0) return lines;
  lines[0] = OSC133_ZONE_START + lines[0];
  lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
  return lines;
}

/**
 * Patch UserMessageComponent to match editor chrome: ▌ rail + solid panel bg.
 * Returns cleanup that disables the patch (does not unhook prototype — safe multi-install).
 */
export function installUserMessageChrome(options: {
  getTheme: () => ThemeLike | undefined;
  getThinkingLevel: () => string;
  isEnabled: () => boolean;
}): () => void {
  const prototype = UserMessageComponent.prototype as unknown as PatchablePrototype;
  prototype.__agentKitUserMessageGetTheme = options.getTheme;
  prototype.__agentKitUserMessageGetThinkingLevel = options.getThinkingLevel;
  prototype.__agentKitUserMessageIsEnabled = options.isEnabled;
  prototype.__agentKitUserMessageActive = true;

  if (prototype.__agentKitUserMessagePatched && prototype.render === prototype.__agentKitUserMessageWrapper) {
    return () => {
      prototype.__agentKitUserMessageActive = false;
    };
  }

  const originalRender = prototype.render;
  prototype.__agentKitUserMessageOriginalRender = originalRender;

  const wrapper = function renderWithAgentKitUserMessage(this: unknown, width: number): string[] {
    const original = prototype.__agentKitUserMessageOriginalRender ?? originalRender;
    if (!prototype.__agentKitUserMessageActive || !prototype.__agentKitUserMessageIsEnabled?.()) {
      return original.call(this, width);
    }

    const lines = renderUserMessageChrome(
      this,
      width,
      prototype.__agentKitUserMessageGetTheme?.(),
      prototype.__agentKitUserMessageGetThinkingLevel?.() || "off",
    );
    if (!lines) return original.call(this, width);
    return lines;
  };

  prototype.__agentKitUserMessageWrapper = wrapper;
  prototype.render = wrapper;
  prototype.__agentKitUserMessagePatched = true;

  return () => {
    prototype.__agentKitUserMessageActive = false;
  };
}
