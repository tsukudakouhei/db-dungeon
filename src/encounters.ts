// B1 パーサー階の敵（お題）とレベル構成
import {
  fromTable, isSelect, literalText, selectsAllColumns, selectsColumns, whereHint, whereIs,
  type Condition, type Part, type Target,
} from "./battle";
import { BAT, GOBLIN, GOLEM, MIMIC, SLIME, type Sprite } from "./sprites";

export interface TableDef {
  name: string;
  columns: string[];
}

/** このダンジョンにある表（1 面はパーサー階なので、表の実在はまだ確かめない） */
export const TABLES: TableDef[] = [
  { name: "users", columns: ["id", "name", "age"] },
  { name: "items", columns: ["id", "name", "price"] },
  { name: "guilds", columns: ["id", "name", "leader_id"] },
];

/**
 * お題の出し方（プレイヤーのやること）
 * - write: 文章のお題を読んで SQL を書く
 * - tree:  構文木を見せられて、その木になる SQL を書く（逆向き）
 * - fix:   1 か所壊れた呪文を書き直す
 */
export type PhaseKind = "write" | "tree" | "fix";

/** 敵の 1 段階＝お題 1 つ。敵の HP はこの段階の数 */
export interface Phase extends Target {
  kind: PhaseKind;
  /** write のときに見せる文章 */
  demand: string;
  /** 模範解答。tree はこの構文木を見せ、fix はこれを壊して見せる。敵の攻撃にも使う */
  answer: string;
}

export interface Foe {
  id: string;
  name: string;
  sprite: Sprite;
  /** 倒しきれなかったときの敵の台詞 */
  taunt: string;
  phases: Phase[];
}

export interface Level {
  level: number;
  /** このレベルで覚える呪文（レベルアップ時に見せる） */
  spell: string;
  /** 入力補完に出す語彙 */
  vocabulary: string[];
  foes: Foe[];
}

const LABEL: Record<string, string> = { users: "冒険者の名簿", items: "道具の在庫", guilds: "ギルドの一覧" };

/** 条件を、答えの形（どちらが左か）を明かさない日本語にする */
function describe(cond: Condition): string {
  const v = typeof cond.value === "number" ? String(cond.value) : `「${cond.value}」`;
  const how: Record<Condition["op"], string> = {
    "=": `が ${v}`, "<>": `が ${v} でない（<> を使う）`, "<": `が ${v} より小さい`,
    "<=": `が ${v} 以下`, ">": `が ${v} より大きい`, ">=": `が ${v} 以上`,
  };
  return `${cond.column} ${how[cond.op]}`;
}

function parts(table: string, columns: string[] | "*", where?: Condition): Part[] {
  const list: Part[] = [
    { id: "type", label: "文の種類が SELECT（取り出す）", check: isSelect },
    columns === "*"
      ? { id: "columns", label: "列が *（全部の列）", check: selectsAllColumns }
      : { id: "columns", label: `列が ${columns.join(", ")}（この順）`, check: (ast) => selectsColumns(ast, columns) },
    { id: "from", label: `取り出し元が ${table}`, check: (ast) => fromTable(ast, table) },
  ];
  if (where) {
    list.push({
      id: "where",
      label: `条件が「${describe(where)}」（列 演算子 値 の形）`,
      check: (ast) => whereIs(ast, where),
      hint: (ast) => whereHint(ast, where),
    });
  }
  return list;
}

function phase(kind: PhaseKind, table: string, columns: string[] | "*", where?: Condition): Phase {
  const what = columns === "*" ? "全部の列まるごと" : `${columns.join(" と ")} の列だけ（この順で）`;
  const rows = where ? `${describe(where)} の行の、` : "";
  const select = `SELECT ${columns === "*" ? "*" : columns.join(", ")} FROM ${table}`;
  return {
    kind,
    demand: `${table} 表から、${rows}${what}見せろ（${LABEL[table]}）`,
    answer: where ? `${select} WHERE ${where.column} ${where.op} ${literalText(where.value)}` : select,
    parts: parts(table, columns, where),
  };
}

const TABLE_NAMES = TABLES.map((t) => t.name);
const COLUMN_NAMES = [...new Set(TABLES.flatMap((t) => t.columns))];

export const LEVELS: Level[] = [
  {
    level: 1,
    spell: "SELECT * FROM 表（全部の列を取り出す）",
    vocabulary: ["SELECT", "FROM", ...TABLE_NAMES],
    foes: [
      {
        id: "slime", name: "名簿スライム", sprite: SLIME, taunt: "ぷるぷる…そんな呪文じゃ見せないよ",
        phases: [phase("write", "users", "*")],
      },
      {
        id: "golem", name: "石像ゴーレム", sprite: GOLEM, taunt: "……カタチ ガ チガウ",
        phases: [phase("tree", "items", "*"), phase("tree", "guilds", "*")],
      },
    ],
  },
  {
    level: 2,
    spell: "列を指定する（SELECT name, age FROM …）",
    vocabulary: ["SELECT", "FROM", ...TABLE_NAMES, ...COLUMN_NAMES],
    foes: [
      {
        id: "goblin", name: "倉庫ゴブリン", sprite: GOBLIN, taunt: "ケケッ、渡さねえ！",
        phases: [phase("write", "items", ["name"]), phase("write", "items", ["name", "price"])],
      },
      {
        id: "mimic", name: "ミミック", sprite: MIMIC, taunt: "ガチガチ…まだ呪いが残ってるぜ",
        phases: [phase("fix", "users", ["name", "age"]), phase("fix", "guilds", ["name", "leader_id"])],
      },
      {
        // 書く・読む・直すを混ぜ、Lv1 の文法も復習で出す
        id: "bat", name: "ギルドコウモリ", sprite: BAT, taunt: "キキッ、秘密だ",
        phases: [phase("tree", "guilds", ["id", "name"]), phase("write", "users", "*"), phase("fix", "items", ["price"])],
      },
    ],
  },
  {
    level: 3,
    spell: "条件で絞る（WHERE 列 演算子 値 ── 例: WHERE age >= 20）",
    vocabulary: ["SELECT", "FROM", "WHERE", ...TABLE_NAMES, ...COLUMN_NAMES],
    foes: [
      {
        id: "slime-gate", name: "門番スライム", sprite: SLIME, taunt: "ぷるぷる…その条件じゃ通さないよ",
        phases: [
          phase("write", "users", "*", { column: "age", op: ">=", value: 20 }),
          phase("write", "items", ["name", "price"], { column: "price", op: "<", value: 100 }),
        ],
      },
      {
        // 文字列の値は構文木で別の種類になる。木を読んで ' で囲むことに気づく
        id: "golem-gate", name: "門番ゴーレム", sprite: GOLEM, taunt: "……ジョウケン ノ キ ガ チガウ",
        phases: [
          phase("tree", "users", ["id", "age"], { column: "name", op: "=", value: "alice" }),
          phase("tree", "items", "*", { column: "price", op: "<=", value: 50 }),
        ],
      },
      {
        id: "mimic-gate", name: "鍵ミミック", sprite: MIMIC, taunt: "ガチガチ…条件の呪いが解けてないぜ",
        phases: [
          phase("fix", "guilds", ["name"], { column: "leader_id", op: "=", value: 1 }),
          phase("fix", "users", ["name", "age"], { column: "age", op: ">", value: 30 }),
        ],
      },
      {
        // 新しい文法を混ぜつつ、条件なしの呪文も復習で出す
        id: "bat-gate", name: "見張りコウモリ", sprite: BAT, taunt: "キキッ、そいつは通せない",
        phases: [
          phase("write", "users", ["name"], { column: "name", op: "<>", value: "bob" }),
          phase("fix", "items", ["name", "price"]),
          phase("tree", "guilds", "*", { column: "id", op: ">", value: 2 }),
        ],
      },
    ],
  },
];

export const NEXT_SPELL = "条件を組み合わせる（AND / OR）";
