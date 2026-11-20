import { assert, describe, it } from "@effect/vitest";

import {
  resolvePreviewDeviceEmulation,
  resolvePreviewUserAgent,
  resolvePreviewUserAgentMetadata,
} from "./previewUserAgent.ts";

const engine = {
  chromeVersion: "152.0.7977.169",
  platform: "darwin" as const,
  arch: "arm64",
  systemVersion: "27.2.1",
};

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
        { ...engine, chromeVersion: "153.0.1.2", platform: "win32" },
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
        { ...engine, chromeVersion: "" },
      ),
      "",
    );
  });

  it("reports Chrome Client Hints for Chrome presets only", () => {
    const host = resolvePreviewUserAgentMetadata(
      { browserUserAgentPreset: "chrome", browserUserAgent: "" },
      engine,
    );
    assert.deepStrictEqual(host?.brands, [
      { brand: "Not?A_Brand", version: "24" },
      { brand: "Chromium", version: "152" },
      { brand: "Google Chrome", version: "152" },
    ]);
    assert.deepStrictEqual(host?.fullVersionList[2], {
      brand: "Google Chrome",
      version: "152.0.7977.169",
    });
    assert.include(host, { platform: "macOS", platformVersion: "27.2.1", architecture: "arm" });

    const windows = resolvePreviewUserAgentMetadata(
      { browserUserAgentPreset: "chrome-windows", browserUserAgent: "" },
      engine,
    );
    assert.include(windows, {
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
    });

    for (const browserUserAgentPreset of ["native", "custom"] as const) {
      assert.isNull(
        resolvePreviewUserAgentMetadata({ browserUserAgentPreset, browserUserAgent: "x" }, engine),
      );
    }
  });
});

describe("resolvePreviewDeviceEmulation", () => {
  it("maps a phone preset to its mobile identity and pixel ratio", () => {
    const iphone = resolvePreviewDeviceEmulation("iphone-14-pro-max", engine)!;
    assert.include(iphone.userAgent, "(iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    assert.strictEqual(iphone.deviceScaleFactor, 3);
    assert.isTrue(iphone.mobile);
    assert.include(iphone.metadata, { platform: "iOS", mobile: true });

    const pixel = resolvePreviewDeviceEmulation("pixel-7", engine)!;
    assert.strictEqual(
      pixel.userAgent,
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36",
    );
    assert.strictEqual(pixel.deviceScaleFactor, 2.625);
    assert.include(pixel.metadata, { platform: "Android", model: "Pixel 7", mobile: true });
  });

  it("keeps touch laptops on a desktop layout", () => {
    const surface = resolvePreviewDeviceEmulation("surface-pro-7", engine)!;
    assert.isFalse(surface.mobile);
    assert.include(surface.metadata, { platform: "Windows", mobile: false });
  });

  it("keeps the desktop identity without a known preset", () => {
    assert.isNull(resolvePreviewDeviceEmulation(null, engine));
    assert.isNull(resolvePreviewDeviceEmulation("iphone-15-pro", engine));
    assert.isNull(resolvePreviewDeviceEmulation("pixel-7", { ...engine, chromeVersion: "" }));
  });
});
