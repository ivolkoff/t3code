import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { parseT3ProjectFile, T3ProjectFileFromJson } from "./t3ProjectFile.ts";

const decodeJson = Schema.decodeUnknownSync(T3ProjectFileFromJson);

describe("T3ProjectFileFromJson", () => {
  it("decodes lenient JSONC with comments and trailing commas", () => {
    const decoded = decodeJson(`{
      // team scripts
      "iconPath": "assets/logo.svg",
      "scripts": [
        { "name": "Dev", "command": "pnpm dev", "stopOnSettle": true, },
        { "name": "Ship", "command": "pnpm ship", "icon": "build", "iconName": "rocket" },
      ],
    }`);

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts).toEqual([
      { name: "Dev", command: "pnpm dev", stopOnSettle: true },
      { name: "Ship", command: "pnpm ship", icon: "build", iconName: "rocket" },
    ]);
  });
});

describe("parseT3ProjectFile", () => {
  it("reads project defaults from JSONC with a URL in a block comment", () => {
    expect(
      parseT3ProjectFile(`{
        /* See https://t3.codes/schema/t3.json */
        "defaultThreadEnvMode": "worktree"
      }`),
    ).toEqual({ defaultThreadEnvMode: "worktree" });
  });
});
