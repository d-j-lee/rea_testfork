// When the lifespan ends (GDD §5.3.4) the school's disciple or a 한씨 heir
// takes over; the run continues and the personal ending becomes P4.
import type { ContentIndex } from "../content/index.ts";
import { STAT_KEYS } from "../content/schema.ts";
import type { PlayerSave } from "../types.ts";
import { startIdentity, suggestName } from "./identity.ts";
import { setRank } from "./progression.ts";
import { chronicle, line, type Line } from "./util.ts";

export const SUCCESSOR_LIFESPAN = 60;
export const SUCCESSOR_START_AGE = 25;

export function pastLifeEnd(save: PlayerSave): boolean {
  return save.year > save.lifeEnd;
}

/**
 * Stats 70% (rounded), level kept, rank 50% (floor), bonds 80%, money 70%,
 * suspicion 0, lifeEnd = year + 60, grace spent, generation + 1.
 */
export function successorTakeover(content: ContentIndex, save: PlayerSave): Line[] {
  void content;
  const generation = (save.successor?.generation ?? 0) + 1;
  const oldName = save.name;
  const name = suggestName(save, `successor:${generation}`);
  for (const stat of STAT_KEYS) save.stats[stat] = Math.max(1, Math.round(save.stats[stat] * 0.7));
  setRank(save, Math.floor(save.rank * 0.5));
  for (const [id, value] of Object.entries(save.bonds)) save.bonds[id] = Math.round(value * 0.8);
  save.points.money = Math.floor(save.points.money * 0.7);
  save.successor = { generation };
  save.suspicion = 0;
  save.graceUsed = true;
  save.lifeEnd = save.year + SUCCESSOR_LIFESPAN;
  startIdentity(save, "successor", name, SUCCESSOR_START_AGE);
  chronicle(save, `${oldName}의 천수가 다하다. ${name}이(가) 유지를 잇는다 (${generation}대).`, "epic");
  return [
    line(`천수가 다했다 — ${oldName}의 오백 년이 여기서 멈춘다`, "bad"),
    line(`${name}이(가) 유지를 잇는다 (${generation}대 · 능력치 70% · 품계 절반 · 인연 80% · 재산 70%)`, "epic"),
  ];
}
