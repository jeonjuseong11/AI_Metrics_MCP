/**
 * 세션 내용 분류·롤업 — 결정적, 닫힌 어휘.
 *
 * 파서가 추출한 닫힌-어휘 카운트(도구명·알려진 확장자·허용목록 동사∪기타)를
 * 활동/영역/명령 카테고리로 합산한다. 순수·결정적(정렬 동률은 코드유닛).
 * *서술*이지 *평가*가 아니다 — tool_use 빈도는 양이지 실력이 아니다.
 */

import type { SessionContentDigest } from "../types.js";

export const OTHER = "기타";

const TOOL_ACTIVITY: Record<string, string> = {
  Edit: "구현", Write: "구현", MultiEdit: "구현", NotebookEdit: "구현",
  Read: "탐색", Grep: "탐색", Glob: "탐색", LS: "탐색", NotebookRead: "탐색", ToolSearch: "탐색",
  Bash: "실행·검증", PowerShell: "실행·검증", BashOutput: "실행·검증", KillShell: "실행·검증",
  TodoWrite: "계획·조율", TaskCreate: "계획·조율", TaskUpdate: "계획·조율", TaskList: "계획·조율",
  TaskGet: "계획·조율", AskUserQuestion: "계획·조율", Skill: "계획·조율", Agent: "계획·조율",
  Workflow: "계획·조율", ExitPlanMode: "계획·조율", EnterPlanMode: "계획·조율",
  WebFetch: "웹", WebSearch: "웹",
};

const EXT_AREA: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".java": "Java", ".py": "Python", ".go": "Go", ".rs": "Rust",
  ".md": "문서", ".mdx": "문서", ".txt": "문서", ".rst": "문서",
  ".json": "설정", ".yml": "설정", ".yaml": "설정", ".toml": "설정", ".properties": "설정", ".xml": "설정", ".ini": "설정",
  ".css": "스타일", ".scss": "스타일", ".sass": "스타일", ".less": "스타일",
  ".sh": "셸", ".bash": "셸", ".ps1": "셸",
  ".html": "HTML", ".sql": "SQL",
};

const VERB_CATEGORY: Record<string, string> = {
  git: "버전관리", gh: "버전관리",
  npm: "패키지", pnpm: "패키지", yarn: "패키지", npx: "패키지", bun: "패키지",
  pip: "패키지", poetry: "패키지", cargo: "패키지", mvn: "패키지", gradle: "패키지",
  node: "실행·테스트", tsx: "실행·테스트", "ts-node": "실행·테스트", vitest: "실행·테스트",
  jest: "실행·테스트", pytest: "실행·테스트", deno: "실행·테스트", python: "실행·테스트", java: "실행·테스트",
  ls: "파일", cat: "파일", find: "파일", rm: "파일", mkdir: "파일", cp: "파일", mv: "파일",
  touch: "파일", echo: "파일", pwd: "파일", head: "파일", tail: "파일", grep: "파일", sed: "파일", awk: "파일",
  curl: "네트워크", wget: "네트워크",
};

export function isKnownExt(ext: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXT_AREA, ext);
}
export function isKnownVerb(verb: string): boolean {
  return Object.prototype.hasOwnProperty.call(VERB_CATEGORY, verb);
}

export interface ContentSummary {
  sessionsWithContent: number;
  userPrompts: number;
  totalToolUses: number;
  activity: Array<{ category: string; count: number; share: number }>;
  areas: Array<{ area: string; count: number }>;
  commands: Array<{ category: string; count: number; exampleVerbs: string[] }>;
}

/** count 내림차순, 동률은 라벨 코드유닛(결정적). */
function cmpCount(a: { count: number; key: string }, b: { count: number; key: string }): number {
  return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export function summarizeContent(digests: SessionContentDigest[]): ContentSummary {
  let userPrompts = 0;
  let totalToolUses = 0;
  const activity = new Map<string, number>();
  const area = new Map<string, number>();
  const command = new Map<string, number>();
  const verbsByCat = new Map<string, Map<string, number>>();

  for (const d of digests) {
    userPrompts += d.userPrompts;
    for (const [tool, n] of Object.entries(d.toolUses)) {
      totalToolUses += n;
      const cat = TOOL_ACTIVITY[tool] ?? OTHER;
      activity.set(cat, (activity.get(cat) ?? 0) + n);
    }
    for (const [ext, n] of Object.entries(d.fileExts)) {
      const a = EXT_AREA[ext] ?? OTHER;
      area.set(a, (area.get(a) ?? 0) + n);
    }
    for (const [verb, n] of Object.entries(d.commandVerbs)) {
      const cat = VERB_CATEGORY[verb] ?? OTHER;
      command.set(cat, (command.get(cat) ?? 0) + n);
      if (cat !== OTHER) {
        const m = verbsByCat.get(cat) ?? new Map<string, number>();
        m.set(verb, (m.get(verb) ?? 0) + n);
        verbsByCat.set(cat, m);
      }
    }
  }

  const activityArr = [...activity.entries()]
    .map(([category, count]) => ({ category, count, key: category }))
    .sort(cmpCount)
    .map(({ category, count }) => ({ category, count, share: totalToolUses > 0 ? count / totalToolUses : 0 }));

  const areasArr = [...area.entries()]
    .map(([a, count]) => ({ area: a, count, key: a }))
    .sort(cmpCount)
    .map(({ area: a, count }) => ({ area: a, count }));

  const commandsArr = [...command.entries()]
    .map(([category, count]) => ({ category, count, key: category }))
    .sort(cmpCount)
    .map(({ category, count }) => {
      const exampleVerbs = [...(verbsByCat.get(category) ?? new Map<string, number>()).entries()]
        .map(([verb, c]) => ({ verb, count: c, key: verb }))
        .sort(cmpCount)
        .slice(0, 3)
        .map((x) => x.verb);
      return { category, count, exampleVerbs };
    });

  return {
    sessionsWithContent: digests.length,
    userPrompts,
    totalToolUses,
    activity: activityArr,
    areas: areasArr,
    commands: commandsArr,
  };
}
