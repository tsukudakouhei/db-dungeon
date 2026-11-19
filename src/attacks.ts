// 敵の攻撃「呪われた呪文」: 正しい SQL を少し壊し、本物のパーサーで本当に壊れているものだけを使う
import { castSpell, tokenize, type SpellError, type Token } from "./battle";

export type Rng = () => number;

export interface CursedSpell {
  sql: string;
  /** 本物のパーサーが返したエラー（止まった位置が防御の正解） */
  error: SpellError;
  /** どう壊したか（あとで解説に使う） */
  how: string;
}

interface Candidate {
  sql: string;
  how: string;
}

/** 正しい SQL から、1 か所だけ壊した候補を全部作る */
export function mutations(sql: string): Candidate[] {
  const tokens = tokenize(sql);
  const out: Candidate[] = [];
  const rebuild = (i: number, text: string | null) =>
    tokens
      .map((t, j) => (j === i ? text : t.text))
      .filter((t): t is string => t !== null && t !== "")
      .join(" ");

  tokens.forEach((t, i) => {
    // 単語ごと消す
    out.push({ sql: rebuild(i, null), how: `「${t.text}」が抜けている` });
    if (t.kind === "keyword" && t.text.length >= 3) {
      // 隣の 2 文字を入れ替える（FROM → FORM など）
      for (let k = 0; k < t.text.length - 1; k++) {
        const s = t.text.slice(0, k) + t.text[k + 1] + t.text[k] + t.text.slice(k + 2);
        if (s !== t.text) out.push({ sql: rebuild(i, s), how: `「${t.text}」の綴りが「${s}」になっている` });
      }
      // 1 文字落とす（SELECT → SELEC など）
      for (let k = 0; k < t.text.length; k++) {
        const s = t.text.slice(0, k) + t.text.slice(k + 1);
        out.push({ sql: rebuild(i, s), how: `「${t.text}」の綴りが「${s}」になっている` });
      }
    }
    if (t.kind === "symbol" && t.text === "*") {
      out.push({ sql: rebuild(i, ","), how: "「*」が「,」になっている" });
    }
    // 同じ単語を 2 回続ける
    out.push({
      sql: tokens.flatMap((x, j) => (j === i ? [x.text, x.text] : [x.text])).join(" "),
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
    return r.ok ? [] : [{ sql: c.sql, error: r.error, how: c.how }];
  });
}

/**
 * 壊れた呪文を 1 つ選ぶ。綴り間違いは数が多く正解が偏るので、
 * 「パーサーが止まる単語」ごとにまとめてから、まとまりを均等に選ぶ。
 */
export function pickCursedSpell(sql: string, rng: Rng = Math.random): CursedSpell {
  const groups = new Map<string, CursedSpell[]>();
  for (const c of brokenMutations(sql)) {
    const tokens = tokenize(c.sql);
    const i = stopTokenIndex(tokens, c.error.offset);
    const key = i < 0 ? "(end)" : tokens[i].text.toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
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
