import { describe, expect, it } from "vitest";
import { brokenMutations, mutations, pickCursedSpell, stopTokenIndex } from "./attacks";
import { castSpell, tokenize } from "./battle";

const BASE = "SELECT * FROM users";

describe("mutations", () => {
  it("FROM → FORM のような入れ替えを含む", () => {
    expect(mutations(BASE).map((m) => m.sql)).toContain("SELECT * FORM users");
  });

  it("同じ候補は 1 回だけ", () => {
    const sqls = mutations(BASE).map((m) => m.sql);
    expect(new Set(sqls).size).toBe(sqls.length);
  });
});

describe("brokenMutations", () => {
  it("残るのは本物のパーサーで本当に失敗するものだけ", () => {
    const all = brokenMutations(BASE);
    expect(all.length).toBeGreaterThan(5);
    for (const c of all) expect(castSpell(c.sql).ok).toBe(false);
  });

  it("パーサーが通してしまう壊し方は除かれる", () => {
    // 表名を 2 回続けると「別名（エイリアス）」として通るので攻撃にならない
    const sqls = brokenMutations(BASE).map((m) => m.sql);
    expect(castSpell("SELECT * FROM users users").ok).toBe(true);
    expect(sqls).not.toContain("SELECT * FROM users users");
  });

  it.each(["SELECT * FROM items", "SELECT * FROM guilds"])("%s でも作れる", (sql) => {
    expect(brokenMutations(sql).length).toBeGreaterThan(5);
  });
});

describe("pickCursedSpell", () => {
  it("正解の単語が偏らないよう、止まる単語ごとに均等に選ぶ", () => {
    const stops = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = i / 40;
      const c = pickCursedSpell(BASE, () => r);
      const t = tokenize(c.sql);
      const k = stopTokenIndex(t, c.error.offset);
      stops.add(k < 0 ? "(end)" : t[k].text);
    }
    // * / SELECT / users / , / RFOM 系 / (end) など、複数の正解にばらける
    expect(stops.size).toBeGreaterThanOrEqual(6);
  });

  it("選ばれた呪文は本物のパーサーで失敗する", () => {
    for (let i = 0; i < 10; i++) expect(castSpell(pickCursedSpell(BASE).sql).ok).toBe(false);
  });
});

describe("stopTokenIndex", () => {
  it("FORM の M で止まると FORM の単語が正解", () => {
    const sql = "SELECT * FORM users";
    const r = castSpell(sql);
    if (r.ok) throw new Error("should fail");
    const tokens = tokenize(sql);
    expect(tokens[stopTokenIndex(tokens, r.error.offset)].text).toBe("FORM");
  });

  it("入力の終わりで止まると -1（終わり）", () => {
    const sql = "SELECT * FROM";
    const r = castSpell(sql);
    if (r.ok) throw new Error("should fail");
    expect(stopTokenIndex(tokenize(sql), r.error.offset)).toBe(-1);
  });

  it("空白で止まったら次の単語", () => {
    const tokens = tokenize("SELECT  FROM");
    expect(stopTokenIndex(tokens, 6)).toBe(1);
  });
});
