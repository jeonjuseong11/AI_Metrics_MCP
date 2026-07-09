/**
 * GitHub Copilot(VS Code Chat) 소스 어댑터 (Phase 2).
 *
 * VS Code는 Copilot 대화를 `<Code>/User/workspaceStorage/<hash>/chatSessions/*.json`에 둔다.
 * 실측(2026-07-09): 세션 JSON에 `requests[]` = {message.text(프롬프트), timestamp(ms), modelId
 * (예 "copilot/gpt-5-mini")}. **토큰은 없음** → Cursor처럼 providesCost=false(시간·요청·모델명만).
 *
 * 견고성(SourceAdapter 계약): 파일 부재/손상은 조용한 no-op·warning, 절대 throw 안 함.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { NormalizedMessage, NormalizedSession, ParseResult, ParseWarning, SessionContentDigest } from "../types.js";
import type { CollectOptions, SourceAdapter } from "./types.js";

/** 플랫폼별 VS Code User 디렉터리. */
function defaultCodeUserDir(): string {
  const home = homedir();
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Code", "User");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Code", "User");
  }
  return join(home, ".config", "Code", "User");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function toDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** chatSession JSON 1개 → 정규화 세션(순수). 토큰 0(cost-unknown), model=modelId, userPrompts=요청 수. */
export function parseCopilotSession(jsonText: string, fallbackId: string): { session: NormalizedSession; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    warnings.push({ line: 0, reason: `Copilot 세션 JSON 파싱 실패 — skip(${fallbackId})` });
    return { session: { sessionId: fallbackId, projectPath: undefined, messages: [], startTime: undefined, endTime: undefined }, warnings };
  }
  const rec = isObj(obj) ? obj : {};
  const reqs = Array.isArray(rec.requests) ? rec.requests : [];
  const messages: NormalizedMessage[] = [];
  let userPrompts = 0;

  for (const r of reqs) {
    if (!isObj(r)) continue;
    const msg = r.message;
    const text = isObj(msg) && typeof msg.text === "string" ? msg.text : "";
    if (text.trim() !== "") userPrompts += 1;
    const ts = toDate(r.timestamp);
    if (ts === null) continue; // 시각 없는 요청은 시간 롤업에서 제외(내용은 위에서 반영)
    const model = typeof r.modelId === "string" ? r.modelId : "unknown";
    messages.push({ model, timestamp: ts, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } });
  }

  // 시각: 요청 타임스탬프 우선, 없으면 세션 creation/lastMessage.
  const times = messages.map((m) => m.timestamp.getTime());
  const created = toDate(rec.creationDate);
  const last = toDate(rec.lastMessageDate);
  const startTime = times.length ? new Date(Math.min(...times)) : (created ?? undefined);
  const endTime = times.length ? new Date(Math.max(...times)) : (last ?? created ?? undefined);

  const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : fallbackId;
  const session: NormalizedSession = { sessionId, projectPath: undefined, messages, startTime, endTime };
  if (userPrompts > 0) {
    const content: SessionContentDigest = { userPrompts, toolUses: {}, fileExts: {}, commandVerbs: {} };
    session.content = content;
  }
  return { session, warnings };
}

/** workspaceStorage 하위 각 워크스페이스의 chatSessions JSON 발견. 디렉터리 없으면 []. */
async function discoverCopilotFiles(userDir: string): Promise<string[]> {
  const wsRoot = join(userDir, "workspaceStorage");
  if (!existsSync(wsRoot)) return [];
  const files: string[] = [];
  let workspaces: string[];
  try {
    workspaces = (await readdir(wsRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  for (const ws of workspaces) {
    const dir = join(wsRoot, ws, "chatSessions");
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.toLowerCase().endsWith(".json")) files.push(join(dir, e.name));
      }
    } catch {
      // chatSessions 없는 워크스페이스는 정상 skip.
    }
  }
  return files;
}

export const copilotAdapter: SourceAdapter = {
  id: "copilot",
  displayName: "GitHub Copilot",
  providesCost: false, // 토큰 미기록 → 시간·요청·모델명만(비용 미상)
  async collect(opts: CollectOptions = {}): Promise<ParseResult> {
    const files = opts.paths ?? (await discoverCopilotFiles(opts.rootDir ?? defaultCodeUserDir()));
    const sessions: NormalizedSession[] = [];
    const warnings: ParseWarning[] = [];
    for (const f of files) {
      try {
        const text = await readFile(f, "utf-8");
        const { session, warnings: w } = parseCopilotSession(text, basename(f).replace(/\.json$/i, ""));
        sessions.push(session);
        warnings.push(...w);
      } catch (e) {
        warnings.push({ line: 0, reason: `Copilot 파일 읽기 실패(${basename(f)}): ${(e as Error).message}` });
      }
    }
    return { sessions, warnings };
  },
};
