// Contact sheet of representative world views plus the full minimap.
//   node scripts/preview.mjs tools/preview/world.ts out.png 1808 968 1500
import { drawMinimapMarker, minimapPoint, renderMinimap } from "../../src/client/render/minimap.ts";
import { label, viewCentre, worldMap, renderSheet, type View } from "./world-lib.ts";

const views: View[] = [
  { label: "한양", site: "hanyang", dy: -2, scale: 2, season: "summer", year: 1450, figures: true },
  { label: "한양 (궁궐 터)", site: "hanyang", dy: -3, scale: 2, season: "autumn", year: 1700 },
  { label: "동래·부산", site: "dongnae", dx: 3, dy: 1, scale: 2, season: "summer", year: 1592 },
  { label: "강화", site: "ganghwa", dx: -3, scale: 2, season: "spring", year: 1627 },
  { label: "함흥·개마고원", site: "hamheung", dx: -6, dy: -4, scale: 2, season: "winter", year: 1400 },
  { label: "제주", site: "jeju", dy: 1, scale: 2, season: "summer", year: 1450 },
  { label: "명량", site: "myeongnyang", scale: 2, season: "autumn", year: 1597 },
  { label: "남한산성", site: "namhansanseong", scale: 2, season: "winter", year: 1636 },
  { label: "전주 들녘", site: "jeonju", dx: -6, dy: 6, scale: 2, season: "autumn", year: 1450 },
];

const map = worldMap();
const scale = 3;
renderSheet(views, 3, 480, 320, {
  side: {
    width: map.width * scale,
    draw(ctx, x, y, height) {
      const minimap = renderMinimap(map, 1450, scale);
      const top = y + Math.max(0, Math.floor((height - minimap.height) / 2));
      ctx.drawImage(minimap, x, top);
      ctx.save();
      ctx.translate(x, top);
      const hanyang = viewCentre(map, { label: "", site: "hanyang", scale: 1, season: "summer", year: 1450 });
      const p = minimapPoint(hanyang.x, hanyang.y, scale);
      drawMinimapMarker(ctx, p.x, p.y + 12, "self", { timeMs: 600, facing: -Math.PI / 2 });
      const jeonju = viewCentre(map, { label: "", site: "jeonju", scale: 1, season: "summer", year: 1450 });
      const q = minimapPoint(jeonju.x, jeonju.y, scale);
      drawMinimapMarker(ctx, q.x + 10, q.y, "quest", { timeMs: 600 });
      ctx.restore();
      label(ctx, "소지도 · 1450 · ×3", x + 6, y + 6);
    },
  },
});
