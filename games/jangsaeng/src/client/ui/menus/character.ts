// 인물: portrait, rank and office, stats with help and point allocation,
// skill slots, points, titles, identities timeline and bonds.
import { POINT_KEYS, POINT_NAMES, STAT_HELP, STAT_KEYS, STAT_NAMES } from "../../../shared/content/schema.ts";
import type { SelfView } from "../../../shared/types.ts";
import type { PlayerAction } from "../../../shared/protocol.ts";
import { button, h, meter, ratio, setMeter } from "../dom.ts";
import { identityKindName } from "../../../shared/rules/index.ts";
import { meritLabel, SKILL_GLYPH } from "../labels.ts";
import { seal } from "../panel.ts";
import { spriteView } from "../portrait.ts";

export function identityTimeline(list: SelfView["identities"], current?: string): HTMLElement {
  return h(
    "ol",
    { class: "id-line" },
    ...list.map((r) =>
      h("li", { class: `id-item${r.name === current && r.to === undefined ? " now" : ""}` },
        h("span", { class: "id-years" }, `${r.from}–${r.to ?? "현재"}`),
        h("strong", null, r.name),
        h("span", { class: "id-kind" }, identityKindName(r.kind)))),
  );
}

export function characterTab(self: SelfView, act: (a: PlayerAction) => void): HTMLElement {
  const sprite = spriteView(self.sprite, { variant: self.variant, w: 28, h: 34, footY: 31, scale: 4, animate: true, class: "ch-sprite" });
  const stats = h(
    "ul",
    { class: "stat-list" },
    ...STAT_KEYS.map((k) =>
      h("li", { class: "stat" },
        h("span", { class: "stat-name" }, STAT_NAMES[k]),
        h("b", { class: "stat-val" }, String(self.stats[k])),
        h("span", { class: "stat-help" }, STAT_HELP[k]),
        self.freePoints > 0
          ? button("+", () => act({ kind: "allocate", stat: k }), { class: "btn btn-icon stat-plus", "aria-label": `${STAT_NAMES[k]} 올리기` })
          : null)),
  );
  const slotted = [...self.skills].filter((sk) => sk.kind !== "longevity");
  const skills = h(
    "ul",
    { class: "skill-list" },
    ...slotted.map((sk) =>
      h("li", { class: "skill-row" },
        h("span", { class: "sk-glyph mini", "aria-hidden": "true" }, SKILL_GLYPH[sk.kind] ?? sk.name.slice(0, 1)),
        h("span", { class: "skill-text" },
          h("strong", null, sk.name),
          h("small", null, `${sk.desc} · 기력 ${sk.energy} · ${sk.cooldown}초`)),
        h("span", { class: "slot-pick", role: "group", "aria-label": `${sk.name} 칸` },
          ...[1, 2, 3, 4].map((n) =>
            button(String(n), () => act({ kind: "slot", skill: sk.id, slot: n }), {
              class: `slot-btn${sk.slot === n ? " on" : ""}`,
              "aria-pressed": sk.slot === n ? "true" : "false",
              "aria-label": `${n}번 칸에 놓기`,
            }))))),
  );
  const bonds = self.bonds.length
    ? h("ul", { class: "bond-list" },
        ...self.bonds.map((b) => {
          const m = meter("meter-bond");
          setMeter(m, ratio(b.value, 100));
          return h("li", null, h("span", null, b.name), m.root, h("b", null, String(b.value)));
        }))
    : h("p", { class: "muted" }, "아직 깊은 인연이 없다.");
  return h(
    "div",
    { class: "tab-character" },
    h("div", { class: "ch-card" },
      h("div", { class: "ch-stage" }, sprite.canvas),
      h("div", { class: "ch-id" },
        h("h3", { class: "ch-name" }, self.name),
        self.name !== self.birthName ? h("p", { class: "muted" }, `본명 ${self.birthName}`) : null,
        h("p", null, `Lv ${self.level} · ${identityKindName(self.identityKind)}`),
        h("p", null, `${self.rankName}${self.office ? ` · ${self.office}` : ""}`),
        self.meritSubject ? h("p", { class: "merit" }, seal("功", "seal-small"), meritLabel(self.meritSubject)) : null,
        self.titles.length ? h("p", { class: "chips" }, ...self.titles.map((t) => h("span", { class: "chip" }, t))) : null),
      h("ul", { class: "points" },
        ...POINT_KEYS.map((k) => h("li", null, h("span", null, POINT_NAMES[k]), h("b", null, String(self.points[k])))))),
    h("div", { class: "ch-cols" },
      h("section", null,
        h("h3", { class: "sub-title" }, "능력치", self.freePoints > 0 ? h("span", { class: "free-pts" }, `남은 점수 ${self.freePoints}`) : null),
        stats,
        h("h3", { class: "sub-title" }, "무예 · 기술 칸"),
        slotted.length ? skills : h("p", { class: "muted" }, "익힌 기술이 없다.")),
      h("section", null,
        h("h3", { class: "sub-title" }, "신분 연표"),
        identityTimeline(self.identities, self.name),
        h("h3", { class: "sub-title" }, "인연"),
        bonds)),
  );
}
