/**
 * Git 커밋 파서 — 순수 함수.
 *
 * 수집(child_process)은 fs/git.ts가 담당하고, 여기선 git 출력 파싱만 한다.
 * 견고성: 형식이 안 맞는 레코드는 skip(중단 없음).
 *
 * 기대 포맷(레코드 구분 0x1e, 필드 구분 0x1f):
 *   %H 0x1f %h 0x1f %an 0x1f %aI 0x1f %s 0x1e
 */

export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  /** author date(ISO 8601). */
  timestamp: Date;
  subject: string;
}

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

/** git log 출력(위 포맷)을 Commit[]로. 비정상 레코드는 무시. */
export function parseGitLog(stdout: string): Commit[] {
  const commits: Commit[] = [];
  for (const rawRecord of stdout.split(RECORD_SEP)) {
    const record = rawRecord.trim();
    if (record === "") continue;
    const fields = record.split(FIELD_SEP);
    if (fields.length < 5) continue;
    const [hash, shortHash, author, iso, ...subjectParts] = fields;
    if (!hash || !iso) continue;
    const ts = new Date(iso);
    if (Number.isNaN(ts.getTime())) continue;
    commits.push({
      hash,
      shortHash: shortHash ?? hash.slice(0, 7),
      author: author ?? "unknown",
      timestamp: ts,
      subject: subjectParts.join(FIELD_SEP),
    });
  }
  return commits;
}

/** fs/git.ts가 쓰는 표준 포맷 문자열. */
export const GIT_LOG_FORMAT = `%H${FIELD_SEP}%h${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${RECORD_SEP}`;
