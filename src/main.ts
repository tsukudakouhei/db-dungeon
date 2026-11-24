import { castSpell, completions, judge, pruneAst, tokenize, type Judgement, type SpellError, type Token } from "./battle";
import { pickCursedSpell, stopTokenIndex } from "./attacks";
import { LEVELS, NEXT_SPELL, TABLES, type Foe, type Phase } from "./encounters";
import { HERO, spriteSvg } from "./sprites";

const MAX_HP = 20;
const BACKFIRE = 3; // 呪文失敗（文法エラー）の反動
const GUARD_FAIL = 3; // 呪われた呪文を見切れなかったときのダメージ
const TACKLE = 1; // 敵の体当たり（防御できない小さな攻撃）
const CURSE_RATE = 0.55; // 敵のターンに呪われた呪文を撃つ確率（残りは体当たり）
const HERO_NAME = "見習い魔導士";

interface State {
  hp: number;
  levelIndex: number;
  /** いまのレベルの何体目の敵か */
  enemyIndex: number;
  /** いまの敵の何番目のお題か */
  phaseIndex: number;
  /** いまのレベルで倒した数 */
  wins: number;
  busy: boolean;
}

const level = () => LEVELS[state.levelIndex];
const currentFoe = (): Foe | undefined => level()?.foes[state.enemyIndex];

const state: State = { hp: MAX_HP, levelIndex: 0, enemyIndex: 0, phaseIndex: 0, wins: 0, busy: false };
const app = document.querySelector<HTMLDivElement>("#app")!;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---- 画面の骨組み ---------------------------------------------------------

function renderShell(): void {
  const tables = TABLES.map((t) => `<li><code>${t.name}</code>（${t.columns.join(", ")}）</li>`).join("");
  app.innerHTML = `
    <div class="game">
      <div class="floor-title">B1 パーサー階</div>
      <section class="stage" id="stage">
        <div class="runes" id="runes"></div>
        <div class="foe" id="foe"></div>
        <div class="popups" id="popups"></div>
      </section>
      <section class="window challenge" id="challenge"></section>
      <section class="window message" id="message"></section>
      <section class="command">
        <div class="window party" id="party">
          <div class="portrait">${spriteSvg(HERO, "hero")}</div>
          <div class="stats">
            <div class="name">${HERO_NAME} <span class="lv">Lv1</span></div>
            <div class="row"><span>HP</span><div class="bar hp"><div class="fill" id="hp-fill"></div></div><b id="hp-num"></b></div>
            <div class="row"><span>EXP</span><div class="bar exp"><div class="fill" id="exp-fill"></div></div><b id="exp-num"></b></div>
          </div>
        </div>
        <div class="window spell">
          <label for="spell">呪文（SQL）　<small>Tab で補完 ／ Ctrl+Enter で唱える</small></label>
          <textarea id="spell" rows="1" spellcheck="false" autocomplete="off" placeholder="SELECT * FROM ..."></textarea>
          <div class="spell-foot"><div id="suggest" class="suggest"></div><button id="cast-btn">唱える</button></div>
        </div>
      </section>
      <section class="book">
        <div class="window">
          <h2>解析の書 <small>── 最後に唱えた呪文を、パーサーがどう読んだか</small></h2>
          <div id="analysis" class="analysis"><p class="muted">呪文を唱えると、ここに字句解析・構文木・照合の結果が記録されます。</p></div>
        </div>
        <div class="window map">
          <h2>この階にある表</h2>
          <ul>${tables}</ul>
        </div>
      </section>
    </div>`;

  const input = $<HTMLTextAreaElement>("#spell");
  $("#cast-btn").addEventListener("click", () => void onCast(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void onCast(input.value);
    } else if (e.key === "Tab") {
      e.preventDefault();
      complete(input);
    } else if (e.key === "Enter") {
      e.preventDefault(); // 呪文は 1 行で唱える
    }
  });
  input.addEventListener("input", () => showSuggest(input));
}

// ---- 入力補完 ---------------------------------------------------------------

function showSuggest(input: HTMLTextAreaElement): void {
  const { candidates } = completions(input.value.slice(0, input.selectionStart), level().vocabulary);
  $("#suggest").innerHTML = candidates.map((c) => `<span>${esc(c)}</span>`).join("");
}

function complete(input: HTMLTextAreaElement): void {
  const cursor = input.selectionStart;
  const before = input.value.slice(0, cursor);
  const { prefix, candidates } = completions(before, level().vocabulary);
  if (candidates.length !== 1) return;
  const after = input.value.slice(cursor);
  const inserted = candidates[0] + (after.startsWith(" ") ? "" : " ");
  input.value = before.slice(0, before.length - prefix.length) + inserted + after;
  const pos = cursor - prefix.length + inserted.length;
  input.setSelectionRange(pos, pos);
  showSuggest(input);
}

// ---- 表示の更新 -------------------------------------------------------------

function renderParty(): void {
  $("#hp-fill").style.width = `${(state.hp / MAX_HP) * 100}%`;
  $("#hp-fill").classList.toggle("low", state.hp <= 3);
  $("#hp-num").textContent = `${state.hp}/${MAX_HP}`;
  const total = level()?.foes.length ?? 1;
  $("#exp-fill").style.width = `${Math.min(1, state.wins / total) * 100}%`;
  $("#exp-num").textContent = `${state.wins}/${total}`;
  $(".party .lv").textContent = `Lv${level()?.level ?? LEVELS.length}`;
}

function renderFoeHp(foe: Foe): void {
  const left = foe.phases.length - state.phaseIndex;
  $("#foe-hp").innerHTML = foe.phases.map((_, i) => `<i class="${i < left ? "on" : ""}"></i>`).join("");
}

function renderRunes(phase: Phase, results?: boolean[]): void {
  // 読む・直すお題では、部品の中身が答えそのものなので、照合するまで伏せる
  const hidden = phase.kind !== "write";
  $("#runes").innerHTML = phase.parts
    .map((p, i) => {
      const r = results?.[i];
      const cls = r === undefined ? "" : r ? "lit" : "miss";
      const label = hidden && r === undefined ? `部品 ${i + 1}` : p.label;
      return `<div class="rune ${cls}" data-i="${i}"><span class="mark">${r === undefined ? "？" : r ? "✓" : "✗"}</span>${esc(label)}</div>`;
    })
    .join("");
}

/** メッセージ窓に 1 行ずつ文字送りで出す */
async function say(lines: string[], opts: { clear?: boolean } = {}): Promise<void> {
  const box = $("#message");
  if (opts.clear !== false) box.innerHTML = "";
  for (const line of lines) {
    const p = document.createElement("p");
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
    const plain = line.replace(/<[^>]+>/g, "");
    for (let i = 1; i <= plain.length; i += 2) {
      p.textContent = plain.slice(0, i);
      await sleep(18);
    }
    p.innerHTML = line; // 最後に装飾付きで確定
    box.scrollTop = box.scrollHeight;
    await sleep(260);
  }
}

function popup(text: string, cls: string): void {
  const el = document.createElement("div");
  el.className = `popup ${cls}`;
  el.textContent = text;
  $("#popups").appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

function flash(selector: string, cls: string, ms = 450): Promise<void> {
  const el = $(selector);
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth; // アニメーションを毎回やり直す
  el.classList.add(cls);
  return sleep(ms).then(() => el.classList.remove(cls));
}

// ---- 敵の登場 ---------------------------------------------------------------

const KIND_LABEL: Record<Phase["kind"], string> = { write: "書く", tree: "木を読む", fix: "直す" };

/** いまのお題を、やることに合わせて「お題の窓」に出す。直すお題は壊れた呪文を入力欄にも入れる */
function presentPhase(phase: Phase): void {
  const box = $("#challenge");
  const tag = `<span class="kind kind-${phase.kind}">${KIND_LABEL[phase.kind]}</span>`;
  const input = $<HTMLTextAreaElement>("#spell");
  if (phase.kind === "write") {
    box.innerHTML = `${tag}<p class="demand">「${esc(phase.demand)}」</p>`;
    input.value = "";
  } else if (phase.kind === "tree") {
    const r = castSpell(phase.answer);
    const tree = r.ok ? treeHtml(pruneAst(r.ast), "文") : "";
    box.innerHTML = `${tag}<p class="demand">この構文木になる呪文を唱えろ。</p><ul class="tree target-tree">${tree}</ul>`;
    input.value = "";
  } else {
    const cursed = pickCursedSpell(phase.answer);
    box.innerHTML = `${tag}<p class="demand">呪われた呪文が 1 か所壊れている。<b>直して</b>唱え返せ。</p><pre class="caret cursed">${esc(cursed.sql)}</pre>`;
    input.value = cursed.sql;
  }
  $("#suggest").innerHTML = "";
}

async function enterFoe(): Promise<void> {
  const foe = currentFoe();
  if (!foe) return levelUp();
  const phase = foe.phases[0];
  $("#foe").innerHTML = `${spriteSvg(foe.sprite, "foe-sprite enter")}<div class="foe-name">${esc(foe.name)}</div><div class="foe-hp" id="foe-hp"></div>`;
  renderFoeHp(foe);
  renderRunes(phase);
  presentPhase(phase);
  const kinds = [...new Set(foe.phases.map((p) => KIND_LABEL[p.kind]))].join("・");
  await say([
    `<b class="foe-c">${esc(foe.name)}</b> があらわれた！`,
    `お題は ${foe.phases.length} つ（${kinds}）。1 回の呪文で部品を全部そろえると、お題を 1 つくずせる。`,
  ]);
  $<HTMLTextAreaElement>("#spell").focus();
}

async function levelUp(): Promise<void> {
  const next = LEVELS[state.levelIndex + 1];
  $("#runes").innerHTML = "";
  $("#challenge").innerHTML = "";
  if (!next) {
    $("#foe").innerHTML = `<div class="levelup-glow">CLEAR</div>`;
    await say([
      `<b class="win-c">この階の試作はここまで！</b>`,
      `次に覚える呪文：<b>${esc(NEXT_SPELL)}</b> <span class="muted">（まだ作っていません）</span>`,
    ]);
    $("#message").insertAdjacentHTML("beforeend", `<button id="restart">最初から</button>`);
    $("#restart").addEventListener("click", () => void restart());
    return;
  }
  $("#foe").innerHTML = `<div class="levelup-glow">Lv${next.level}</div>`;
  await say([
    `<b class="win-c">レベルアップ！</b> ${HERO_NAME} は Lv${next.level} になった！`,
    `新しい呪文を覚えた：<b>${esc(next.spell)}</b>`,
    `<span class="muted">前に覚えた呪文も、ときどき出てくる。</span>`,
  ]);
  $("#message").insertAdjacentHTML("beforeend", `<button id="next-level">先へ進む</button>`);
  await new Promise<void>((resolve) => $("#next-level").addEventListener("click", () => resolve()));
  state.levelIndex++;
  state.enemyIndex = 0;
  state.phaseIndex = 0;
  state.wins = 0;
  renderParty();
  await enterFoe();
}

// ---- 解析の書 ---------------------------------------------------------------

function tokensHtml(tokens: Token[], error?: SpellError): string {
  const kindLabel: Record<string, string> = {
    keyword: "キーワード", identifier: "名前", number: "数", string: "文字列", symbol: "記号", unknown: "？",
  };
  return tokens
    .map((t) => {
      const stopped = error && error.offset >= t.start && error.offset < t.start + t.text.length;
      return `<span class="tok ${t.kind}${stopped ? " stopped" : ""}"><b>${esc(t.text)}</b><i>${kindLabel[t.kind]}</i></span>`;
    })
    .join("");
}

function treeHtml(value: unknown, key?: string): string {
  const label = key !== undefined ? `<span class="k">${esc(key)}</span>` : "";
  if (Array.isArray(value)) return `<li>${label}<ul>${value.map((v, i) => treeHtml(v, `[${i}]`)).join("")}</ul></li>`;
  if (value && typeof value === "object") {
    return `<li>${label}<ul>${Object.entries(value).map(([k, v]) => treeHtml(v, k)).join("")}</ul></li>`;
  }
  return `<li>${label}<span class="v">${esc(JSON.stringify(value))}</span></li>`;
}

function caretHtml(sql: string, error: SpellError): string {
  const at = error.found === null ? "␣" : esc(error.found);
  const after = error.found === null ? "" : esc(sql.slice(error.offset + 1));
  return `<pre class="caret">${esc(sql.slice(0, error.offset))}<mark>${at}</mark>${after}</pre>`;
}

function expectedHtml(error: SpellError): string {
  return error.expected.length
    ? `<p>ここに来るはずだったもの：${error.expected.map((x) => `<code>${esc(x)}</code>`).join(" ")}</p>`
    : "";
}

function judgementHtml(j: Judgement): string {
  return `<ul class="judged">${j.parts
    .map(
      ({ part, ok, hint }) =>
        `<li class="${ok ? "ok" : "ng"}"><span class="mark">${ok ? "✓" : "✗"}</span>${esc(part.label)}${
          hint ? `<div class="hint">${esc(hint)}</div>` : ""
        }</li>`,
    )
    .join("")}</ul>`;
}

function unknownTables(ast: { from?: { table?: string | null }[] | null }): string[] {
  const names = (ast.from ?? []).map((f) => f.table).filter((t): t is string => !!t);
  return names.filter((n) => !TABLES.some((t) => t.name.toLowerCase() === n.toLowerCase()));
}

// ---- 戦闘 -------------------------------------------------------------------

async function onCast(sql: string): Promise<void> {
  const foe = currentFoe();
  if (!foe || state.hp <= 0 || state.busy) return;
  setBusy(true);
  try {
    await runTurn(foe, sql);
  } finally {
    setBusy(false);
  }
}

function setBusy(busy: boolean): void {
  state.busy = busy;
  $("#cast-btn").toggleAttribute("disabled", busy);
  $<HTMLTextAreaElement>("#spell").toggleAttribute("readonly", busy);
}

async function damageHero(amount: number, line: string): Promise<void> {
  state.hp = Math.max(0, state.hp - amount);
  renderParty();
  popup(`-${amount}`, "dmg-hero");
  await flash(".game", "shake", 450);
  await say([line], { clear: false });
}

/** 自分のターン: 呪文を唱えてお題の木と照合する */
async function runTurn(foe: Foe, sql: string): Promise<void> {
  const phase = foe.phases[state.phaseIndex];
  const spell = sql.trim();
  const result = castSpell(sql);
  const analysis = $("#analysis");

  await say([`${HERO_NAME} は呪文をとなえた！`, `<code class="chant">${esc(spell || "……")}</code>`]);
  await flash(".portrait", "casting", 500);

  if (!result.ok) {
    analysis.innerHTML = `
      <h3>① 単語に分ける（字句解析）</h3><div class="tokens">${tokensHtml(tokenize(sql), result.error)}</div>
      <h3>② 構文木を組む（構文解析）</h3>
      <p class="fail-c">パーサーが ${result.error.found === null ? "呪文の終わり" : `${result.error.offset + 1} 文字目の「${esc(result.error.found)}」`} で読めなくなった</p>
      ${caretHtml(sql, result.error)}${expectedHtml(result.error)}`;
    const where = result.error.found === null ? "呪文の終わり" : `「${esc(result.error.found)}」`;
    await say([`しかし呪文は ${where} で途切れた！`], { clear: false });
    $("#message").insertAdjacentHTML("beforeend", caretHtml(sql, result.error));
    await damageHero(BACKFIRE, `呪文の反動！ ${HERO_NAME} は <b class="fail-c">${BACKFIRE}</b> のダメージをうけた。`);
    return enemyTurn(foe);
  }

  const j = judge(phase, result.ast);
  analysis.innerHTML = `
    <h3>① 単語に分ける（字句解析）</h3><div class="tokens">${tokensHtml(tokenize(sql))}</div>
    <h3>② 構文木を組む（構文解析 ── node-sql-parser の本物の出力）</h3>
    <ul class="tree">${treeHtml(pruneAst(result.ast), "文")}</ul>
    <details><summary>空の項目も含めた生の出力</summary><pre>${esc(JSON.stringify(result.ast, null, 2))}</pre></details>
    <h3>③ お題の木と照合</h3>${judgementHtml(j)}`;

  await say(["パーサーが呪文を構文木に組み上げた！"], { clear: false });

  // 部品ごとに 1 発ずつ当てる
  const results: boolean[] = [];
  for (const { part, ok, hint } of j.parts) {
    results.push(ok);
    renderRunes(phase, [...results]);
    if (ok) {
      popup("HIT", "hit");
      await flash(".foe-sprite", "hurt", 380);
    } else {
      popup("MISS", "miss");
      await sleep(380);
      await say([`<span class="fail-c">✗ ${esc(part.label)}</span> がそろっていない`], { clear: false });
      if (hint) await say([`<span class="note-c">惜しい：${esc(hint)}</span>`], { clear: false });
    }
  }

  const unknown = unknownTables(result.ast);
  if (unknown.length) {
    await say(
      [`<span class="note-c">メモ：${esc(unknown.join(", "))} という表はこの階にない。でもパーサーは文法しか見ないので通った。表があるかを確かめるのは次の階（意味解析）の仕事だ。</span>`],
      { clear: false },
    );
  }

  if (!j.defeated) {
    await say([`${esc(foe.name)}「${esc(foe.taunt)}」`], { clear: false });
    return enemyTurn(foe);
  }

  // お題を 1 つ倒した
  state.phaseIndex++;
  renderFoeHp(foe);

  if (state.phaseIndex < foe.phases.length) {
    const next = foe.phases[state.phaseIndex];
    await say([`<b class="win-c">お題をくずした！</b> ${esc(foe.name)} は形を変えた！（次は「${KIND_LABEL[next.kind]}」）`], { clear: false });
    renderRunes(next);
    presentPhase(next);
    await sleep(500);
    return enemyTurn(foe);
  }

  $(".foe-sprite").classList.add("defeated");
  await sleep(600);
  state.wins++;
  state.enemyIndex++;
  state.phaseIndex = 0;
  renderParty();
  await say([`<b class="win-c">${esc(foe.name)} をたおした！</b>　経験値を 1 かくとく。`]);
  await sleep(700);
  return enterFoe();
}

/** 敵のターン: 呪われた呪文（1 か所壊した SQL）を撃ってくる。おかしい単語を当てれば防御成功 */
async function enemyTurn(foe: Foe): Promise<void> {
  if (state.hp <= 0) return afterTurn();
  await sleep(500);
  if (Math.random() >= CURSE_RATE) {
    await flash(".foe-sprite", "lunge", 350);
    await say([`<b class="foe-c">${esc(foe.name)}</b> の体当たり！`]);
    await damageHero(TACKLE, `${HERO_NAME} は ${TACKLE} のダメージをうけた。`);
    return afterTurn();
  }
  const phase = foe.phases[state.phaseIndex];
  const cursed = pickCursedSpell(phase.answer);
  const tokens = tokenize(cursed.sql);
  const stop = stopTokenIndex(tokens, cursed.error.offset);

  await flash(".foe-sprite", "lunge", 350);
  await say([
    `<b class="foe-c">${esc(foe.name)}</b> は呪われた呪文を放った！`,
    `どこか 1 か所が壊されている。<b>おかしい単語</b>を選んで防御しろ！`,
  ]);
  const box = $("#message");
  box.insertAdjacentHTML(
    "beforeend",
    `<div class="guard" id="guard">${tokens
      .map((t, i) => `<button class="guard-tok tok ${t.kind}" data-i="${i}"><b>${esc(t.text)}</b></button>`)
      .join("")}</div>`,
  );
  box.scrollTop = box.scrollHeight;
  const picked = await new Promise<number>((resolve) => {
    $("#guard").addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".guard-tok");
      if (btn) resolve(Number(btn.dataset.i));
    });
  });
  const hit = cursed.broken.includes(picked);
  $("#guard").querySelectorAll<HTMLButtonElement>(".guard-tok").forEach((b) => {
    b.disabled = true;
    const i = Number(b.dataset.i);
    if (cursed.broken.includes(i)) b.classList.add("answer");
    else if (i === picked) b.classList.add("wrong");
  });

  if (hit) {
    popup("GUARD", "guard-pop");
    await say([`<b class="win-c">見切った！</b> ${esc(cursed.how)}。`], { clear: false });
  } else {
    await say([`<span class="fail-c">見切れなかった！</span> ${esc(cursed.how)}。`], { clear: false });
    await damageHero(GUARD_FAIL, `${HERO_NAME} は <b class="fail-c">${GUARD_FAIL}</b> のダメージをうけた。`);
  }

  // 答え合わせ: 元の呪文と、本物のパーサーが実際に止まった場所
  const stopWord = stop < 0 ? "呪文の終わり" : `「${tokens[stop].text}」`;
  const sameSpot = cursed.broken.includes(stop);
  const reveal = `
    <div class="reveal">
      <div><span class="muted">元の呪文</span> <code>${esc(cursed.original)}</code></div>
      <div><span class="muted">パーサーが止まった場所</span></div>
      ${caretHtml(cursed.sql, cursed.error)}
      <p class="muted">パーサーは「${esc(cursed.sql.slice(0, cursed.error.offset).trim()) || "（先頭）"}」までは文法として成り立つと読み進め、${esc(stopWord)}で行き詰まった。${
        sameSpot ? "" : `<br><b class="note-c">壊れていたのは別の単語なのに、パーサーが困ったのは ${esc(stopWord)}。人が見た間違いと、パーサーが読めなくなる場所は、ずれることがある。</b>`
      }</p>
    </div>`;
  box.insertAdjacentHTML("beforeend", reveal);
  box.scrollTop = box.scrollHeight;
  $("#analysis").insertAdjacentHTML(
    "beforeend",
    `<h3>④ 敵の呪われた呪文</h3><p class="muted">元の呪文：<code>${esc(cursed.original)}</code>　${esc(cursed.how)}</p>${caretHtml(cursed.sql, cursed.error)}${expectedHtml(cursed.error)}`,
  );
  await sleep(400);
  return afterTurn();
}

async function afterTurn(): Promise<void> {
  if (state.hp > 0) {
    $<HTMLTextAreaElement>("#spell").focus();
    return;
  }
  await say([`<b class="fail-c">${HERO_NAME} は力尽きた…</b>`]);
  $("#message").insertAdjacentHTML("beforeend", `<button id="retry">やり直す</button>`);
  $("#retry").addEventListener("click", () => void restart());
}

async function restart(): Promise<void> {
  state.hp = MAX_HP;
  state.levelIndex = 0;
  state.enemyIndex = 0;
  state.phaseIndex = 0;
  state.wins = 0;
  state.busy = false;
  renderShell();
  renderParty();
  await enterFoe();
}

void restart();
