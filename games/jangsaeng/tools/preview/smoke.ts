import { compilePixels, context2d } from "../../src/client/render/pixel.ts";
const canvas = document.getElementById("preview") as HTMLCanvasElement;
canvas.width = 200;
canvas.height = 100;
const ctx = context2d(canvas);
ctx.fillStyle = "#6b9a4a";
ctx.fillRect(0, 0, 200, 100);
const s = compilePixels(["..rr..", ".rrrr.", "rryyrr", ".rrrr.", "..rr.."], {
  r: "#b8312f",
  y: "#e2b23a",
});
ctx.drawImage(s, 10, 10);
console.log("smoke ok");
