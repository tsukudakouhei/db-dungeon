import { describe, expect, it } from "vitest";
import { BAT, GOBLIN, GOLEM, HERO, MIMIC, SLIME, spriteSvg, type Sprite } from "./sprites";

const all: [string, Sprite][] = [["HERO", HERO], ["SLIME", SLIME], ["GOBLIN", GOBLIN], ["BAT", BAT], ["GOLEM", GOLEM], ["MIMIC", MIMIC]];

describe("sprites", () => {
  it.each(all)("%s は 16x16 で、使う文字がすべてパレットにある", (_, s) => {
    expect(s.rows).toHaveLength(16);
    for (const row of s.rows) {
      expect(row).toHaveLength(16);
      for (const c of row) if (c !== ".") expect(s.palette[c]).toBeDefined();
    }
  });

  it("SVG に横並びをまとめた rect を出す", () => {
    const svg = spriteSvg({ palette: { A: "#fff" }, rows: ["AA.A"] });
    expect(svg).toContain('<rect x="0" y="0" width="2" height="1" fill="#fff"/>');
    expect(svg).toContain('<rect x="3" y="0" width="1" height="1" fill="#fff"/>');
  });
});
