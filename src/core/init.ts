/**
 * aimm init — SessionEnd hook · MCP 자동 등록(원커맨드 셋업).
 *
 * 안전: 안정 센티넬(cli.js … hook)로 멱등(경로가 바뀌어도 교체, 중복 없음),
 * 우리 키만 딥머지, 타임스탬프 백업, IO는 주입(테스트가 바이너리·디스크 비의존).
 * 순수 헬퍼(isAimmHook/merge*)는 부수효과 없음 → 단위 테스트.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 이 모듈(dist/core/init.js)의 URL. cmdInit이 runInit에 넘겨 형제 dist/cli.js를 해석한다. */
export const INIT_MODULE_URL = import.meta.url;

/** SessionEnd hook 커맨드가 aimm 것인가 — 절대경로 아닌 안정 마커(cli.js … hook)로 판정. */
const HOOK_MARKER = /(?:^|[\\/])cli\.js["']?\s+hook(?:\s|$)/;
export function isAimmHook(command: string): boolean {
  return HOOK_MARKER.test(command);
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? deepCopy(v as Record<string, unknown>) : {};
}

interface HookEntry {
  type?: string;
  command?: string;
}
interface HookGroup {
  hooks?: HookEntry[];
}

export function mergeSessionEndHook(
  settings: unknown,
  command: string,
): { settings: Record<string, unknown>; action: "add" | "replace" | "noop" } {
  const s = asObj(settings);
  const hooks = (s.hooks = asObj(s.hooks));
  const list = (Array.isArray(hooks.SessionEnd) ? hooks.SessionEnd : (hooks.SessionEnd = [])) as HookGroup[];
  for (const group of list) {
    if (!group || !Array.isArray(group.hooks)) continue;
    for (const h of group.hooks) {
      if (h && h.type === "command" && typeof h.command === "string" && isAimmHook(h.command)) {
        if (h.command === command) return { settings: s, action: "noop" };
        h.command = command;
        return { settings: s, action: "replace" };
      }
    }
  }
  list.push({ hooks: [{ type: "command", command }] });
  return { settings: s, action: "add" };
}

export function mergeMcpJson(json: unknown, absCliJs: string): Record<string, unknown> {
  const j = asObj(json);
  const servers = (j.mcpServers = asObj(j.mcpServers));
  // 기존 aimm 항목의 사용자 키(env·cwd 등)는 보존하고 command/args만 갱신(우리 키만 딥머지).
  const aimm = asObj(servers.aimm);
  aimm.command = "node";
  aimm.args = [absCliJs, "mcp"];
  servers.aimm = aimm;
  return j;
}

export interface InitIo {
  homedir(): string;
  cwd(): string;
  now(): string;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  backup(path: string): string;
  registerMcp(absCliJs: string): boolean;
}

export interface InitResult {
  cliJs: string;
  settingsPath: string;
  hookAction: "add" | "replace" | "noop";
  mcpVia: "claude" | "mcp.json";
  mcpJsonPath: string;
  warnings: string[];
  backups: string[];
}

/** init.js(dist/core/) 기준 형제 dist/cli.js 해석. src/tsx 실행이면 경고. */
function resolveCliJs(moduleUrl: string): { path: string; warning?: string } {
  const here = fileURLToPath(moduleUrl);
  const cliJs = join(dirname(here), "..", "cli.js");
  if (/[\\/]src[\\/]/.test(here) || here.endsWith(".ts")) {
    return {
      path: cliJs,
      warning: "빌드된 dist에서 실행하세요(node dist/cli.js init). src/tsx 실행은 등록 경로가 부정확합니다.",
    };
  }
  return { path: cliJs };
}

export function runInit(io: InitIo, moduleUrl: string, opts: { dryRun?: boolean } = {}): InitResult {
  const { path: cliJs, warning } = resolveCliJs(moduleUrl);
  const warnings = warning ? [warning] : [];
  const backups: string[] = [];

  const settingsPath = join(io.homedir(), ".claude", "settings.json");
  const raw = io.readFile(settingsPath);
  const command = `node ${JSON.stringify(cliJs)} hook`;
  const { settings: merged, action } = mergeSessionEndHook(raw ? JSON.parse(raw) : {}, command);

  const mcpJsonPath = join(io.cwd(), ".mcp.json");

  if (opts.dryRun) {
    return { cliJs, settingsPath, hookAction: action, mcpVia: "claude", mcpJsonPath, warnings, backups };
  }

  if (action !== "noop") {
    if (raw !== null) backups.push(io.backup(settingsPath));
    io.writeFile(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  }

  let mcpVia: "claude" | "mcp.json" = "claude";
  if (!io.registerMcp(cliJs)) {
    mcpVia = "mcp.json";
    const existing = io.readFile(mcpJsonPath);
    if (existing !== null) backups.push(io.backup(mcpJsonPath));
    io.writeFile(mcpJsonPath, JSON.stringify(mergeMcpJson(existing ? JSON.parse(existing) : {}, cliJs), null, 2) + "\n");
  }

  return { cliJs, settingsPath, hookAction: action, mcpVia, mcpJsonPath, warnings, backups };
}
