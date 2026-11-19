// B1 パーサー階の敵（お題）とレベル構成
import { fromTable, isSelect, selectsAllColumns, selectsColumns, type Part, type Target } from "./battle";
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

function parts(table: string, columns: string[] | "*"): Part[] {
  return [
    { id: "type", label: "文の種類が SELECT（取り出す）", check: isSelect },
    columns === "*"
      ? { id: "columns", label: "列が *（全部の列）", check: selectsAllColumns }
      : { id: "columns", label: `列が ${columns.join(", ")}（この順）`, check: (ast) => selectsColumns(ast, columns) },
    { id: "from", label: `取り出し元が ${table}`, check: (ast) => fromTable(ast, table) },
  ];
}

function phase(kind: PhaseKind, table: string, columns: string[] | "*"): Phase {
  const what = columns === "*" ? "全部の列まるごと" : `${columns.join(" と ")} の列だけ（この順で）`;
  return {
    kind,
    demand: `${table} 表から、${what}見せろ（${LABEL[table]}）`,
    answer: `SELECT ${columns === "*" ? "*" : columns.join(", ")} FROM ${table}`,
    parts: parts(table, columns),
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
];

export const NEXT_SPELL = "条件で絞る（WHERE age >= 20）";
