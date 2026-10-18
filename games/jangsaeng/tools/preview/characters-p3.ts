(globalThis as { PAGE?: number }).PAGE = 2;
await import("./characters.ts");
export {};
