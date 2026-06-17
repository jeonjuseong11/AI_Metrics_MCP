import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync as SqliteDatabase } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cursorAdapter } from "../src/adapters/cursor.js";

// node:sqlite를 createRequire로 로드(번들러 우회 — cursor.ts와 동일 사유).
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof SqliteDatabase };

const tmpDirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "aimm-cursor-test-"));
  tmpDirs.push(d);
  return d;
}
afterEach(async () => {
  vi.restoreAllMocks();
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true });
});

/** node:sqlite로 임시 state.vscdb 생성. */
function writeVscdb(path: string, rows: Array<[string, string | Buffer]>, opts: { withTable?: boolean } = {}): void {
  const db = new DatabaseSync(path);
  if (opts.withTable === false) {
    db.exec("CREATE TABLE ItemTable (key TEXT, value BLOB)"); // cursorDiskKV 없음
  } else {
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
    const ins = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
    for (const [k, v] of rows) ins.run(k, v);
  }
  db.close();
}

function bubble(composerId: string, msgId: string, createdAt: string): [string, string] {
  return [
    `bubbleId:${composerId}:${msgId}`,
    JSON.stringify({ createdAt, type: 1, tokenCount: { inputTokens: 0, outputTokens: 0 } }),
  ];
}

describe("cursorAdapter 계약 값", () => {
  it("id/displayName/providesCost", () => {
    expect(cursorAdapter.id).toBe("cursor");
    expect(cursorAdapter.displayName).toBe("Cursor");
    expect(cursorAdapter.providesCost).toBe(false);
  });
});

describe("cursorAdapter.collect", () => {
  it("paths: composer별 세션, 토큰 0", async () => {
    const dir = await makeTmpDir();
    const dbPath = join(dir, "state.vscdb");
    writeVscdb(dbPath, [
      bubble("compA", "m1", "2026-06-12T05:00:00.000Z"),
      bubble("compA", "m2", "2026-06-12T06:00:00.000Z"),
      bubble("compB", "m1", "2026-06-13T01:00:00.000Z"),
    ]);
    const r = await cursorAdapter.collect({ paths: [dbPath] });
    expect(r.warnings).toEqual([]);
    expect(r.sessions).toHaveLength(2);
    const a = r.sessions.find((s) => s.sessionId === "compA")!;
    expect(a.messages).toHaveLength(2);
    expect(a.messages[0]?.model).toBe("unknown");
    expect(a.messages[0]?.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
    expect(a.startTime?.toISOString()).toBe("2026-06-12T05:00:00.000Z");
    expect(a.endTime?.toISOString()).toBe("2026-06-12T06:00:00.000Z");
  });

  it("rootDir: <rootDir>/state.vscdb 발견", async () => {
    const dir = await makeTmpDir();
    writeVscdb(join(dir, "state.vscdb"), [bubble("c", "m", "2026-06-12T05:00:00.000Z")]);
    const r = await cursorAdapter.collect({ rootDir: dir });
    expect(r.sessions).toHaveLength(1);
  });

  it("부재 파일 → 빈 결과, 경고 0(Cursor 미설치 정상)", async () => {
    const dir = await makeTmpDir();
    const r = await cursorAdapter.collect({ rootDir: join(dir, "does-not-exist") });
    expect(r).toEqual({ sessions: [], warnings: [] });
  });

  it("cursorDiskKV 테이블 부재 → warning 1, throw 없음", async () => {
    const dir = await makeTmpDir();
    writeVscdb(join(dir, "state.vscdb"), [], { withTable: false });
    const r = await cursorAdapter.collect({ rootDir: dir });
    expect(r.sessions).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("BLOB(Buffer) 값도 디코드", async () => {
    const dir = await makeTmpDir();
    const v = Buffer.from(JSON.stringify({ createdAt: "2026-06-12T05:00:00.000Z" }), "utf-8");
    writeVscdb(join(dir, "state.vscdb"), [["bubbleId:cb:m1", v]]);
    const r = await cursorAdapter.collect({ rootDir: dir });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]?.messages).toHaveLength(1);
  });

  it("손상 키/JSON → skip+warning, 정상은 유지", async () => {
    const dir = await makeTmpDir();
    writeVscdb(join(dir, "state.vscdb"), [
      ["bubbleId:onlyone", JSON.stringify({ createdAt: "2026-06-12T05:00:00.000Z" })], // 키 세그먼트 부족
      ["bubbleId:cc:m1", "{not json"], // 손상 JSON
      bubble("cc", "m2", "2026-06-12T05:00:00.000Z"), // 정상
    ]);
    const r = await cursorAdapter.collect({ rootDir: dir });
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]?.sessionId).toBe("cc");
    expect(r.sessions[0]?.messages).toHaveLength(1);
  });
});
