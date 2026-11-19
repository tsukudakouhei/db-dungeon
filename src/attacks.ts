// 敵の攻撃「呪われた呪文」: 正しい SQL を少し壊し、本物のパーサーで本当に壊れているものだけを使う
import { castSpell, tokenize, type SpellError, type Token } from "./battle";

export type Rng = () => number;

export interface CursedSpell {
  sql: string;
  /** 壊す前の正しい呪文 */
  original: string;
  /** 壊した単語の位置（壊れた呪文の単語列での番号）。防御の正解。2 回続いた単語はどちらも正解 */
  broken: number[];
  /** 壊す前の単語（SELECT・FROM など）。出題が偏らないようにまとめる単位 */
  target: string;
  /** どう壊したか（答え合わせで見せる） */
  how: string;
  /** 本物のパーサーが返したエラー（止まった位置は答え合わせで見せる） */
  error: SpellError;
}

type Candidate = Omit<CursedSpell, "error">;

/**
 * 正しい SQL から、1 か所だけ壊した候補を全部作る。
 * 単語を丸ごと消す壊し方は「どれがおかしいか」を選べないので作らない。
 */
export function mutations(sql: string): Candidate[] {
  const tokens = tokenize(sql);
  const out: Candidate[] = [];
  const replaced = (i: number, text: string) => tokens.map((t, j) => (j === i ? text : t.text)).join(" ");

  tokens.forEach((t, i) => {
    const base = { original: sql, target: t.text.toUpperCase() };
    if (t.kind === "keyword" && t.text.length >= 3) {
      // 隣の 2 文字を入れ替える（FROM → FORM など）
      for (let k = 0; k < t.text.length - 1; k++) {
        const s = t.text.slice(0, k) + t.text[k + 1] + t.text[k] + t.text.slice(k + 2);
        if (s !== t.text) out.push({ ...base, sql: replaced(i, s), broken: [i], how: `「${t.text}」の綴りが「${s}」になっている` });
      }
      // 1 文字落とす（SELECT → SELEC など）
      for (let k = 0; k < t.text.length; k++) {
        const s = t.text.slice(0, k) + t.text.slice(k + 1);
        out.push({ ...base, sql: replaced(i, s), broken: [i], how: `「${t.text}」の綴りが「${s}」になっている` });
      }
    }
    if (t.kind === "symbol" && t.text === "*") {
      out.push({ ...base, sql: replaced(i, ","), broken: [i], how: "「*」が「,」になっている" });
    }
    // 同じ単語を 2 回続ける（どちらを選んでも正解）
    out.push({
      ...base,
      sql: tokens.flatMap((x, j) => (j === i ? [x.text, x.text] : [x.text])).join(" "),
      broken: [i, i + 1],
      how: `「${t.text}」が 2 回続いている`,
    });
  });

  // 重複を除く
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.sql) && seen.add(c.sql));
}

/** 本物のパーサーが失敗する候補だけを残す */
export function brokenMutations(sql: string): CursedSpell[] {
  return mutations(sql).flatMap((c) => {
    const r = castSpell(c.sql);
    return r.ok ? [] : [{ ...c, error: r.error }];
  });
}

/**
 * 壊れた呪文を 1 つ選ぶ。綴り間違いは SELECT だけで候補が多く偏るので、
 * 「壊す前の単語」ごとにまとめてから、まとまりを均等に選ぶ。
 */
export function pickCursedSpell(sql: string, rng: Rng = Math.random): CursedSpell {
  const groups = new Map<string, CursedSpell[]>();
  for (const c of brokenMutations(sql)) groups.set(c.target, [...(groups.get(c.target) ?? []), c]);
  const list = [...groups.values()];
  if (list.length === 0) throw new Error(`壊せる候補がない: ${sql}`);
  const group = list[Math.floor(rng() * list.length)];
  return group[Math.floor(rng() * group.length)];
}

/**
 * パーサーが止まった位置が、どの単語に当たるか。
 * 単語の間の空白で止まったら次の単語、入力の終わりなら -1（「終わり」を選ぶのが正解）。
 */
export function stopTokenIndex(tokens: Token[], offset: number): number {
  return tokens.findIndex((t) => offset < t.start + t.text.length);
}
