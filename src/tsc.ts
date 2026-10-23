export interface TsError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** Parses `tsc --pretty false` output. Continuation lines of multi-line messages are appended. */
export function parseTscOutput(output: string): TsError[] {
  const errors: TsError[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const m = LINE.exec(raw.trim());
    if (m) {
      errors.push({ file: m[1].replace(/\\/g, "/"), line: +m[2], col: +m[3], code: m[4], message: m[5] });
    } else if (errors.length && /^\s+\S/.test(raw)) {
      errors[errors.length - 1].message += " " + raw.trim();
    }
  }
  return errors;
}

/** Line/column are excluded on purpose: edits above a pre-existing error shift its position. */
export function errorKey(e: TsError): string {
  return `${e.file}|${e.code}|${e.message}`;
}

/** Errors in `current` not present in `baseline`, treating both as multisets. */
export function newErrors(baseline: TsError[], current: TsError[]): TsError[] {
  const counts = new Map<string, number>();
  for (const e of baseline) counts.set(errorKey(e), (counts.get(errorKey(e)) ?? 0) + 1);
  const out: TsError[] = [];
  for (const e of current) {
    const k = errorKey(e);
    const n = counts.get(k) ?? 0;
    if (n > 0) counts.set(k, n - 1);
    else out.push(e);
  }
  return out;
}
