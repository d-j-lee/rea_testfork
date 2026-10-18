// PLACEHOLDER — replaced by the content pass.
import type { NationEndingDef, PersonalEndingDef } from "./schema.ts";

const nation = (id: NationEndingDef["id"]): NationEndingDef => ({ id, title: id, body: [], music: "ending_good" });
const personal = (id: PersonalEndingDef["id"]): PersonalEndingDef => ({ id, title: id, body: [] });

export const NATION_ENDINGS = { N1: nation("N1"), N2: nation("N2"), N3: nation("N3") };
export const PERSONAL_ENDINGS = {
  P0: personal("P0"), P1: personal("P1"), P2: personal("P2"),
  P3: personal("P3"), P4: personal("P4"), P5: personal("P5"),
};
export const ENDING_HISTORY_NOTE: readonly string[] = [];
