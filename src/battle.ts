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
  /** 合わなかったときに、どこが惜しいかを説明する（説明できないときは null） */
  hint?: (ast: SelectLike) => string | null;
}

/** 照合の相手（お題）。部品がすべて合えば倒せる */
export interface Target {
  parts: Part[];
}

export interface Judgement {
  /** hint は合わなかった部品にだけ付く */
  parts: { part: Part; ok: boolean; hint?: string }[];
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
    if (ok || !part.hint) return { part, ok };
    let hint: string | null = null;
    try {
      hint = part.hint(ast);
    } catch {
      hint = null;
    }
    return hint ? { part, ok, hint } : { part, ok };
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

// ---- WHERE（条件）の判定 ----------------------------------------------------

/** 比較の条件 1 つ（列 演算子 値）。構文木では左辺・演算子・右辺の二分木になる */
export interface Condition {
  column: string;
  op: "=" | "<>" | "<" | "<=" | ">" | ">=";
  /** 数なら number、文字列なら string（構文木では別の種類になる） */
  value: number | string;
}

interface ExprNode {
  type?: string;
  operator?: string;
  left?: ExprNode;
  right?: ExprNode;
  column?: string | { expr?: { value?: string } };
  value?: unknown;
}

/** 左右を入れ替えたときに、意味が同じになる演算子 */
const MIRROR: Record<string, string> = { "=": "=", "<>": "<>", "<": ">", "<=": ">=", ">": "<", ">=": "<=" };

/** 意味は同じだが綴りの違う演算子（構文木では別の operator になる） */
const SYNONYM: Record<string, string> = { "!=": "<>", "==": "=" };

/** 綴りの違いをならした演算子（説明を出すときだけ使う。照合はならさない） */
function normalOp(op: string | undefined): string | undefined {
  return op === undefined ? undefined : (SYNONYM[op] ?? op);
}

function columnName(node: ExprNode | undefined): string | null {
  if (node?.type !== "column_ref") return null;
  const raw = node.column;
  const name = typeof raw === "string" ? raw : raw?.expr?.value;
  return name ? name.toLowerCase() : null;
}

/**
 * 値の部品が、お題の値と同じ種類・同じ値か（文字列は '...' で書いたものだけ）。
 * 20.0 は構文木では "20.0" のまま残り、20 とは別の木なので一致させない
 */
function sameValue(node: ExprNode | undefined, value: number | string): boolean {
  if (typeof value === "number") return node?.type === "number" && node.value === value;
  return node?.type === "single_quote_string" && node.value === value;
}

/** 値を SQL の書き方にする（文字列は ' で囲む） */
export function literalText(value: number | string): string {
  return typeof value === "number" ? String(value) : `'${value}'`;
}

/** 条件の木が「左辺＝列、演算子、右辺＝値」の形でお題とちょうど一致するか */
export function whereIs(ast: SelectLike, cond: Condition): boolean {
  const w = ast.where as ExprNode | null | undefined;
  return (
    w?.type === "binary_expr" &&
    w.operator === cond.op &&
    columnName(w.left) === cond.column.toLowerCase() &&
    sameValue(w.right, cond.value)
  );
}

/**
 * 条件が合わなかったとき、どこが惜しいかを説明する。
 * パーサーは意味を知らないので、意味が同じでも木の形が違えば別物として扱う。
 */
export function whereHint(ast: SelectLike, cond: Condition): string | null {
  const w = ast.where as ExprNode | null | undefined;
  if (!w) return "WHERE がない。条件で絞らないと、構文木に where の枝ができない";
  if (w.type !== "binary_expr") return null;
  if (w.operator === "AND" || w.operator === "OR") return "条件は 1 つだけ。AND / OR で組み合わせるのは次のレベル";
  const want = `${cond.column} ${cond.op} ${literalText(cond.value)}`;

  // 左右が入れ替わっている（20 <= age）
  if (columnName(w.right) === cond.column.toLowerCase() && sameValue(w.left, cond.value) && normalOp(w.operator) === MIRROR[cond.op]) {
    return `意味は「${want}」と同じ。でも構文木では左右が入れ替わった別の木になる。パーサーは意味を知らず、形だけを見る（意味が同じかを考えるのは、もっと下の階の仕事）`;
  }
  if (columnName(w.left) !== cond.column.toLowerCase()) return null;

  const right = w.right;
  if (right?.type === "double_quote_string" && right.value === String(cond.value)) {
    const want = typeof cond.value === "number" ? String(cond.value) : `'${cond.value}'`;
    return `"${right.value}" のように " で囲むのは、SQL の決まりでは名前（列名など）の書き方。ここは ${want} と書く`;
  }
  if (typeof cond.value === "number" && right?.type === "single_quote_string" && Number(right.value) === cond.value) {
    return `数の ${cond.value} と 文字列の '${cond.value}' は、構文木では別の種類（number と string）になる`;
  }
  if (typeof cond.value === "number" && right?.type === "number" && right.value !== cond.value && Number(right.value) === cond.value) {
    return `${String(right.value)} と ${cond.value} は、数としては同じでも構文木には書いたとおりの "${String(right.value)}" が残る。パーサーは形だけを見る`;
  }
  if (sameValue(right, cond.value) && normalOp(w.operator) === cond.op) {
    return `${w.operator} と ${cond.op} は意味は同じ。でも構文木では operator の中身が違う別の木になる。このお題は ${cond.op} で書く`;
  }
  if (sameValue(right, cond.value) && w.operator !== cond.op) {
    return `演算子が違う。${w.operator} と ${cond.op} は、構文木では別の木になる`;
  }
  return null;
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
