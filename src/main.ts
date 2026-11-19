import { castSpell, completions, judge, pruneAst, tokenize, type Judgement, type SpellError, type Token } from "./battle";
import { LV1_ENCOUNTERS, LV1_VOCABULARY, NEXT_SPELL, TABLES } from "./encounters";

const MAX_HP = 10;
const BACKFIRE = 3; // 呪文失敗（文法エラー）の反動
const COUNTER = 1; // 部品が足りず倒しきれなかったときの敵の反撃

interface State {
  hp: number;
  enemyIndex: number;
  wins: number;
  log: string[];
}

const state: State = { hp: MAX_HP, enemyIndex: 0, wins: 0, log: [] };

const app = document.querySelector<HTMLDivElement>("#app")!;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function hpBar(current: number, max: number, cls: string): string {
  const pct = Math.max(0, (current / max) * 100);
  return `<div class="bar ${cls}"><div class="fill" style="width:${pct}%"></div><span>${current} / ${max}</span></div>`;
}

function renderShell(): void {
  const tables = TABLES.map((t) => `<li><code>${t.name}</code>（${t.columns.join(", ")}）</li>`).join("");
  app.innerHTML = `
    <header>
      <h1>B1 パーサー階</h1>
      <div class="status">
        <span>Lv1　使える呪文: <code>SELECT * FROM 表</code></span>
        <span id="wins"></span>
      </div>
      <div id="player-hp"></div>
    </header>
    <main>
      <section class="enemy" id="enemy"></section>
      <section class="cast">
        <label for="spell">呪文（SQL）を唱える　<small>Tab で補完 ／ Ctrl+Enter で唱える</small></label>
        <textarea id="spell" rows="2" spellcheck="false" autocomplete="off" placeholder="SELECT * FROM ..."></textarea>
        <div id="suggest" class="suggest"></div>
        <button id="cast-btn">唱える</button>
      </section>
      <section id="result" class="result"></section>
      <aside class="tables">
        <h2>この階にある表</h2>
        <ul>${tables}</ul>
      </aside>
      <section class="log"><h2>記録</h2><ol id="log"></ol></section>
    </main>`;

  const input = document.querySelector<HTMLTextAreaElement>("#spell")!;
  document.querySelector("#cast-btn")!.addEventListener("click", () => onCast(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onCast(input.value);
    } else if (e.key === "Tab") {
      e.preventDefault();
      complete(input);
    } else if (e.key === "Enter") {
      e.preventDefault(); // 呪文は 1 行で唱える
    }
  });
  input.addEventListener("input", () => showSuggest(input));
}

function showSuggest(input: HTMLTextAreaElement): void {
  const { candidates } = completions(input.value.slice(0, input.selectionStart), LV1_VOCABULARY);
  document.querySelector("#suggest")!.innerHTML = candidates.map((c) => `<span>${esc(c)}</span>`).join("");
}

function complete(input: HTMLTextAreaElement): void {
  const cursor = input.selectionStart;
  const before = input.value.slice(0, cursor);
  const { prefix, candidates } = completions(before, LV1_VOCABULARY);
  if (candidates.length !== 1) return;
  const word = candidates[0];
  const after = input.value.slice(cursor);
  const inserted = word + (after.startsWith(" ") ? "" : " ");
  input.value = before.slice(0, before.length - prefix.length) + inserted + after;
  const pos = cursor - prefix.length + inserted.length;
  input.setSelectionRange(pos, pos);
  showSuggest(input);
}

function renderStatus(): void {
  document.querySelector("#player-hp")!.innerHTML = `<span class="who">あなた</span>${hpBar(state.hp, MAX_HP, "player")}`;
  document.querySelector("#wins")!.textContent = `撃破 ${state.wins} / ${LV1_ENCOUNTERS.length}`;
  const enemyEl = document.querySelector("#enemy")!;
  const enemy = LV1_ENCOUNTERS[state.enemyIndex];
  if (!enemy) {
    enemyEl.innerHTML = `
      <div class="levelup">
        <h2>レベルアップ！ Lv2</h2>
        <p>新しい呪文を覚えた：<strong>${esc(NEXT_SPELL)}</strong></p>
        <p class="muted">（試作はここまで。Lv2 の敵はまだいません）</p>
        <button id="restart">最初から</button>
      </div>`;
    document.querySelector("#restart")!.addEventListener("click", restart);
    return;
  }
  enemyEl.innerHTML = `
    <div class="enemy-name">${esc(enemy.name)}</div>
    <div class="demand">「${esc(enemy.demand)}」</div>
    <ul class="parts">${enemy.parts.map((p) => `<li data-part="${p.id}"><span class="mark">？</span>${esc(p.label)}</li>`).join("")}</ul>
    <p class="muted">1 回の呪文で、全部の部品を揃えると倒せる</p>`;
}

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
  if (Array.isArray(value)) {
    return `<li>${label}<ul>${value.map((v, i) => treeHtml(v, `[${i}]`)).join("")}</ul></li>`;
  }
  if (value && typeof value === "object") {
    return `<li>${label}<ul>${Object.entries(value).map(([k, v]) => treeHtml(v, k)).join("")}</ul></li>`;
  }
  return `<li>${label}<span class="v">${esc(JSON.stringify(value))}</span></li>`;
}

function errorHtml(sql: string, error: SpellError): string {
  const before = esc(sql.slice(0, error.offset));
  const at = error.found === null ? "␣" : esc(error.found);
  const after = esc(sql.slice(error.offset + 1));
  const where = error.found === null ? "呪文の終わり" : `${error.offset + 1} 文字目の「${esc(error.found)}」`;
  const expected = error.expected.length
    ? `<p>ここに来るはずだったもの：${error.expected.map((x) => `<code>${esc(x)}</code>`).join(" ")}</p>`
    : "";
  return `
    <h3 class="fail">呪文失敗！ パーサーが ${where} で読めなくなった（反動 −${BACKFIRE}）</h3>
    <pre class="caret">${before}<mark>${at}</mark>${error.found === null ? "" : after}</pre>
    ${expected}`;
}

function judgementHtml(j: Judgement): string {
  return `<ul class="parts judged">${j.parts
    .map(({ part, ok }) => `<li class="${ok ? "ok" : "ng"}"><span class="mark">${ok ? "✓" : "✗"}</span>${esc(part.label)}</li>`)
    .join("")}</ul>`;
}

function unknownTableNote(ast: { from?: { table?: string | null }[] | null }): string {
  const names = (ast.from ?? []).map((f) => f.table).filter((t): t is string => !!t);
  const unknown = names.filter((n) => !TABLES.some((t) => t.name.toLowerCase() === n.toLowerCase()));
  if (!unknown.length) return "";
  return `<p class="note">メモ：<code>${esc(unknown.join(", "))}</code> という表はこの階にありません。でもパーサーは文法しか見ないので、ここでは通ります。表が本当にあるかを確かめるのは、次の階（意味解析）の仕事です。</p>`;
}

function onCast(sql: string): void {
  const enemy = LV1_ENCOUNTERS[state.enemyIndex];
  if (!enemy || state.hp <= 0) return;
  const resultEl = document.querySelector("#result")!;
  const result = castSpell(sql);

  if (!result.ok) {
    state.hp = Math.max(0, state.hp - BACKFIRE);
    resultEl.innerHTML = `
      <h2>① 単語に分ける（字句解析）</h2><div class="tokens">${tokensHtml(tokenize(sql), result.error)}</div>
      <h2>② 構文木を組む（構文解析）</h2>${errorHtml(sql, result.error)}`;
    addLog(`✗ 呪文失敗「${sql.trim()}」 −${BACKFIRE}`);
  } else {
    const j = judge(enemy, result.ast);
    const pruned = pruneAst(result.ast);
    let verdict: string;
    if (j.defeated) {
      verdict = `<h3 class="win">${esc(enemy.name)} を倒した！（部品 ${j.damage} / ${enemy.parts.length}）</h3>`;
      state.wins++;
      state.enemyIndex++;
      addLog(`✓ ${enemy.name} を撃破「${sql.trim()}」`);
    } else {
      state.hp = Math.max(0, state.hp - COUNTER);
      verdict = `<h3 class="partial">部品 ${j.damage} / ${enemy.parts.length}。揃わず倒しきれない（反撃 −${COUNTER}）</h3>`;
      addLog(`△ ${enemy.name} に部品 ${j.damage}/${enemy.parts.length}「${sql.trim()}」 −${COUNTER}`);
    }
    resultEl.innerHTML = `
      <h2>① 単語に分ける（字句解析）</h2><div class="tokens">${tokensHtml(tokenize(sql))}</div>
      <h2>② 構文木を組む（構文解析 ── node-sql-parser の本物の出力）</h2>
      <ul class="tree">${treeHtml(pruned, "文")}</ul>
      <details><summary>空の項目も含めた生の出力</summary><pre>${esc(JSON.stringify(result.ast, null, 2))}</pre></details>
      <h2>③ お題の木と照合</h2>
      ${judgementHtml(j)}
      ${verdict}
      ${unknownTableNote(result.ast)}`;
  }

  renderStatus();
  if (state.hp <= 0) {
    resultEl.insertAdjacentHTML("beforeend", `<div class="gameover"><h2>力尽きた…</h2><button id="retry">やり直す</button></div>`);
    document.querySelector("#retry")!.addEventListener("click", restart);
  }
  const input = document.querySelector<HTMLTextAreaElement>("#spell")!;
  if (result.ok && judge(enemy, result.ast).defeated) input.value = "";
  input.focus();
}

function addLog(line: string): void {
  state.log.unshift(line);
  document.querySelector("#log")!.innerHTML = state.log.map((l) => `<li>${esc(l)}</li>`).join("");
}

function restart(): void {
  state.hp = MAX_HP;
  state.enemyIndex = 0;
  state.wins = 0;
  state.log = [];
  renderShell();
  renderStatus();
}

restart();
