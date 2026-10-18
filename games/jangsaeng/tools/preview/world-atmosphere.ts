// Time-of-day and weather overlays over the same views.
//   node scripts/preview.mjs tools/preview/world-atmosphere.ts out.png 1448 968 1500
import { renderSheet, type View } from "./world-lib.ts";

const base = { site: "jeonju", dy: 3, scale: 2, year: 1450 } as const;
const views: View[] = [
  { ...base, label: "새벽 05:30", season: "spring", atmosphere: { hour: 5.5, pixelScale: 2 } },
  { ...base, label: "한낮 12:00", season: "spring", atmosphere: { hour: 12, pixelScale: 2 } },
  { ...base, label: "해질녘 19:00", season: "autumn", atmosphere: { hour: 19, pixelScale: 2 } },
  { ...base, label: "밤 23:00", season: "summer", atmosphere: { hour: 23, pixelScale: 2 } },
  { ...base, label: "비", season: "summer", atmosphere: { hour: 14, weather: "rain", pixelScale: 2 } },
  { ...base, label: "눈", season: "winter", atmosphere: { hour: 10, weather: "snow", pixelScale: 2 } },
  { ...base, label: "안개", season: "autumn", atmosphere: { hour: 7, weather: "fog", pixelScale: 2 } },
  { label: "명량 전운", site: "myeongnyang", scale: 2, year: 1597, season: "autumn", atmosphere: { hour: 17, weather: "smoke", pixelScale: 2 } },
  { label: "남한산성 눈 밤", site: "namhansanseong", scale: 2, year: 1636, season: "winter", atmosphere: { hour: 21, weather: "snow", pixelScale: 2 } },
];

renderSheet(views, 3, 480, 320, { timeMs: 2400 });
