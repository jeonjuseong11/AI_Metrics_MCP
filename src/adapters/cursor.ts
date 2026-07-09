/**
 * Cursor 소스 어댑터 (E5).
 *
 * Cursor는 사용 기록을 로컬 SQLite(`state.vscdb`)의 `cursorDiskKV` 테이블에 둔다.
 * 스파이크(2026-06-17) 결과: 메시지별 `createdAt`(ISO)는 100% 존재하나 토큰은 ~4%만 채워지고
 * 모델은 항상 "default"라 비용 산출 불가 → 이 어댑터는 **시간·빈도만** 제공(providesCost=false).
 * 토큰은 전부 0으로 정규화하고, 분석은 cost-unknown 소스를 비용/모델 집계에서 제외한다.
 *
 * 키 형식 `bubbleId:<composerId>:<msgId>` → composerId(대화)별로 세션 1개.
 * 견고성: 파일 부재는 조용한 no-op(Cursor 미설치 정상), 그 외(열기·테이블부재·락·JSON·키 손상)는
 * warning + 부분 결과. 절대 throw 안 함(SourceAdapter 계약).
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync as SqliteDatabase } from "node:sqlite";
import type { NormalizedMessage, NormalizedSession, ParseResult, ParseWarning, SessionContentDigest } from "../types.js";
import type { CollectOptions, SourceAdapter } from "./types.js";

// node:sqlite는 신규 내장이라 번들러(vitest의 vite)가 `node:`를 떼고 "sqlite"로 잘못 resolve한다.
// createRequire로 런타임 Node가 직접 로드하게 우회(타입은 위 `import type`로 유지 — 트랜스폼 시 지워짐).
const nodeRequire = createRequire(import.meta.url);

/** 플랫폼별 Cursor globalStorage 디렉터리. */
function defaultCursorGlobalStorage(): string {
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "Cursor", "User", "globalStorage");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
  }
  return join(home, ".config", "Cursor", "User", "globalStorage");
}

/** node:sqlite는 BLOB 컬럼을 Uint8Array로, TEXT를 string으로 돌려준다 — 둘 다 안전 디코드. */
function decodeValue(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw == null) return "";
  return Buffer.from(raw as Uint8Array).toString("utf-8");
}

export const cursorAdapter: SourceAdapter = {
  id: "cursor",
  displayName: "Cursor",
  providesCost: false,
  async collect(opts: CollectOptions = {}): Promise<ParseResult> {
    const warnings: ParseWarning[] = [];
    const dbPaths = opts.paths ?? [join(opts.rootDir ?? defaultCursorGlobalStorage(), "state.vscdb")];
    const byComposer = new Map<string, NormalizedMessage[]>();
    // 내용 다이제스트: type 1 = user 버블 → userPrompts. 도구·파일은 Cursor 버블 구조가 노이즈라 후속(현재 요청 건수만).
    const userPromptsByComposer = new Map<string, number>();

    for (const dbPath of dbPaths) {
      if (!existsSync(dbPath)) continue; // 부재 = 조용한 no-op(경고 없음)
      try {
        const { DatabaseSync } = nodeRequire("node:sqlite") as { DatabaseSync: typeof SqliteDatabase };
        const db = new DatabaseSync(dbPath, { readOnly: true });
        let rows: Array<{ key: unknown; value: unknown }>;
        try {
          rows = db
            .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
            .all() as Array<{ key: unknown; value: unknown }>;
        } finally {
          db.close();
        }
        for (const row of rows) {
          const key = typeof row.key === "string" ? row.key : "";
          const parts = key.split(":");
          if (parts.length < 3 || !parts[1]) {
            warnings.push({ line: 0, reason: `Cursor 키 형식 비정상 — skip: ${key.slice(0, 40)}` });
            continue;
          }
          const composerId = parts[1];
          let obj: { createdAt?: unknown; type?: unknown; text?: unknown };
          try {
            obj = JSON.parse(decodeValue(row.value));
          } catch {
            warnings.push({ line: 0, reason: `Cursor 버블 JSON 파싱 실패 — skip(${composerId})` });
            continue;
          }
          // 내용: user 버블(type 1)의 텍스트 → userPrompts. 타임스탬프 가드와 독립(메트릭과 분리).
          if (obj.type === 1 && typeof obj.text === "string" && obj.text.trim() !== "") {
            userPromptsByComposer.set(composerId, (userPromptsByComposer.get(composerId) ?? 0) + 1);
          }
          const ca = obj.createdAt;
          const ts = typeof ca === "string" || typeof ca === "number" ? new Date(ca) : null;
          if (ts === null || Number.isNaN(ts.getTime())) {
            warnings.push({ line: 0, reason: `Cursor 버블 createdAt 누락/비정상 — skip(${composerId})` });
            continue;
          }
          const msg: NormalizedMessage = {
            model: "unknown",
            timestamp: ts,
            tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          };
          const list = byComposer.get(composerId);
          if (list) list.push(msg);
          else byComposer.set(composerId, [msg]);
        }
      } catch (e) {
        // 열기/락/테이블 부재 등 — fail-soft.
        warnings.push({ line: 0, reason: `Cursor DB 읽기 실패(${dbPath}): ${(e as Error).message}` });
      }
    }

    const sessions: NormalizedSession[] = [];
    // user 프롬프트만 있고 유효 타임스탬프 메시지가 없는 대화도 내용 세션으로 포함(요청 건수 보존).
    const composerIds = new Set<string>([...byComposer.keys(), ...userPromptsByComposer.keys()]);
    for (const composerId of composerIds) {
      const messages = byComposer.get(composerId) ?? [];
      const times = messages.map((m) => m.timestamp.getTime());
      const session: NormalizedSession = {
        sessionId: composerId,
        projectPath: undefined,
        messages,
        startTime: times.length ? new Date(Math.min(...times)) : undefined,
        endTime: times.length ? new Date(Math.max(...times)) : undefined,
      };
      const up = userPromptsByComposer.get(composerId) ?? 0;
      if (up > 0) {
        const content: SessionContentDigest = { userPrompts: up, toolUses: {}, fileExts: {}, commandVerbs: {} };
        session.content = content;
      }
      sessions.push(session);
    }
    return { sessions, warnings };
  },
};
