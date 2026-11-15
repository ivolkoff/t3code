import type { ClientSettings } from "@t3tools/contracts";

const CHROME_PLATFORM_TOKENS = {
  macos: "Macintosh; Intel Mac OS X 10_15_7",
  windows: "Windows NT 10.0; Win64; x64",
  linux: "X11; Linux x86_64",
} as const;

type ChromePlatform = keyof typeof CHROME_PLATFORM_TOKENS;

export type PreviewUserAgentSettings = Pick<
  ClientSettings,
  "browserUserAgentPreset" | "browserUserAgent"
>;

export interface PreviewEngine {
  readonly chromeVersion: string;
  readonly platform: NodeJS.Platform;
}

const hostChromePlatform = (platform: NodeJS.Platform): ChromePlatform =>
  platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux";

// Chrome's reduced User-Agent: only the major version is real, the rest is frozen at 0.0.0.
const chromeUserAgent = (platform: ChromePlatform, major: string): string =>
  `Mozilla/5.0 (${CHROME_PLATFORM_TOKENS[platform]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;

/** "" means keep the native User-Agent. The engine version keeps the UA in step with the TLS fingerprint. */
export const resolvePreviewUserAgent = (
  settings: PreviewUserAgentSettings,
  engine: PreviewEngine,
): string => {
  const major = engine.chromeVersion.split(".")[0] ?? "";
  if (settings.browserUserAgentPreset === "custom") {
    const custom = settings.browserUserAgent.trim();
    if (custom.includes("{chrome}") && major === "") return "";
    return custom.replaceAll("{chrome}", major);
  }
  if (major === "") return "";
  switch (settings.browserUserAgentPreset) {
    case "native":
      return "";
    case "chrome":
      return chromeUserAgent(hostChromePlatform(engine.platform), major);
    case "chrome-macos":
      return chromeUserAgent("macos", major);
    case "chrome-windows":
      return chromeUserAgent("windows", major);
    case "chrome-linux":
      return chromeUserAgent("linux", major);
  }
};
