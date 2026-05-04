import { loadConfig } from "./config"; // adjust path to your config module

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: Level = "info";

export function setLogLevel(level: Level): void {
  minLevel = level;
}

// ── Pretty mode is OFF by default. ──────────────────────────────────
// Enabled only when `loadConfig().prettyLog === true`. Resolved lazily
// on first log call (and cached) so importing this module never forces
// config to load and tests/scripts that override config still work.
let prettyResolved: boolean | null = null;

function isPretty(): boolean {
  if (prettyResolved !== null) return prettyResolved;
  try {
    prettyResolved = loadConfig().prettyLog === true;
  } catch {
    prettyResolved = false;
  }
  return prettyResolved;
}

/** Test/CLI escape hatch: force-reset the cached decision. */
export function _resetPrettyCache(): void {
  prettyResolved = null;
}

// ── ANSI color helpers (only used in pretty mode) ───────────────────
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const ITALIC = "\x1b[3m";
const fg = (n: number) => `\x1b[38;5;${n}m`;

const LEVEL_COLOR: Record<Level, string> = {
  debug: fg(245), // gray
  info: fg(75), //  light blue
  warn: fg(214), // amber
  error: fg(203), // red
};

const LEVEL_LABEL: Record<Level, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
};

/**
 * Stable color per tag: same charge point ID always gets the same color
 * across the lifetime of the process. Palette deliberately avoids the
 * level colors (gray/blue/amber/red) so a tag never visually clashes
 * with its own level badge.
 */
const TAG_PALETTE = [
  fg(43), //  teal
  fg(141), // purple
  fg(208), // orange
  fg(120), // mint
  fg(177), // pink
  fg(80), //  cyan
  fg(186), // sand
  fg(135), // violet
  fg(44), //  bright teal
  fg(216), // peach
];

function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

/** HH:MM:SS.mmm — local time, no date. Pretty mode only. */
function shortTime(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds()
  )}.${pad(d.getMilliseconds(), 3)}`;
}

// Sentinels — dimmed + italic so they're visually distinct from real values
// and from each other. Italic (\x1b[3m) is widely supported in modern
// terminals (iTerm2, VS Code, Windows Terminal, Kitty, Alacritty).
const SENTINEL = (s: string) => `${DIM}${ITALIC}<${s}>${RESET}`;
const S_NULL = SENTINEL("null");
const S_UNDEF = SENTINEL("undefined");
const S_EMPTY = SENTINEL("empty");
const S_NAN = SENTINEL("NaN");

/**
 * Render `extra` as space-separated key=value with dimmed keys.
 *
 * Distinguishes ambiguous values explicitly so `reason=` is never empty:
 *   - undefined  → <undefined>
 *   - null       → <null>
 *   - ""         → <empty>
 *   - NaN        → <NaN>
 *   - []         → []          (literal, unambiguous)
 *   - {}         → {}          (literal, unambiguous)
 *   - "  "       → "  "        (whitespace-only string, quoted)
 */
function formatExtra(extra: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    let rendered: string;
    if (v === undefined) {
      rendered = S_UNDEF;
    } else if (v === null) {
      rendered = S_NULL;
    } else if (typeof v === "string") {
      if (v === "") rendered = S_EMPTY;
      else if (/[\s"=]/.test(v)) rendered = JSON.stringify(v);
      else rendered = v;
    } else if (typeof v === "number") {
      rendered = Number.isNaN(v) ? S_NAN : String(v);
    } else if (typeof v === "boolean") {
      rendered = String(v);
    } else if (Array.isArray(v) && v.length === 0) {
      rendered = "[]";
    } else if (
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).length === 0
    ) {
      rendered = "{}";
    } else {
      rendered = JSON.stringify(v);
    }
    parts.push(`${DIM}${k}=${RESET}${rendered}`);
  }
  return parts.join(" ");
}

// ── Renderers ───────────────────────────────────────────────────────

function renderJson(
  level: Level,
  tag: string,
  message: string,
  extra?: object
): string {
  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    tag,
    msg: message,
    ...extra,
  };
  return JSON.stringify(entry);
}

function renderPretty(
  level: Level,
  tag: string,
  message: string,
  extra?: object
): string {
  const time = `${DIM}${shortTime(new Date())}${RESET}`;
  const lvl = `${LEVEL_COLOR[level]}${BOLD}${LEVEL_LABEL[level]}${RESET}`;
  const tagPart = `${tagColor(tag)}${tag}${RESET}`;
  const msg =
    level === "error" || level === "warn"
      ? `${BOLD}${message}${RESET}`
      : message;
  const extras =
    extra && Object.keys(extra).length ? " " + formatExtra(extra) : "";
  return `${time} ${lvl} ${tagPart} ${DIM}›${RESET} ${msg}${extras}`;
}

function log(level: Level, tag: string, message: string, extra?: object) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;

  const line = isPretty()
    ? renderPretty(level, tag, message, extra)
    : renderJson(level, tag, message, extra);

  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(line + "\n");
}

export function createLogger(tag: string) {
  return {
    debug: (msg: string, extra?: object) => log("debug", tag, msg, extra),
    info: (msg: string, extra?: object) => log("info", tag, msg, extra),
    warn: (msg: string, extra?: object) => log("warn", tag, msg, extra),
    error: (msg: string, extra?: object) => log("error", tag, msg, extra),
  };
}