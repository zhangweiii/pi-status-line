/**
 * pi Status Line Extension
 *
 * 完全替换 footer，提供与 ccstatusline 对标的所有 widget。
 * 通过自然语言命令配置：/statusline <描述>
 *
 * 支持的 widget：
 *   Core:        model, thinking
 *   Git:         git-branch, git-changes, git-files, git-insertions, git-deletions, git-root, git-worktree
 *   Tokens:      tokens-in, tokens-out, tokens-cached, tokens-total, tokens-daily, tokens-monthly, cache-hit
 *   Token Speed: speed-in, speed-out, speed-total
 *   Context:     context-length, context-pct, context-left, context-bar
 *   Session:     cost, session-clock, session-turns, session-name
 *   Environment: cwd, memory, terminal-width
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── 所有可用 widget 定义 ──────────────────────────────────────────────────────

export const ALL_WIDGETS = {
  // Core
  "model":          { label: "Model",           category: "Core",        desc: "当前模型名称" },
  "thinking":       { label: "Thinking",       category: "Core",        desc: "thinking 等级 (off/minimal/low/medium/high/xhigh)" },

  // Git
  "git-branch":     { label: "Git Branch",     category: "Git",         desc: "git 分支名，带 ⎇ 前缀" },
  "git-changes":    { label: "Git Changes",    category: "Git",         desc: "未提交变更行数 (+insertions,-deletions)" },
  "git-files":      { label: "Git Files",      category: "Git",         desc: "有变更的文件数 (Files: N)" },
  "git-insertions": { label: "Git Insertions", category: "Git",         desc: "未提交新增行数 (+N)" },
  "git-deletions":  { label: "Git Deletions",  category: "Git",         desc: "未提交删除行数 (-N)" },
  "git-root":       { label: "Git Root",       category: "Git",         desc: "git 仓库根目录名" },
  "git-worktree":   { label: "Git Worktree",   category: "Git",         desc: "当前 git worktree 名，带 𖠰 前缀" },

  // Tokens
  "tokens-in":      { label: "Tokens Input",   category: "Tokens",      desc: "本 session 输入 token 数 (In: N)" },
  "tokens-out":     { label: "Tokens Output",  category: "Tokens",      desc: "本 session 输出 token 数 (Out: N)" },
  "tokens-cached":  { label: "Tokens Cached",  category: "Tokens",      desc: "缓存命中 token 数 (Cached: N)" },
  "tokens-total":   { label: "Tokens Total",   category: "Tokens",      desc: "总 token 数 (Total: N)" },
  "tokens-daily":   { label: "Daily Tokens",   category: "Tokens",      desc: "今日所有 session 累计 token 数 (Today: N)" },
  "tokens-monthly": { label: "Monthly Tokens", category: "Tokens",      desc: "本月所有 session 累计 token 数 (Month: N)" },
  "cache-hit":      { label: "Cache Hit",      category: "Tokens",      desc: "缓存命中占比 (Cache: N%)" },

  // Token Speed
  "speed-in":       { label: "Input Speed",    category: "Token Speed", desc: "输入 token 速率 (tk/s)" },
  "speed-out":      { label: "Output Speed",   category: "Token Speed", desc: "输出 token 速率 (tk/s)" },
  "speed-total":    { label: "Total Speed",    category: "Token Speed", desc: "总 token 速率 (tk/s)" },

  // Context
  "context-length": { label: "Context Length", category: "Context",     desc: "当前上下文 token 数 (Ctx: N)" },
  "context-pct":    { label: "Context %",      category: "Context",     desc: "上下文使用百分比 (Ctx: N%)" },
  "context-left":   { label: "Context Left",   category: "Context",     desc: "剩余上下文容量 (Left: N)" },
  "context-bar":    { label: "Context Bar",    category: "Context",     desc: "上下文进度条" },

  // Session
  "cost":           { label: "Session Cost",   category: "Session",     desc: "本 session 累计费用 (Cost: $N)" },
  "session-clock":  { label: "Session Clock",  category: "Session",     desc: "session 运行时长 (Session: Xhr Ym)" },
  "session-turns":  { label: "Session Turns",  category: "Session",     desc: "当前 branch 的 assistant 响应次数 (Turns: N)" },
  "session-name":   { label: "Session Name",   category: "Session",     desc: "当前 session 名称" },

  // Environment
  "cwd":            { label: "Working Dir",    category: "Environment", desc: "当前工作目录 (cwd: ...)" },
  "memory":         { label: "Memory Usage",   category: "Environment", desc: "系统内存使用 (Mem: used/total)" },
  "terminal-width": { label: "Terminal Width", category: "Environment", desc: "终端宽度列数 (Term: N)" },
} as const;

export type WidgetId = keyof typeof ALL_WIDGETS;

// ─── 配置 ─────────────────────────────────────────────────────────────────────

interface Config {
  rows: WidgetId[][];
}

const DEFAULT_ROWS: WidgetId[][] = [
  ["model", "thinking", "git-branch", "git-files", "context-pct", "context-left"],
  ["cost", "tokens-in", "tokens-out", "tokens-daily", "tokens-monthly", "session-clock"],
];

const LAYOUT_PRESETS = {
  "single-line-balanced": {
    desc: "单排平衡布局：适合宽屏，所有关键信息放在一行",
    rows: [[
      "model", "thinking", "git-branch", "git-files", "context-pct", "context-left",
      "cost", "tokens-in", "tokens-out", "tokens-daily", "tokens-monthly", "session-clock",
    ]] as WidgetId[][],
  },
  "two-line-balanced": {
    desc: "双排平衡布局：第一排看当前状态，第二排看 token / cost / 时长",
    rows: DEFAULT_ROWS,
  },
  "two-line-compact": {
    desc: "双排紧凑布局：更适合普通宽度终端，保留核心状态与 token 日/月统计",
    rows: [
      ["model", "git-branch", "context-pct", "cost"],
      ["tokens-in", "tokens-out", "tokens-daily", "tokens-monthly", "session-clock"],
    ] as WidgetId[][],
  },
  "three-line-detailed": {
    desc: "三排详细布局：模型与 git / context 与 cost / token 与时间分层显示",
    rows: [
      ["model", "thinking", "git-branch", "git-files"],
      ["context-pct", "context-left", "cost"],
      ["tokens-in", "tokens-out", "tokens-daily", "tokens-monthly", "session-clock"],
    ] as WidgetId[][],
  },
} as const;

type PresetId = keyof typeof LAYOUT_PRESETS;

const CONFIG_PATH = join(homedir(), ".pi", "agent", "statusline.json");

function normalizeRows(rows: unknown): WidgetId[][] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => Array.isArray(row) ? row.filter((w): w is WidgetId => typeof w === "string" && w in ALL_WIDGETS) : [])
    .filter((row) => row.length > 0);
}

function rowsToWidgets(rows: WidgetId[][]): WidgetId[] {
  return rows.flat();
}

function formatRows(rows: WidgetId[][]): string {
  return rows.map((row, i) => `row${i + 1}: ${row.join(", ")}`).join(" | ");
}

function loadConfig(): Config {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

    const rows = normalizeRows(raw.rows);
    if (rows.length > 0) return { rows };

    if (Array.isArray(raw.widgets) && raw.widgets.every((w: string) => w in ALL_WIDGETS)) {
      return { rows: [raw.widgets as WidgetId[]] };
    }
  } catch {}
  return { rows: DEFAULT_ROWS.map((row) => [...row]) };
}

function saveConfig(cfg: Config): void {
  try {
    mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify({ rows: cfg.rows, widgets: rowsToWidgets(cfg.rows) }, null, 2), "utf8");
  } catch {}
}

// ─── 自然语言解析交给 LLM；本地只保留 reset / help 等确定性命令 ────────────────

// ─── Git 工具 ─────────────────────────────────────────────────────────────────

function gitRun(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
    }).toString().trim();
  } catch { return ""; }
}

function isGitRepo(cwd: string): boolean {
  return gitRun("rev-parse --is-inside-work-tree", cwd) === "true";
}

function getGitChangeCounts(cwd: string): { insertions: number; deletions: number } {
  const out = gitRun("diff --shortstat", cwd);
  const ins = /(\d+) insertion/.exec(out)?.[1];
  const del = /(\d+) deletion/.exec(out)?.[1];
  return { insertions: ins ? parseInt(ins) : 0, deletions: del ? parseInt(del) : 0 };
}

function getGitWorktreeName(gitDir: string): string {
  const norm = gitDir.replace(/\\/g, "/");
  let wt = "main";
  if (!norm.endsWith("/.git") && norm !== ".git") {
    const idx = norm.lastIndexOf(".git/worktrees/");
    if (idx !== -1) wt = norm.slice(idx + ".git/worktrees/".length) || "main";
    else {
      const bidx = norm.lastIndexOf("/worktrees/");
      if (bidx !== -1) wt = norm.slice(bidx + "/worktrees/".length) || "main";
    }
  }
  return wt;
}

interface GitStats {
  branch: string | null;
  insertions: number;
  deletions: number;
  changedFiles: number;
  rootName: string | null;
  worktreeName: string | null;
}

function getGitStats(cwd: string, branch: string | null): GitStats | null {
  if (!isGitRepo(cwd)) return null;

  const { insertions, deletions } = getGitChangeCounts(cwd);
  const status = gitRun("status --porcelain --untracked-files=all", cwd);
  const changedFiles = status ? status.split("\n").filter(Boolean).length : 0;

  const root = gitRun("rev-parse --show-toplevel", cwd);
  const rootName = root
    ? root.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean).pop() ?? root
    : null;

  const gitDir = gitRun("rev-parse --git-dir", cwd);
  const worktreeName = gitDir ? getGitWorktreeName(gitDir) : null;

  return { branch, insertions, deletions, changedFiles, rootName, worktreeName };
}

// ─── 格式化工具 ───────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── 日/月 token 统计（扫描 session 文件）─────────────────────────────────────

const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

// 简单内存缓存，避免每次 render 都扫文件
interface TokenScanCache {
  daily: number;
  monthly: number;
  dailyKey: string;   // 当前日期 YYYY-MM-DD
  monthlyKey: string; // 当前月份 YYYY-MM
  lastScan: number;   // ms timestamp
}
let tokenScanCache: TokenScanCache | null = null;
const SCAN_TTL = 60_000; // 60 秒刷新一次

function getDatePrefix(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}
function getMonthPrefix(date: Date): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

function scanSessionTokens(prefix: string): number {
  let total = 0;
  try {
    const dirs = readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const dirPath = join(SESSIONS_DIR, dir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        const files = readdirSync(dirPath).filter(f => f.startsWith(prefix) && f.endsWith(".jsonl"));
        for (const file of files) {
          try {
            const content = readFileSync(join(dirPath, file), "utf8");
            for (const line of content.split("\n")) {
              if (!line.includes('"role":"assistant"')) continue;
              try {
                const entry = JSON.parse(line);
                const msg = entry.message ?? entry;
                if (msg.role === "assistant" && msg.usage?.totalTokens) {
                  total += msg.usage.totalTokens;
                }
              } catch {}
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return total;
}

function getTokenScanCache(): TokenScanCache {
  const now = Date.now();
  const today = getDatePrefix(new Date());
  const month = getMonthPrefix(new Date());

  if (
    tokenScanCache &&
    now - tokenScanCache.lastScan < SCAN_TTL &&
    tokenScanCache.dailyKey === today &&
    tokenScanCache.monthlyKey === month
  ) {
    return tokenScanCache;
  }

  const daily = scanSessionTokens(today);
  const monthly = scanSessionTokens(month);
  tokenScanCache = { daily, monthly, dailyKey: today, monthlyKey: month, lastScan: now };
  return tokenScanCache;
}

function fmtCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(5)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return "<1m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}hr`;
  return `${h}hr ${m}m`;
}

function fmtBytes(bytes: number): string {
  const G = 1024 ** 3, M = 1024 ** 2, K = 1024;
  if (bytes >= G) return `${(bytes / G).toFixed(1)}G`;
  if (bytes >= M) return `${(bytes / M).toFixed(0)}M`;
  if (bytes >= K) return `${(bytes / K).toFixed(0)}K`;
  return `${bytes}B`;
}

function makeProgressBar(pct: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

interface SessionTokenStats {
  input: number;
  output: number;
  cached: number;
  total: number;
  cost: number;
  assistantTurns: number;
  cacheHitRatio: number | null;
}

function getSessionTokenStats(ctx: ExtensionContext): SessionTokenStats {
  let input = 0, output = 0, cached = 0, total = 0, cost = 0, assistantTurns = 0;

  for (const e of ctx.sessionManager.getBranch()) {
    if (e.type === "message" && e.message.role === "assistant") {
      const m = e.message as AssistantMessage;
      assistantTurns += 1;
      input += m.usage.input;
      output += m.usage.output;
      cached += m.usage.cacheRead;
      total += m.usage.totalTokens;
      cost += m.usage.cost.total;
    }
  }

  const cacheBase = input + cached;
  const cacheHitRatio = cacheBase > 0 ? (cached / cacheBase) * 100 : null;

  return { input, output, cached, total, cost, assistantTurns, cacheHitRatio };
}

interface ContextStats {
  tokens: number | null;
  percent: number | null;
  contextWindow: number | null;
  remaining: number | null;
}

function getContextStats(ctx: ExtensionContext): ContextStats {
  const usage = ctx.getContextUsage();
  if (!usage) {
    return { tokens: null, percent: null, contextWindow: null, remaining: null };
  }

  const tokens = usage.tokens ?? null;
  const contextWindow = usage.contextWindow ?? null;
  const percent = usage.percent ?? (tokens != null && contextWindow ? (tokens / contextWindow) * 100 : null);
  const remaining = tokens != null && contextWindow ? Math.max(0, contextWindow - tokens) : null;

  return { tokens, percent, contextWindow, remaining };
}

// ─── Widget 渲染 ──────────────────────────────────────────────────────────────

interface RenderArgs {
  ctx: ExtensionContext;
  theme: ExtensionContext["ui"]["theme"];
  sessionStart: number;
  // 速率计算用的累积数据
  speedData: { totalMs: number; inputTokens: number; outputTokens: number };
  tokenStats: SessionTokenStats;
  contextStats: ContextStats;
  gitStats: GitStats | null;
  thinkingLevel: string | null;
  sessionName: string | null;
}

function renderWidget(id: WidgetId, ra: RenderArgs): string | null {
  const { ctx, theme: t, sessionStart, speedData, tokenStats, contextStats, gitStats, thinkingLevel, sessionName } = ra;
  const cwd = ctx.cwd;

  switch (id) {
    // ── Core ──
    case "model": {
      const m = ctx.model?.id ?? "—";
      return t.fg("muted", "Model: ") + t.fg("accent", m);
    }
    case "thinking": {
      if (!thinkingLevel || thinkingLevel === "off") return null;
      return t.fg("muted", "Think: ") + t.fg("dim", thinkingLevel);
    }

    // ── Git ──
    case "git-branch": {
      if (!gitStats?.branch) return t.fg("dim", "⎇ no git");
      return t.fg("muted", "⎇ ") + t.fg("dim", gitStats.branch);
    }
    case "git-changes": {
      if (!gitStats) return t.fg("dim", "(no git)");
      return t.fg("dim", `(+${gitStats.insertions},-${gitStats.deletions})`);
    }
    case "git-files": {
      if (!gitStats) return null;
      return t.fg("muted", "Files: ") + t.fg("dim", String(gitStats.changedFiles));
    }
    case "git-insertions": {
      if (!gitStats) return null;
      return t.fg("success", `+${gitStats.insertions}`);
    }
    case "git-deletions": {
      if (!gitStats) return null;
      return t.fg("error", `-${gitStats.deletions}`);
    }
    case "git-root": {
      if (!gitStats?.rootName) return t.fg("dim", "(no git)");
      return t.fg("dim", `(${gitStats.rootName})`);
    }
    case "git-worktree": {
      if (!gitStats?.worktreeName) return t.fg("dim", "𖠰 no git");
      return t.fg("muted", "𖠰 ") + t.fg("dim", gitStats.worktreeName);
    }

    // ── Tokens ──
    case "tokens-in": {
      return t.fg("muted", "In: ") + t.fg("dim", fmtTokens(tokenStats.input));
    }
    case "tokens-out": {
      return t.fg("muted", "Out: ") + t.fg("dim", fmtTokens(tokenStats.output));
    }
    case "tokens-cached": {
      return t.fg("muted", "Cached: ") + t.fg("dim", fmtTokens(tokenStats.cached));
    }
    case "tokens-total": {
      return t.fg("muted", "Total: ") + t.fg("dim", fmtTokens(tokenStats.total));
    }
    case "tokens-daily": {
      const { daily } = getTokenScanCache();
      return t.fg("muted", "Today: ") + t.fg("dim", fmtTokens(daily));
    }
    case "tokens-monthly": {
      const { monthly } = getTokenScanCache();
      return t.fg("muted", "Month: ") + t.fg("dim", fmtTokens(monthly));
    }
    case "cache-hit": {
      const ratio = tokenStats.cacheHitRatio ?? 0;
      return t.fg("muted", "Cache: ") + t.fg("dim", `${ratio.toFixed(1)}%`);
    }

    // ── Token Speed ──
    case "speed-in": {
      if (!speedData.totalMs) return null;
      const s = speedData.totalMs / 1000;
      return t.fg("muted", "In: ") + t.fg("dim", `${(speedData.inputTokens / s).toFixed(0)}tk/s`);
    }
    case "speed-out": {
      if (!speedData.totalMs) return null;
      const s = speedData.totalMs / 1000;
      return t.fg("muted", "Out: ") + t.fg("dim", `${(speedData.outputTokens / s).toFixed(0)}tk/s`);
    }
    case "speed-total": {
      if (!speedData.totalMs) return null;
      const s = speedData.totalMs / 1000;
      const total = speedData.inputTokens + speedData.outputTokens;
      return t.fg("muted", "Speed: ") + t.fg("dim", `${(total / s).toFixed(0)}tk/s`);
    }

    // ── Context ──
    case "context-length": {
      if (contextStats.tokens == null) return null;
      return t.fg("muted", "Ctx: ") + t.fg("dim", fmtTokens(contextStats.tokens));
    }
    case "context-pct": {
      if (contextStats.percent == null) return null;
      return t.fg("muted", "Ctx: ") + t.fg("dim", `${contextStats.percent.toFixed(1)}%`);
    }
    case "context-left": {
      if (contextStats.remaining == null) return null;
      return t.fg("muted", "Left: ") + t.fg("dim", fmtTokens(contextStats.remaining));
    }
    case "context-bar": {
      if (contextStats.tokens == null || contextStats.contextWindow == null) return null;
      const pct = Math.min(100, contextStats.percent ?? 0);
      const bar = makeProgressBar(pct, 16);
      const usedK = Math.round(contextStats.tokens / 1000);
      const totalK = Math.round(contextStats.contextWindow / 1000);
      return t.fg("muted", "Ctx: ") + t.fg("dim", `${bar} ${usedK}k/${totalK}k`);
    }

    // ── Session ──
    case "cost": {
      return t.fg("muted", "Cost: ") + t.fg("dim", fmtCost(tokenStats.cost));
    }
    case "session-clock": {
      const elapsed = Date.now() - sessionStart;
      return t.fg("muted", "Session: ") + t.fg("dim", fmtDuration(elapsed));
    }
    case "session-turns": {
      return t.fg("muted", "Turns: ") + t.fg("dim", String(tokenStats.assistantTurns));
    }
    case "session-name": {
      if (!sessionName) return null;
      return t.fg("muted", "Session: ") + t.fg("dim", sessionName);
    }

    // ── Environment ──
    case "cwd": {
      const home = homedir();
      const dir = cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
      return t.fg("dim", dir);
    }
    case "memory": {
      try {
        const { totalmem, freemem, platform } = require("node:os");
        const total = totalmem();
        let used: number;
        if (platform() === "darwin") {
          try {
            const vmstat = execSync("vm_stat", { stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).toString();
            const psMatch = /page size of (\d+)/.exec(vmstat);
            const pageSize = psMatch ? parseInt(psMatch[1]) : 16384;
            const actMatch = /Pages active:\s+(\d+)/.exec(vmstat);
            const wiredMatch = /Pages wired down:\s+(\d+)/.exec(vmstat);
            const act = actMatch ? parseInt(actMatch[1]) : 0;
            const wired = wiredMatch ? parseInt(wiredMatch[1]) : 0;
            used = (act + wired) * pageSize;
          } catch { used = total - freemem(); }
        } else { used = total - freemem(); }
        return t.fg("muted", "Mem: ") + t.fg("dim", `${fmtBytes(used)}/${fmtBytes(total)}`);
      } catch { return null; }
    }
    case "terminal-width": {
      return t.fg("muted", "Term: ") + t.fg("dim", String(process.stdout.columns ?? "?"));
    }

    default:
      return null;
  }
}

// ─── 主插件 ───────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let config = loadConfig();
  let sessionStart = Date.now();
  let speedData = { totalMs: 0, inputTokens: 0, outputTokens: 0 };

  // 当 /statusline 命令触发后，下一轮 before_agent_start 注入配置上下文
  let pendingConfigRequest: string | null = null;

  // ── footer 安装 ─────────────────────────────────────────────────────────────
  function installFooter(ctx: ExtensionContext) {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const branch = footerData.getGitBranch();
          const ra: RenderArgs = {
            ctx,
            theme,
            sessionStart,
            speedData,
            tokenStats: getSessionTokenStats(ctx),
            contextStats: getContextStats(ctx),
            gitStats: getGitStats(ctx.cwd, branch),
            thinkingLevel: pi.getThinkingLevel?.() ?? null,
            sessionName: pi.getSessionName?.() ?? null,
          };
          const sep = theme.fg("dim", " | ");
          const lines = config.rows
            .map((row) => row.map((id) => renderWidget(id, ra)).filter((s): s is string => s != null))
            .filter((parts) => parts.length > 0)
            .map((parts) => truncateToWidth(parts.join(sep), width));

          if (lines.length === 0) return [theme.fg("dim", "(no widgets — /statusline to configure)")];
          return lines;
        },
      };
    });
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    sessionStart = Date.now();
    speedData = { totalMs: 0, inputTokens: 0, outputTokens: 0 };
    config = loadConfig();
    installFooter(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    sessionStart = Date.now();
    speedData = { totalMs: 0, inputTokens: 0, outputTokens: 0 };
    installFooter(ctx);
  });

  pi.on("agent_end", async (event, _ctx) => {
    for (const msg of event.messages) {
      if (msg.role === "assistant") {
        const m = msg as AssistantMessage;
        speedData.inputTokens += m.usage.input;
        speedData.outputTokens += m.usage.output;
        speedData.totalMs += (m.usage.output / 50) * 1000;
      }
    }
  });

  // ── configure_statusline 工具：LLM 理解自然语言后调用此工具更新配置 ─────────────
  const { Type } = require("@sinclair/typebox");

  pi.registerTool({
    name: "configure_statusline",
    label: "Configure Status Line",
    description:
      "Update the pi status line widgets and layout rows. " +
      "Use this when the user asks to configure the status line footer, including one-line/two-line/three-line layouts. " +
      "Available widget IDs: " + Object.keys(ALL_WIDGETS).join(", ") + ". " +
      "Available presets: " + Object.keys(LAYOUT_PRESETS).join(", "),
    parameters: Type.Object({
      widgets: Type.Optional(Type.Array(
        Type.String({ description: "A valid widget ID" }),
        { description: "Ordered list of widget IDs to show in a single-row status line" }
      )),
      rows: Type.Optional(Type.Array(
        Type.Array(Type.String({ description: "A valid widget ID" })),
        { description: "Ordered rows of widget IDs for a multi-line status line" }
      )),
      preset: Type.Optional(Type.String({ description: "Optional preset id, e.g. two-line-balanced" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      let nextRows: WidgetId[][] = [];
      let invalid: string[] = [];
      let source = "custom";

      const preset = typeof params.preset === "string" ? params.preset : undefined;
      if (preset && preset in LAYOUT_PRESETS) {
        nextRows = LAYOUT_PRESETS[preset as PresetId].rows.map((row) => [...row]);
        source = `preset:${preset}`;
      } else if (Array.isArray(params.rows)) {
        invalid = (params.rows as string[][]).flat().filter((w) => !(w in ALL_WIDGETS));
        nextRows = normalizeRows(params.rows);
      } else if (Array.isArray(params.widgets)) {
        invalid = (params.widgets as string[]).filter((w) => !(w in ALL_WIDGETS));
        const valid = (params.widgets as string[]).filter((w) => w in ALL_WIDGETS) as WidgetId[];
        if (valid.length > 0) nextRows = [valid];
      }

      if (nextRows.length === 0) {
        throw new Error(
          `No valid status line configuration provided. Available widgets: ${Object.keys(ALL_WIDGETS).join(", ")}. ` +
          `Available presets: ${Object.keys(LAYOUT_PRESETS).join(", ")}`
        );
      }

      config = { rows: nextRows };
      saveConfig(config);
      installFooter(ctx);

      const msg =
        `✓ Status line updated (${source}): ${formatRows(nextRows)}` +
        (invalid.length > 0 ? `\n(skipped unknown IDs: ${invalid.join(", ")})` : "");

      return {
        content: [{ type: "text" as const, text: msg }],
        details: { rows: nextRows, widgets: rowsToWidgets(nextRows), preset: preset ?? null },
      };
    },
  });

  // ── before_agent_start：有待处理配置请求时注入 system prompt ────────────────────
  pi.on("before_agent_start", async (event, _ctx) => {
    if (!pendingConfigRequest) return undefined;

    const request = pendingConfigRequest;
    pendingConfigRequest = null;

    const widgetList = Object.entries(ALL_WIDGETS)
      .map(([id, info]) => `  ${id}: ${info.desc}`)
      .join("\n");
    const presetList = Object.entries(LAYOUT_PRESETS)
      .map(([id, info]) => `  ${id}: ${info.desc}`)
      .join("\n");

    const injection =
      `\n\n=== STATUS LINE CONFIGURATION ===\n` +
      `The user invoked /statusline to configure the footer. ` +
      `You MUST call the \`configure_statusline\` tool to apply the configuration.\n\n` +
      `Available widget IDs:\n${widgetList}\n\n` +
      `Available presets:\n${presetList}\n\n` +
      `Current layout: ${formatRows(config.rows)}\n\n` +
      `User's request: "${request}"\n\n` +
      `Instructions:\n` +
      `1. Interpret the user's request semantically (any language, any phrasing); do not rely on keyword lookup\n` +
      `2. If the user asks for a preset-like layout (single-line / two-line / three-line, compact, balanced, detailed), prefer using preset\n` +
      `3. If the user describes exact row content, call configure_statusline with rows\n` +
      `4. If the user only lists widgets without row grouping, call configure_statusline with widgets\n` +
      `5. Briefly confirm what was configured (one sentence)\n` +
      `=== END ===`;

    return { systemPrompt: event.systemPrompt + injection };
  });

  // ── /statusline 命令 ────────────────────────────────────────────────────────
  pi.registerCommand("statusline", {
    description: "用自然语言配置 status line 显示的条目",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();

      // 无参数：显示帮助
      if (!trimmed) {
        const byCategory: Record<string, string[]> = {};
        for (const [id, info] of Object.entries(ALL_WIDGETS)) {
          const cat = info.category;
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push(`  ${id.padEnd(18)} ${info.desc}`);
        }
        const lines = [
          `当前配置: ${formatRows(config.rows)}`,
          "",
          "可用 preset:",
          ...Object.entries(LAYOUT_PRESETS).map(([id, info]) => `  ${id.padEnd(20)} ${info.desc}`),
          "",
          "自然语言示例:",
          "  /statusline 切成单排平衡布局",
          "  /statusline 改成双排，第一排看模型和 git，第二排看 token、费用和时长",
          "  /statusline 详细一点，分三排，最后一排放今天、本月和 session 时长",
          "",
          "可用 widget:",
          ...Object.entries(byCategory).flatMap(([cat, ws]) => [`[${cat}]`, ...ws]),
          "",
          "直接用自然语言描述你想要的内容，例如：",
          "  /statusline 切成双排平衡布局",
          "  /statusline 紧凑布局",
          "  /statusline 改成三排详细布局",
          "  /statusline 两排，第一排模型、分支、上下文，第二排费用、in/out、today、month、时长",
          "  /statusline 第一排模型、分支、上下文，第二排 today、month、cost、时长",
          "  /statusline show git branch, cost, and context usage",
          "  /statusline reset",
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      // reset
      if (/^(reset|重置|默认|default)$/i.test(trimmed)) {
        config = { rows: DEFAULT_ROWS.map((row) => [...row]) };
        saveConfig(config);
        installFooter(ctx);
        ctx.ui.notify(`✓ 已重置为默认: ${formatRows(config.rows)}`, "info");
        return;
      }

      // 其他配置统一交给 LLM 做自然语言理解，避免本地关键词猜测误判
      // 设置待处理标记，下一轮 before_agent_start 会注入 system prompt
      pendingConfigRequest = trimmed;

      // 把用户原话发给 LLM，LLM 会根据注入的 system prompt 调用 configure_statusline 工具
      pi.sendUserMessage(trimmed, { deliverAs: "followUp" });
    },
  });
}
