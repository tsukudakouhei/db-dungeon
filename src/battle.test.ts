import { describe, expect, it } from "vitest";
import { castSpell, completions, judge, pruneAst, tokenize } from "./battle";
import { LV1_ENCOUNTERS, LV1_VOCABULARY } from "./encounters";

const slime = LV1_ENCOUNTERS[0]; // users

function cast(sql: string) {
  const r = castSpell(sql);
  if (!r.ok) throw new Error(`parse failed: ${r.error.message}`);
  return r.ast;
}

describe("castSpell", () => {
  it("正しい SELECT は構文木になる", () => {
    const ast = cast("SELECT * FROM users");
    expect(ast.type).toBe("select");
  });

  it("小文字でも通る", () => {
    expect(castSpell("select * from users").ok).toBe(true);
  });

  it("FORM の綴り間違いは、パーサーが FOR と読んだ先の M で止まる", () => {
    const r = castSpell("SELECT * FORM users");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.offset).toBe(12);
    expect(r.error.found).toBe("M");
  });

  it("途中で終わった呪文は、入力の終わりで止まる", () => {
    const r = castSpell("SELECT * FROM");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.offset).toBe(13);
    expect(r.error.found).toBeNull();
  });

  it("期待候補からコメントや空白の雑音を除く", () => {
    const r = castSpell("SELECT * FORM users");
    if (r.ok) throw new Error("should fail");
    expect(r.error.expected).not.toContain('"--"');
    expect(r.error.expected).not.toContain("[ \\t\\n\\r]");
    expect(r.error.expected).toContain('"UPDATE"');
  });

  it("空の呪文は失敗", () => {
    expect(castSpell("   ").ok).toBe(false);
  });

  it("2 つ同時に唱えると失敗", () => {
    expect(castSpell("SELECT * FROM users; SELECT * FROM items").ok).toBe(false);
  });
});

describe("judge", () => {
  it("お題どおりなら全部品が合って倒せる", () => {
    const j = judge(slime, cast("SELECT * FROM users"));
    expect(j.damage).toBe(3);
    expect(j.defeated).toBe(true);
  });

  it("表を間違えると、取り出し元の部品だけ外れる", () => {
    const j = judge(slime, cast("SELECT * FROM items"));
    expect(j.damage).toBe(2);
    expect(j.defeated).toBe(false);
    expect(j.parts.find((p) => p.part.id === "from")?.ok).toBe(false);
  });

  it("存在しない表名でもパーサーは通す（判定は部品の照合だけで外れる）", () => {
    const r = castSpell("SELECT * FROM usres");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(judge(slime, r.ast).defeated).toBe(false);
  });

  it("列を指定すると、* の部品が外れる", () => {
    const j = judge(slime, cast("SELECT name FROM users"));
    expect(j.parts.find((p) => p.part.id === "columns")?.ok).toBe(false);
  });

  it("SELECT 以外の文は種類の部品が外れる", () => {
    const j = judge(slime, cast("DELETE FROM users"));
    expect(j.parts.find((p) => p.part.id === "type")?.ok).toBe(false);
    expect(j.defeated).toBe(false);
  });

  it("表の大文字小文字は区別しない", () => {
    expect(judge(slime, cast("SELECT * FROM USERS")).defeated).toBe(true);
  });
});

describe("tokenize", () => {
  it("キーワード・記号・識別子に分ける", () => {
    const t = tokenize("SELECT * FROM users");
    expect(t.map((x) => [x.text, x.kind])).toEqual([
      ["SELECT", "keyword"],
      ["*", "symbol"],
      ["FROM", "keyword"],
      ["users", "identifier"],
    ]);
    expect(t[3].start).toBe(14);
  });

  it("綴り間違いのキーワードは識別子扱いになる", () => {
    expect(tokenize("SELEC")[0].kind).toBe("identifier");
  });
});

describe("completions", () => {
  it("先頭一致で候補を出す", () => {
    expect(completions("SEL", LV1_VOCABULARY).candidates).toEqual(["SELECT"]);
    expect(completions("SELECT * FROM u", LV1_VOCABULARY).candidates).toEqual(["users"]);
  });

  it("単語の途中でなければ候補なし", () => {
    expect(completions("SELECT * ", LV1_VOCABULARY).candidates).toEqual([]);
  });
});

describe("pruneAst", () => {
  it("null と空の部分を落とす", () => {
    expect(pruneAst({ a: null, b: [], c: { d: null }, e: "x", f: [{ g: 1, h: null }] })).toEqual({
      e: "x",
      f: [{ g: 1 }],
    });
  });
});
