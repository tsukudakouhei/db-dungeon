// 16x16 のドット絵（オリジナル）。1 文字 = 1 ドット、"." は透明。

export interface Sprite {
  rows: string[];
  palette: Record<string, string>;
}

export const HERO: Sprite = {
  palette: { K: "#1b1d2a", H: "#5b5fd6", S: "#f2c9a0", R: "#3d7bd9", Y: "#ffe066", W: "#9a6b3f" },
  rows: [
    "................",
    ".......KK.......",
    "......KHHK......",
    ".....KHHHHK.....",
    "....KHHHHHHK....",
    "...KKKKKKKKKK...",
    "....KSSSSSSK....",
    "....KSKSSKSK.Y..",
    "....KSSSSSSK.Y..",
    ".....KRRRRK..W..",
    "....KRRRRRRK.W..",
    "...KRRRRRRRRSW..",
    "...KRRRRRRRRKW..",
    "...KRRRRRRRRK...",
    "....KKK..KKK....",
    "................",
  ],
};

export const SLIME: Sprite = {
  palette: { K: "#0f2a3d", B: "#3fa9f5", L: "#a8dcff", W: "#ffffff", E: "#0f2a3d" },
  rows: [
    "................",
    "................",
    "................",
    ".......KK.......",
    "......KBBK......",
    ".....KBLBBK.....",
    "....KBLLBBBK....",
    "...KBBLBBBBBK...",
    "..KBBBBBBBBBBK..",
    "..KBBWEBBWEBBK..",
    ".KBBBWEBBWEBBBK.",
    ".KBBBBBBBBBBBBK.",
    ".KBBBBKKKKBBBBK.",
    "..KBBBBBBBBBBK..",
    "...KKKKKKKKKK...",
    "................",
  ],
};

export const GOBLIN: Sprite = {
  palette: { K: "#1d2416", G: "#6dbb4a", R: "#ff4d4d", T: "#8a5a2b", S: "#c7ccd6" },
  rows: [
    "................",
    ".....KKKKKK.....",
    "....KGGGGGGK....",
    "..KKGRGGGGRGKK..",
    "..KGGGGGGGGGGK..",
    "...KGGKKKKGGK...",
    "....KGGGGGGK....",
    "...KKTTTTTTKK...",
    "..KGKTTTTTTKGK..",
    "..KGKTTTTTTKGKS.",
    "...K.KTTTTK.K.S.",
    ".....KTKKTK...S.",
    ".....KGK.KGK..S.",
    "....KKKK.KKKK...",
    "................",
    "................",
  ],
};

export const BAT: Sprite = {
  palette: { K: "#1a1024", P: "#8b5cf6", Y: "#ffe066", W: "#ffffff" },
  rows: [
    "................",
    "................",
    "K..............K",
    "KK....K..K....KK",
    "KPK...KKKK...KPK",
    "KPPK.KPPPPK.KPPK",
    "KPPPKPYPPYPKPPPK",
    "KPPPPPPPPPPPPPPK",
    ".KPPPPPWPWPPPPK.",
    "..KPK.KPPK.KPK..",
    "...K...KK...K...",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
};

/** ドット絵を SVG 文字列にする（同じ色の横並びはまとめて 1 本の rect にする） */
export function spriteSvg(sprite: Sprite, className = ""): string {
  const rects: string[] = [];
  sprite.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === c) w++;
      const color = sprite.palette[c];
      if (c !== "." && color) rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${color}"/>`);
      x += w;
    }
  });
  const size = sprite.rows.length;
  return `<svg class="${className}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true">${rects.join("")}</svg>`;
}
