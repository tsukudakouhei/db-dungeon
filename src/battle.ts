// 戦闘のロジック（画面に依存しない純粋な関数だけを置く）
import pkg from "node-sql-parser/build/sqlite";

const { Parser } = pkg;
const parser = new Parser();
const DIALECT = "SQLite";

// ---- 字句解析（単語に分ける）---------------------------------------------
// 画面で「パーサーはまず単語に分ける」を見せるための簡易版。
// 構文木そのものは node-sql-parser（本物）が作る。

export type TokenKind = "keyword" | "identifier" | "number" | "string" | "symbol" | "unknown";
export interface Token {
  text: string;
  kind: TokenKind;
  start: number;
}

export const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "ORDER", "BY", "ASC", "DESC",
  "LIMIT", "JOIN", "INNER", "LEFT", "ON", "AS", "FOR", "UPDATE", "INSERT", "INTO",
  "VALUES", "DELETE", "SET", "NULL", "IS", "IN", "LIKE", "GROUP", "HAVING",
];
const KEYWORD_SET = new Set(KEYWORDS);

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s+|([A-Za-z_][A-Za-z0-9_]*)|(\d+(?:\.\d+)?)|('(?:[^']|'')*'?)|(<=|>=|<>|!=|[*,;().=<>+\-/])|(.)/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const start = m.index;
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], kind: KEYWORD_SET.has(m[1].toUpperCase()) ? "keyword" : "identifier", start });
    } else if (m[2] !== undefined) tokens.push({ text: m[2], kind: "number", start });
    else if (m[3] !== undefined) tokens.push({ text: m[3], kind: "string", start });
    else if (m[4] !== undefined) tokens.push({ text: m[4], kind: "symbol", start });
    else if (m[5] !== undefined) tokens.push({ text: m[5], kind: "unknown", start });
    if (re.lastIndex === start) re.lastIndex++; // 念のための無限ループ防止
  }
  return tokens;
}

// ---- 構文解析（本物のパーサーに渡す）---------------------------------------

export interface SpellError {
  /** パーサーが止まった位置（0 始まりの文字位置） */
  offset: number;
  /** 止まった位置にあった文字。入力の終わりなら null */
  found: string | null;
  /** パーサーが「ここには本来これが来るはず」と期待したもののうち、意味のあるもの */
  expected: string[];
  message: string;
}

export type CastResult =
  | { ok: true; ast: SelectLike }
  | { ok: false; error: SpellError };

/** node-sql-parser の AST のうち、照合で使う範囲の型 */
export interface SelectLike {
  type: string;
  columns?: { expr?: { type?: string; column?: string | { expr?: { value?: string } } } }[] | "*" | null;
  from?: { table?: string | null }[] | null;
  [key: string]: unknown;
}

// 期待候補のうち、コメント・空白などの雑音は出さない
const NOISE = new Set(['"#"', '"--"', '"/*"', "[ \\t\\n\\r]"]);

function pickExpected(message: string): string[] {
  const m = /Expected (.*) but /.exec(message);
  if (!m) return [];
  return m[1]
    .split(/, (?:or )?| or /)
    .map((s) => s.trim())
    .filter((s) => s && !NOISE.has(s));
}

export function castSpell(sql: string): CastResult {
  const trimmed = sql.trim();
  if (trimmed === "") {
    return { ok: false, error: { offset: 0, found: null, expected: [], message: "呪文が空っぽです" } };
  }
  try {
    const ast = parser.astify(sql, { database: DIALECT });
    if (Array.isArray(ast)) {
      if (ast.length !== 1) {
        return {
          ok: false,
          error: { offset: 0, found: null, expected: [], message: "呪文は 1 回に 1 つだけ唱えられます" },
        };
      }
      return { ok: true, ast: ast[0] as unknown as SelectLike };
    }
    return { ok: true, ast: ast as unknown as SelectLike };
  } catch (e) {
    const err = e as { location?: { start?: { offset?: number } }; message?: string };
    const offset = err.location?.start?.offset ?? 0;
    const message = err.message ?? String(e);
    return {
      ok: false,
      error: {
        offset,
        found: offset < sql.length ? sql[offset] : null,
        expected: pickExpected(message),
        message,
      },
    };
  }
}

// ---- お題（敵）と照合 -------------------------------------------------------

export interface Part {
  id: string;
  /** 画面に出す部品名（例: 文の種類が SELECT） */
  label: string;
  check: (ast: SelectLike) => boolean;
}

/** 照合の相手（お題）。部品がすべて合えば倒せる */
export interface Target {
  parts: Part[];
}

export interface Judgement {
  parts: { part: Part; ok: boolean }[];
  /** 合った部品の数 */
  damage: number;
  defeated: boolean;
}

export function judge(target: Target, ast: SelectLike): Judgement {
  const parts = target.parts.map((part) => {
    let ok = false;
    try {
      ok = part.check(ast);
    } catch {
      ok = false;
    }
    return { part, ok };
  });
  const damage = parts.filter((p) => p.ok).length;
  return { parts, damage, defeated: damage === target.parts.length };
}

// ---- 部品の判定ヘルパー -----------------------------------------------------

export function isSelect(ast: SelectLike): boolean {
  return ast.type === "select";
}

/** 列が * ただ 1 つか */
export function selectsAllColumns(ast: SelectLike): boolean {
  const cols = ast.columns;
  if (cols === "*") return true;
  if (!Array.isArray(cols) || cols.length !== 1) return false;
  return cols[0].expr?.type === "column_ref" && cols[0].expr.column === "*";
}

/** 列がちょうどこの並びか（大文字小文字は区別しない。構文木の列の並びは結果の列の並びになるので順番も見る） */
export function selectsColumns(ast: SelectLike, columns: string[]): boolean {
  const cols = ast.columns;
  if (!Array.isArray(cols) || cols.length !== columns.length) return false;
  return cols.every((c, i) => {
    if (c.expr?.type !== "column_ref") return false;
    const raw = c.expr.column;
    const name = typeof raw === "string" ? raw : raw?.expr?.value;
    return (name ?? "").toLowerCase() === columns[i].toLowerCase();
  });
}

/** FROM がちょうどこのテーブル 1 つか（大文字小文字は区別しない） */
export function fromTable(ast: SelectLike, table: string): boolean {
  const from = ast.from;
  if (!Array.isArray(from) || from.length !== 1) return false;
  return (from[0].table ?? "").toLowerCase() === table.toLowerCase();
}

// ---- 入力補完 ---------------------------------------------------------------

/** カーソル直前の単語に対する補完候補（先頭一致、大文字小文字は区別しない） */
export function completions(textBeforeCursor: string, vocabulary: string[]): { prefix: string; candidates: string[] } {
  const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(textBeforeCursor);
  const prefix = m ? m[0] : "";
  if (prefix === "") return { prefix, candidates: [] };
  const lower = prefix.toLowerCase();
  const candidates = vocabulary.filter((w) => w.toLowerCase().startsWith(lower) && w.toLowerCase() !== lower);
  return { prefix, candidates };
}

// ---- 構文木の表示用整形 -----------------------------------------------------

/** null・空配列・空オブジェクトを取り除いた「中身のある部分」だけの木にする */
export function pruneAst(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arr = value.map(pruneAst).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const p = pruneAst(v);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null ? undefined : value;
}
