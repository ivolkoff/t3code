import { assert, describe, it } from "@effect/vitest";

import { resolvePreviewUserAgent } from "./previewUserAgent.ts";

const engine = { chromeVersion: "152.0.7977.169", platform: "darwin" as const };

describe("resolvePreviewUserAgent", () => {
  it("keeps the native User-Agent for the native preset", () => {
    assert.strictEqual(
      resolvePreviewUserAgent({ browserUserAgentPreset: "native", browserUserAgent: "x" }, engine),
      "",
    );
  });

  it("builds Chrome presets from the engine's major version", () => {
    assert.strictEqual(
      resolvePreviewUserAgent({ browserUserAgentPreset: "chrome", browserUserAgent: "" }, engine),
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
    assert.strictEqual(
      resolvePreviewUserAgent(
        { browserUserAgentPreset: "chrome", browserUserAgent: "" },
        { chromeVersion: "153.0.1.2", platform: "win32" },
      ),
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    );
    assert.include(
      resolvePreviewUserAgent(
        { browserUserAgentPreset: "chrome-linux", browserUserAgent: "" },
        engine,
      ),
      "(X11; Linux x86_64)",
    );
  });

  it("fills {chrome} in a custom User-Agent", () => {
    assert.strictEqual(
      resolvePreviewUserAgent(
        { browserUserAgentPreset: "custom", browserUserAgent: " Foo Chrome/{chrome}.0.0.0 " },
        engine,
      ),
      "Foo Chrome/152.0.0.0",
    );
    assert.strictEqual(
      resolvePreviewUserAgent(
        { browserUserAgentPreset: "custom", browserUserAgent: "Foo Chrome/{chrome}" },
        { chromeVersion: "", platform: "darwin" },
      ),
      "",
    );
  });
});
