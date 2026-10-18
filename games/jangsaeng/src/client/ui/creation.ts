// New character: name, body variant with a live sprite preview, origin. One screen.
import { ORIGINS } from "../../shared/content/people.ts";
import { POINT_NAMES, STAT_NAMES, type OriginId, type PointKey, type StatKey } from "../../shared/content/schema.ts";
import type { AudioEngine } from "../audio/types.ts";
import { button, h } from "./dom.ts";
import { suggestName, validateName } from "./labels.ts";
import { paperPanel, segmented } from "./panel.ts";
import { spriteView } from "./portrait.ts";

export interface CreationResult {
  name: string;
  variant: "m" | "f";
  origin: OriginId;
}

const ORIGIN_ORDER: readonly OriginId[] = ["northeast", "kaesong", "southcoast"];
const ORIGIN_GLYPH: Readonly<Record<OriginId, string>> = { northeast: "北", kaesong: "京", southcoast: "海" };
const FACTION_NAMES: Readonly<Record<string, string>> = { yi: "이성계파", choe: "최영파" };

function bonusChips(id: OriginId): HTMLElement {
  const o = ORIGINS[id];
  const chips: HTMLElement[] = [];
  if (o) {
    for (const [k, v] of Object.entries(o.stats)) chips.push(h("span", { class: "chip chip-stat" }, `${STAT_NAMES[k as StatKey]} +${v}`));
    for (const [k, v] of Object.entries(o.points ?? {})) chips.push(h("span", { class: "chip chip-point" }, `${POINT_NAMES[k as PointKey]} +${v}`));
    for (const [k, v] of Object.entries(o.favor ?? {})) chips.push(h("span", { class: "chip chip-favor" }, `${FACTION_NAMES[k] ?? k} 총애 +${v}`));
  }
  return h("span", { class: "chips" }, ...chips);
}

export function creationPanel(
  audio: AudioEngine,
  handlers: { onBack(): void; onStart(result: CreationResult): void },
): HTMLElement {
  let variant: "m" | "f" = "m";
  let origin: OriginId = "northeast";
  const preview = spriteView("hero_youth", { variant, w: 28, h: 34, footY: 31, scale: 5, animate: true, class: "create-sprite" });
  const nameInput = h("input", {
    id: "create-name",
    class: "text-input",
    type: "text",
    maxlength: "12",
    autocomplete: "off",
    spellcheck: "false",
    value: suggestName(variant),
    "aria-describedby": "create-name-hint",
  });
  const hint = h("p", { id: "create-name-hint", class: "field-hint" }, "2–12자 · 한글·영문·숫자");
  const validate = () => {
    const err = validateName(nameInput.value);
    hint.textContent = err ?? "2–12자 · 한글·영문·숫자";
    hint.classList.toggle("bad", !!err);
    nameInput.setAttribute("aria-invalid", err ? "true" : "false");
    return err === null;
  };
  nameInput.addEventListener("input", validate);
  const reroll = button("다른 이름", () => {
    nameInput.value = suggestName(variant);
    validate();
    audio.sfx("ui_click");
  }, { class: "btn btn-small" });

  const variantSeg = segmented("외형", [{ value: "m", label: "남" }, { value: "f", label: "여" }] as const, variant, (v) => {
    variant = v;
    preview.set("hero_youth", v);
    audio.sfx("ui_click");
  }, "seg-variant");

  const originList = h("div", { class: "origin-list", role: "radiogroup", "aria-label": "출신" });
  const renderOrigins = () => {
    originList.replaceChildren(
      ...ORIGIN_ORDER.map((id) => {
        const o = ORIGINS[id];
        const on = id === origin;
        return h(
          "button",
          {
            type: "button",
            role: "radio",
            "aria-checked": on ? "true" : "false",
            class: `origin-card${on ? " on" : ""}`,
            onclick: () => {
              origin = id;
              renderOrigins();
              audio.sfx("ui_click");
            },
          },
          h("span", { class: "origin-glyph", "aria-hidden": "true" }, ORIGIN_GLYPH[id]),
          h("span", { class: "origin-text" },
            h("strong", null, o?.name ?? id),
            h("span", { class: "origin-desc" }, o?.desc ?? ""),
            bonusChips(id)),
        );
      }),
    );
  };
  renderOrigins();

  const start = button(h("span", null, "노인성 아래 깨어나기"), () => {
    if (!validate()) {
      audio.sfx("denied");
      nameInput.focus();
      return;
    }
    audio.sfx("choice");
    handlers.onStart({ name: nameInput.value.trim(), variant, origin });
  }, { class: "btn btn-primary btn-wide", "data-action": "create-start" });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") start.click();
  });

  return paperPanel(
    { title: "새 장생인", kicker: "1361년 겨울 · 개경", glyph: "生", onClose: handlers.onBack, class: "create-panel", footer: start },
    h(
      "div",
      { class: "create-grid" },
      h("div", { class: "create-stage" },
        h("div", { class: "stage-box" }, preview.canvas, h("span", { class: "stage-ground", "aria-hidden": "true" })),
        variantSeg),
      h(
        "div",
        { class: "create-form" },
        h("label", { class: "field-label", for: "create-name" }, "이름"),
        h("div", { class: "field-row" }, nameInput, reroll),
        hint,
        h("p", { class: "field-label" }, "출신"),
        originList,
        h("p", { class: "create-note" }, "홍건적이 개경을 함락한 밤, 죽음 직전의 젊은이가 노인성의 빛을 받는다. 오백 년의 천수는 그렇게 시작된다."),
      ),
    ),
  );
}
