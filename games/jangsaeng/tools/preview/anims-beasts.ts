(globalThis as { KEYS?: string[] }).KEYS = ["tiger", "wolf", "boar", "bear"];
(globalThis as { DIRS?: string[] }).DIRS = ["down", "up", "right"];
await import("./anims.ts");
export {};
