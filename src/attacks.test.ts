import { describe, expect, it } from "vitest";
import { brokenMutations, mutations, pickCursedSpell, stopTokenIndex } from "./attacks";
import { castSpell, tokenize } from "./battle";

const BASE = "SELECT * FROM users";

describe("mutations", () => {
  it("FROM → FORM のような入れ替えを含み、壊した単語の位置を記録する", () => {
    const m = mutations(BASE).find((x) => x.sql === "SELECT * FORM users");
    expect(m?.broken).toEqual([2]);
    expect(m?.original).toBe(BASE);
    expect(m?.target).toBe("FROM");
  });

  it("単語を丸ごと消す壊し方は作らない（どれがおかしいか選べないため）", () => {
    const sqls = mutations(BASE).map((m) => m.sql);
    expect(sqls).not.toContain("SELECT FROM users");
    expect(sqls).not.toContain("SELECT * FROM");
    for (const m of mutations(BASE)) expect(tokenize(m.sql).length).toBeGreaterThanOrEqual(4);
  });

  it("2 回続いた単語はどちらを選んでも正解", () => {
    const m = mutations(BASE).find((x) => x.sql === "SELECT * * FROM users");
    expect(m?.broken).toEqual([1, 2]);
  });

  it("壊した位置の単語は、元の呪文の単語と違うか重複している", () => {
    const orig = tokenize(BASE).map((t) => t.text);
    for (const m of mutations(BASE)) {
      const toks = tokenize(m.sql).map((t) => t.text);
      if (m.broken.length === 1) expect(toks[m.broken[0]]).not.toBe(orig[m.broken[0]]);
      else expect(toks[m.broken[0]]).toBe(toks[m.broken[1]]);
    }
  });

  it("空白の付き方は元の呪文のまま（, の前に空白を入れない）", () => {
    const sqls = mutations("SELECT name, age FROM users").map((m) => m.sql);
    expect(sqls).toContain("SELECT name,, age FROM users");
    expect(sqls).toContain("SELECT name, age FORM users");
    for (const s of sqls) expect(s).not.toMatch(/ ,/);
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
    expect(castSpell("SELECT * FROM users users").ok).toBe(true);
    expect(brokenMutations(BASE).map((m) => m.sql)).not.toContain("SELECT * FROM users users");
  });

  it.each(["SELECT * FROM items", "SELECT * FROM guilds"])("%s でも作れる", (sql) => {
    expect(brokenMutations(sql).length).toBeGreaterThan(5);
  });
});

describe("pickCursedSpell", () => {
  it("壊す単語が偏らないよう、壊す前の単語ごとに均等に選ぶ", () => {
    const targets = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = i / 40;
      targets.add(pickCursedSpell(BASE, () => r).target);
    }
    expect(targets).toEqual(new Set(["SELECT", "*", "FROM"]));
  });

  it("選ばれた呪文は本物のパーサーで失敗する", () => {
    for (let i = 0; i < 10; i++) expect(castSpell(pickCursedSpell(BASE).sql).ok).toBe(false);
  });
});

describe("stopTokenIndex", () => {
  it("FORM の M で止まると FORM の単語", () => {
    const sql = "SELECT * FORM users";
    const r = castSpell(sql);
    if (r.ok) throw new Error("should fail");
    const tokens = tokenize(sql);
    expect(tokens[stopTokenIndex(tokens, r.error.offset)].text).toBe("FORM");
  });

  it("SELEC の綴り間違いは、パーサーには次の * で止まって見える（人が見た間違いとずれる）", () => {
    const sql = "SELEC * FROM users";
    const r = castSpell(sql);
    if (r.ok) throw new Error("should fail");
    const tokens = tokenize(sql);
    expect(tokens[stopTokenIndex(tokens, r.error.offset)].text).toBe("*");
  });

  it("入力の終わりなら -1", () => {
    const sql = "SELECT * FROM";
    const r = castSpell(sql);
    if (r.ok) throw new Error("should fail");
    expect(stopTokenIndex(tokenize(sql), r.error.offset)).toBe(-1);
  });
});
