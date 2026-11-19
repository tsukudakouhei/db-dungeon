// B1 パーサー階の Lv1 の敵（お題）
import { fromTable, isSelect, selectsAllColumns, type Target } from "./battle";
import { BAT, GOBLIN, SLIME, type Sprite } from "./sprites";

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

/** 敵の 1 段階＝お題 1 つ。敵の HP はこの段階の数 */
export interface Phase extends Target {
  demand: string;
  /** お題の模範解答。敵はこれを壊して「呪われた呪文」として撃ってくる */
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

const LABEL: Record<string, string> = { users: "冒険者の名簿", items: "道具の在庫", guilds: "ギルドの一覧" };

function selectAll(table: string): Phase {
  return {
    demand: `${table} 表の中身を、全部の列まるごと見せろ（${LABEL[table]}）`,
    answer: `SELECT * FROM ${table}`,
    parts: [
      { id: "type", label: "文の種類が SELECT（取り出す）", check: isSelect },
      { id: "columns", label: "列が *（全部の列）", check: selectsAllColumns },
      { id: "from", label: `取り出し元が ${table}`, check: (ast) => fromTable(ast, table) },
    ],
  };
}

/** Lv1 で使える呪文の語彙（入力補完に使う） */
export const LV1_VOCABULARY = ["SELECT", "FROM", ...TABLES.map((t) => t.name)];

/**
 * Lv1 の敵。3 体倒すと次の呪文が使えるようになる。
 * Lv1 は SELECT * FROM しか使えないので、段階ごとに変わるのは表だけ（Lv2 以降で形も変わる）。
 */
export const LV1_ENCOUNTERS: Foe[] = [
  {
    id: "slime", name: "名簿スライム", sprite: SLIME, taunt: "ぷるぷる…そんな呪文じゃ見せないよ",
    phases: [selectAll("users"), selectAll("guilds")],
  },
  {
    id: "goblin", name: "倉庫ゴブリン", sprite: GOBLIN, taunt: "ケケッ、渡さねえ！",
    phases: [selectAll("items"), selectAll("users")],
  },
  {
    id: "bat", name: "ギルドコウモリ", sprite: BAT, taunt: "キキッ、秘密だ",
    phases: [selectAll("guilds"), selectAll("items"), selectAll("users")],
  },
];

export const NEXT_SPELL = "列を指定する（SELECT name, age FROM …）";
