// 도움말: controls for keyboard/mouse, touch and gamepad, plus key concepts.
// Dodge, skills, 일섬 and interact fire once per press (Input ignores key
// repeat; the sim rolls once per dodge press); attack repeats while held and
// the bow draws while held, shooting on release.
import { NATION_KEYS, NATION_NAMES } from "../../../shared/content/schema.ts";
import { ALL_BRANCHES } from "../chapters.ts";
import { h } from "../dom.ts";

const KEYS: readonly [string, string][] = [
  ["이동", "W A S D · 방향키"],
  ["공격", "J · Space · 왼쪽 클릭"],
  ["활", "K · 오른쪽 클릭 (누르고 있으면 당긴다)"],
  ["구르기", "Shift · L"],
  ["기술", "1 – 4 (누르고 있어도 한 번만 쓴다)"],
  ["노인성 일섬", "5 · R (천수 −1년, 장마다 3회)"],
  ["상호작용", "E · F"],
  ["채팅", "Enter"],
  ["인물 · 소지품", "C · I"],
  ["지도 · 국운 · 연대기", "M · N · T"],
  ["도움말 · 메뉴", "F1 또는 / · Esc"],
  ["음소거", "O"],
  ["선택지 고르기", "1 – 9 · 클릭"],
];

const TOUCH: readonly [string, string][] = [
  ["이동", "화면 왼쪽 아무 곳이나 눌러 끄는 가상 조이스틱"],
  ["공격 · 활", "오른쪽 큰 버튼을 누르고 있기"],
  ["구르기 · 상호작용", "오른쪽 원호의 버튼"],
  ["기술 · 일섬", "원호 바깥쪽의 작은 버튼"],
  ["메뉴", "소지도 아래 ≡ 버튼"],
];

const PAD: readonly [string, string][] = [
  ["이동", "왼쪽 스틱"],
  ["공격 · 활", "A · X"],
  ["구르기 · 상호작용", "B · Y"],
  ["기술 1 – 4", "어깨 버튼과 트리거 (LB · RB · LT · RT)"],
];

const CONCEPTS: readonly [string, string][] = [
  ["천수", "남은 수명. 대전 승리와 공덕으로 늘고, 일섬·자력 소생에 쓴다. 1910년까지 닿아야 한다."],
  ["의심도", "늙지 않는 얼굴이 부르는 의심. 높아지면 세월이 흐를 때 신분을 바꾸자."],
  ["풍향계", "선택지 옆의 숙청 위험(0–100). 지략이 낮으면 ±10 오차가 있다."],
  ["사경", "쓰러진 상태. 동료가 일으켜 세우거나, 천수 1년을 써서 스스로 일어난다."],
  // The particle follows 지표, not the data-built list, so any meter order reads right.
  ["국운 · 분기", `국운 지표(${NATION_KEYS.map((key) => NATION_NAMES[key]).join("·")})와 ${ALL_BRANCHES} 분기가 1910년의 결말을 정한다.`],
  ["◇ 표시", "시뮬레이션 동료. 오프라인에서 마당을 채우는 컴퓨터 동료다."],
];

const table = (rows: readonly [string, string][]) =>
  h("dl", { class: "key-table" }, ...rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]));

export function helpTab(): HTMLElement {
  return h(
    "div",
    { class: "tab-help" },
    h("section", null, h("h3", { class: "sub-title" }, "키보드 · 마우스"), table(KEYS)),
    h("section", null,
      h("h3", { class: "sub-title" }, "터치"), table(TOUCH),
      h("h3", { class: "sub-title" }, "게임패드"), table(PAD),
      h("h3", { class: "sub-title" }, "알아 둘 것"), table(CONCEPTS)),
  );
}
