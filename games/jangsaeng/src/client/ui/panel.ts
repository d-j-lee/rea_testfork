// Hanji paper panel used by title sub-screens, menus and the ending.
import { button, h, type Child } from "./dom.ts";

export interface PanelOptions {
  title: string;
  /** Small caption above the title (e.g. "시연 모드"). */
  kicker?: string;
  /** Hanja watermark drawn faintly in the header corner. */
  glyph?: string;
  onClose?: () => void;
  closeLabel?: string;
  class?: string;
  footer?: Child;
}

export function paperPanel(opts: PanelOptions, ...body: Child[]): HTMLElement {
  const close = opts.onClose
    ? button(h("span", { "aria-hidden": "true" }, "←"), () => opts.onClose?.(), {
        class: "btn btn-icon panel-back",
        "aria-label": opts.closeLabel ?? "돌아가기",
        title: opts.closeLabel ?? "돌아가기",
      })
    : null;
  return h(
    "section",
    { class: `panel paper ${opts.class ?? ""}`, role: "dialog", "aria-modal": "true", "aria-label": opts.title },
    h(
      "header",
      { class: "panel-head" },
      close,
      h("div", { class: "panel-titles" },
        opts.kicker ? h("p", { class: "panel-kicker" }, opts.kicker) : null,
        h("h2", { class: "panel-title" }, opts.title)),
      opts.glyph ? h("span", { class: "panel-glyph", "aria-hidden": "true" }, opts.glyph) : null,
    ),
    h("div", { class: "panel-body" }, ...body),
    opts.footer ? h("footer", { class: "panel-foot" }, opts.footer) : null,
  );
}

/**
 * Vertical text as one fixed 1em block per glyph. Unlike writing-mode, this
 * does not depend on the font's vertical metrics, so a seal or the logo keeps
 * its shape when the web fonts are unavailable and a system font stands in.
 */
export function stackedGlyphs(text: string): HTMLElement[] {
  return [...text].map((ch) => h("span", { class: "glyph-stack" }, ch));
}

/** Red square seal (낙관) with one to four hanja; `stacked` reads top to bottom. */
export function seal(text: string, cls = "", stacked = false): HTMLElement {
  return h(
    "span",
    { class: `seal ${cls}${stacked ? " seal-stacked" : ""}`, "aria-hidden": "true" },
    ...(stacked ? stackedGlyphs(text) : [text]),
  );
}

/** Segmented control (radio group) returning its element. */
export function segmented<T extends string>(
  label: string,
  options: readonly { value: T; label: string; disabled?: boolean; title?: string }[],
  value: T,
  onChange: (value: T) => void,
  cls = "",
): HTMLElement {
  const group = h("div", { class: `seg ${cls}`, role: "radiogroup", "aria-label": label });
  const render = (current: T) => {
    group.replaceChildren(
      ...options.map((o) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            class: `seg-opt${o.value === current ? " on" : ""}`,
            "aria-checked": o.value === current ? "true" : "false",
            disabled: o.disabled ?? false,
            title: o.title,
            onclick: () => {
              if (o.disabled || o.value === current) return;
              render(o.value);
              onChange(o.value);
            },
          },
          o.label,
        ),
      ),
    );
  };
  render(value);
  return group;
}
