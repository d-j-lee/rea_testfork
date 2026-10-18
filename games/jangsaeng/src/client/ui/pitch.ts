// 게임 소개: concept, pillars, how the MMO works, prototype scope. Honest copy:
// no metrics, no claims beyond what the prototype and its roadmap state.
import { button, h } from "./dom.ts";
import { paperPanel } from "./panel.ts";

const PILLARS: readonly { glyph: string; title: string; text: string }[] = [
  {
    glyph: "壽",
    title: "500년 생존",
    text: "천수(수명)는 쓰고 버는 자원이다. 대첩과 공덕으로 늘리고, 위기에는 노인성 일섬과 자력 소생에 쓴다. 타고난 천수만으로는 1910년에 닿지 못한다.",
  },
  {
    glyph: "官",
    title: "정치와 신분",
    text: "품계와 파벌의 총애, 숙청 판정. 선택지마다 ‘풍향계’가 숙청 위험을 미리 보여 준다. 늙지 않는 얼굴은 의심을 부르고, 세월이 흐를 때 신분을 바꿔 살아남는다.",
  },
  {
    glyph: "戰",
    title: "역사 속 대첩",
    text: "황산, 행주, 명량, 남한산성, 정족산성. 실시간 액션 전투로 역사의 현장에 선다. 실존 인물의 결정적 행위는 플레이어가 대신하지 않는다.",
  },
  {
    glyph: "記",
    title: "함께 쓰는 실록",
    text: "같은 시대에 선 장생인끼리 한 마당에서 만나 함께 싸우고, 쓰러진 동료를 일으킨다. 선택은 저마다의 실록으로 남고, 결말은 1910년에 정산된다.",
  },
];

const IN_PROTOTYPE: readonly string[] = [
  "1361년부터 1910년까지 16개 장으로 이어지는 한 생애 (두 장은 짧은 몽타주)",
  "실시간 탑다운 전투 · 보스와 대전 · 사경(死境)과 소생",
  "선택지와 풍향계, 숙청 판정, 품계와 관직",
  "세월 흐르기(10년 단위 활동) · 신분 세탁 · 노인성 봉헌",
  "국운 5지표와 침투도 · 분기 B1–B12 · 국가 3 × 개인 6 결말 정산",
  "시대 마당 채팅 · 온라인 서버 / 오프라인 단일 파일",
  "시연 모드: 어느 장에서든 바로 시작",
];

const ROADMAP: readonly string[] = [
  "결사(길드)와 결사 프로젝트",
  "수성원(시대를 넘는 허브) · 장시(거래소)",
  "시즌 공동 실록과 랭킹",
  "협동 대전 매칭과 동행(파티) 관리",
  "계정 연동 · 외부 사학 감수 · 접근성 감수",
];

export function pitchPanel(handlers: { onBack(): void; onNew(): void; onDemo(): void }): HTMLElement {
  return paperPanel(
    {
      title: "장생(長生): 오백년",
      kicker: "게임 소개",
      glyph: "記",
      onClose: handlers.onBack,
      class: "pitch-panel",
      footer: h("div", { class: "foot-actions" },
        button("시연 모드", handlers.onDemo, { class: "btn" }),
        button("새로 시작", handlers.onNew, { class: "btn btn-primary" })),
    },
    h(
      "div",
      { class: "pitch" },
      h("p", { class: "pitch-lead" },
        "1361년 겨울, 홍건적에게 함락된 개경. 죽음 앞에 선 젊은 무사가 남쪽 하늘의 노인성(老人星) 빛을 받아 오백 년의 천수를 얻는다. 고려의 황혼에서 조선 개국을 지나 사화와 왜란과 호란을 건너, 늙지 않는 얼굴을 숨긴 채 1910년에 닿아야 한다."),
      h("p", { class: "pitch-genre" }, "탑다운 2D 픽셀 액션 RPG × 정치 생존 · 브라우저 하나로 데스크톱과 모바일에서"),
      h("ul", { class: "pillars" },
        ...PILLARS.map((p) =>
          h("li", { class: "pillar" },
            h("span", { class: "pillar-glyph", "aria-hidden": "true" }, p.glyph),
            h("strong", null, p.title),
            h("p", null, p.text)))),
      h("h3", { class: "sub-title" }, "MMO는 이렇게 움직인다"),
      h("dl", { class: "mmo-list" },
        h("dt", null, "시대 마당"),
        h("dd", null, "같은 시대(장)를 지나는 장생인끼리 한 채널에 모인다. 이야기의 진행과 선택은 각자 따로 기록된다."),
        h("dt", null, "온라인 서버"),
        h("dd", null, "서버가 전투와 판정을 계산하고, 접속한 플레이어가 한 마당에서 함께 싸운다."),
        h("dt", null, "오프라인 플레이"),
        h("dd", null, "다른 실제 플레이어는 없다. 시뮬레이션 동료가 마당을 채우며, 이름 앞의 ◇ 표시로 언제나 구분된다.")),
      h("div", { class: "scope" },
        h("div", { class: "scope-col" },
          h("h3", { class: "sub-title" }, "이 시제품에 있는 것"),
          h("ul", { class: "check-list" }, ...IN_PROTOTYPE.map((t) => h("li", null, t)))),
        h("div", { class: "scope-col roadmap" },
          h("h3", { class: "sub-title" }, "로드맵 (아직 없음)"),
          h("ul", { class: "plan-list" }, ...ROADMAP.map((t) => h("li", null, t))))),
      h("p", { class: "pitch-note" },
        "역사의 기둥(조선 개국, 이순신의 전사, 삼전도 등)은 바꾸지 않는다. 바꿀 수 있는 것은 19세기 분기점들의 누적뿐이다. 장마다 실제 역사 노트에서 사실과 해석, 창작을 구분한다. 시제품이므로 일부 장의 분량과 연출은 계속 다듬고 있다."),
    ),
  );
}
