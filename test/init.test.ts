import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAimmHook, mergeSessionEndHook, mergeMcpJson, runInit, type InitIo } from "../src/core/init.js";

// 플랫폼 비의존: 유효한 file URL(win32는 드라이브 문자 필요) + 구현과 동일한 path.join.
const DIST_CORE = join(process.platform === "win32" ? "C:\\repo" : "/repo", "dist", "core");
const MODULE_URL = pathToFileURL(join(DIST_CORE, "init.js")).href; // → cli.js = <repo>/dist/cli.js
const CLI_JS = join(dirname(fileURLToPath(MODULE_URL)), "..", "cli.js");
const SETTINGS = join("/home/u", ".claude", "settings.json");
const MCP_JSON = join("/work", ".mcp.json");

function fakeIo(files: Record<string, string>, claudeOk = false): InitIo & { files: Record<string, string> } {
  const f = { ...files };
  return {
    files: f,
    homedir: () => "/home/u",
    cwd: () => "/work",
    now: () => "20260622",
    readFile: (p) => (p in f ? f[p]! : null),
    writeFile: (p, c) => {
      f[p] = c;
    },
    backup: (p) => {
      const b = `${p}.aimm-bak-20260622`;
      f[b] = f[p]!;
      return b;
    },
    registerMcp: () => claudeOk,
  };
}

describe("isAimmHook", () => {
  it("cli.js ... hook 패턴을 인식(경로 무관)", () => {
    expect(isAimmHook('node "/a/b/dist/cli.js" hook')).toBe(true);
    expect(isAimmHook("node /x/cli.js hook")).toBe(true);
    expect(isAimmHook("node /x/cli.js mcp")).toBe(false);
    expect(isAimmHook("some-other-tool run")).toBe(false);
  });
});

describe("mergeSessionEndHook", () => {
  it("없으면 add", () => {
    const r = mergeSessionEndHook({}, 'node "/r/dist/cli.js" hook');
    expect(r.action).toBe("add");
    expect((r.settings.hooks as any).SessionEnd[0].hooks[0].command).toContain("hook");
  });
  it("같은 명령이면 noop", () => {
    const cmd = 'node "/r/dist/cli.js" hook';
    const base = mergeSessionEndHook({}, cmd).settings;
    expect(mergeSessionEndHook(base, cmd).action).toBe("noop");
  });
  it("경로만 바뀌면 replace(중복 append 안 함)", () => {
    const base = mergeSessionEndHook({}, 'node "/old/dist/cli.js" hook').settings;
    const r = mergeSessionEndHook(base, 'node "/new/dist/cli.js" hook');
    expect(r.action).toBe("replace");
    expect((r.settings.hooks as any).SessionEnd).toHaveLength(1);
    expect((r.settings.hooks as any).SessionEnd[0].hooks[0].command).toContain("/new/");
  });
  it("기존 비-aimm hook을 보존한다", () => {
    const base = { hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "other thing" }] }] } };
    const r = mergeSessionEndHook(base, 'node "/r/dist/cli.js" hook');
    expect((r.settings.hooks as any).SessionEnd).toHaveLength(2);
  });
});

describe("mergeMcpJson", () => {
  it("aimm 서버를 병합한다", () => {
    const j = mergeMcpJson({ mcpServers: { other: {} } }, "/r/dist/cli.js");
    expect((j.mcpServers as any).aimm.args).toEqual(["/r/dist/cli.js", "mcp"]);
    expect((j.mcpServers as any).other).toBeDefined();
  });
  it("기존 aimm 항목의 사용자 키(env 등)를 보존한다(우리 키만 딥머지)", () => {
    const j = mergeMcpJson({ mcpServers: { aimm: { env: { FOO: "1" }, command: "old" } } }, "/r/dist/cli.js");
    expect((j.mcpServers as any).aimm.env).toEqual({ FOO: "1" }); // 사용자 키 보존
    expect((j.mcpServers as any).aimm.command).toBe("node"); // 우리 키 갱신
    expect((j.mcpServers as any).aimm.args).toEqual(["/r/dist/cli.js", "mcp"]);
  });
});

describe("runInit", () => {
  it("새 settings 생성 + claude 성공 시 .mcp.json 미생성", () => {
    const io = fakeIo({}, true);
    const r = runInit(io, MODULE_URL, {});
    expect(r.cliJs).toBe(CLI_JS);
    expect(r.hookAction).toBe("add");
    expect(r.mcpVia).toBe("claude");
    expect(SETTINGS in io.files).toBe(true);
    expect(MCP_JSON in io.files).toBe(false);
  });

  it("claude 실패 시 .mcp.json 폴백", () => {
    const io = fakeIo({}, false);
    const r = runInit(io, MODULE_URL, {});
    expect(r.mcpVia).toBe("mcp.json");
    expect(JSON.parse(io.files[MCP_JSON]!).mcpServers.aimm.args).toEqual([CLI_JS, "mcp"]);
  });

  it("dry-run은 아무것도 쓰지 않는다", () => {
    const io = fakeIo({}, true);
    const before = Object.keys(io.files).length;
    runInit(io, MODULE_URL, { dryRun: true });
    expect(Object.keys(io.files).length).toBe(before);
  });

  it("기존 settings 수정 시 백업을 만든다", () => {
    const io = fakeIo({ [SETTINGS]: "{}" }, true);
    const r = runInit(io, MODULE_URL, {});
    expect(r.backups.length).toBeGreaterThan(0);
    expect(`${SETTINGS}.aimm-bak-20260622` in io.files).toBe(true);
  });

  it("재실행은 멱등(중복 hook 없음)", () => {
    const io = fakeIo({}, true);
    runInit(io, MODULE_URL, {});
    runInit(io, MODULE_URL, {});
    const s = JSON.parse(io.files[SETTINGS]!);
    expect(s.hooks.SessionEnd).toHaveLength(1);
  });
});
