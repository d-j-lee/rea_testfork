// 소지품: equipped weapon/armor and the item list with equip/use actions.
import type { PlayerAction } from "../../../shared/protocol.ts";
import type { ItemView, SelfView } from "../../../shared/types.ts";
import { button, h } from "../dom.ts";
import { ITEM_KIND_LABELS } from "../labels.ts";

const ORDER = ["weapon", "armor", "consumable", "treasure", "key"];

function itemRow(item: ItemView, act: (a: PlayerAction) => void): HTMLElement {
  const equipable = item.kind === "weapon" || item.kind === "armor";
  const usable = item.kind === "consumable";
  return h(
    "li",
    { class: `item-row kind-${item.kind}${item.equipped ? " equipped" : ""}` },
    h("span", { class: "item-glyph", "aria-hidden": "true" }, item.name.slice(0, 1)),
    h("span", { class: "item-text" },
      h("strong", null, item.name, item.count > 1 ? h("span", { class: "item-count" }, ` ×${item.count}`) : null),
      h("small", null, `${ITEM_KIND_LABELS[item.kind] ?? item.kind} · ${item.desc}`)),
    item.equipped
      ? h("span", { class: "tag tag-on" }, "착용 중")
      : equipable
        ? button("장착", () => act({ kind: "equip", item: item.id }), { class: "btn btn-small" })
        : usable
          ? button("사용", () => act({ kind: "use", item: item.id }), { class: "btn btn-small" })
          : null,
  );
}

export function inventoryTab(self: SelfView, act: (a: PlayerAction) => void): HTMLElement {
  const byId = new Map(self.inventory.map((i) => [i.id, i]));
  const weapon = byId.get(self.equipment.weapon);
  const armor = byId.get(self.equipment.armor);
  const items = [...self.inventory].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, "ko"));
  return h(
    "div",
    { class: "tab-inventory" },
    h("div", { class: "equip-slots" },
      h("div", { class: "equip-slot" }, h("span", { class: "equip-k" }, "무기"), h("strong", null, weapon?.name ?? "맨손")),
      h("div", { class: "equip-slot" }, h("span", { class: "equip-k" }, "갑주"), h("strong", null, armor?.name ?? "평복")),
      h("div", { class: "equip-slot" }, h("span", { class: "equip-k" }, "전"), h("strong", null, String(self.points.money)))),
    items.length
      ? h("ul", { class: "item-list" }, ...items.map((i) => itemRow(i, act)))
      : h("p", { class: "muted" }, "가진 것이 없다."),
  );
}
