// B1 パーサー階の Lv1 の敵（お題）
import { Encounter, fromTable, isSelect, selectsAllColumns } from "./battle";
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

/** 戦闘に出てくる敵＝お題＋見た目 */
export interface Foe extends Encounter {
  sprite: Sprite;
  /** 倒しきれなかったときの敵の台詞 */
  taunt: string;
}

function lv1(id: string, name: string, table: string, label: string, sprite: Sprite, taunt: string): Foe {
  return {
    id,
    name,
    sprite,
    taunt,
    demand: `${table} 表の中身を、全部の列まるごと見せろ（${label}）`,
    parts: [
      { id: "type", label: "文の種類が SELECT（取り出す）", check: isSelect },
      { id: "columns", label: "列が *（全部の列）", check: selectsAllColumns },
      { id: "from", label: `取り出し元が ${table}`, check: (ast) => fromTable(ast, table) },
    ],
  };
}

/** Lv1 で使える呪文の語彙（入力補完に使う） */
export const LV1_VOCABULARY = ["SELECT", "FROM", ...TABLES.map((t) => t.name)];

/** Lv1 の敵。3 体倒すと次の呪文が使えるようになる */
export const LV1_ENCOUNTERS: Foe[] = [
  lv1("slime-users", "名簿スライム", "users", "冒険者の名簿", SLIME, "ぷるぷる…そんな呪文じゃ名簿は見せないよ"),
  lv1("goblin-items", "倉庫ゴブリン", "items", "道具の在庫", GOBLIN, "ケケッ、在庫は渡さねえ！"),
  lv1("bat-guilds", "ギルドコウモリ", "guilds", "ギルドの一覧", BAT, "キキッ、ギルドの名は秘密だ"),
];

export const NEXT_SPELL = "列を指定する（SELECT name, age FROM …）";
