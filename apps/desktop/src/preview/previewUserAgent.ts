import type { ClientSettings } from "@t3tools/contracts";
import { PREVIEW_VIEWPORT_PRESETS } from "@t3tools/shared/previewViewport";

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
  readonly arch: string;
  /** The host OS version, as Chromium reports it in Sec-CH-UA-Platform-Version. */
  readonly systemVersion: string;
}

interface UserAgentBrand {
  readonly brand: string;
  readonly version: string;
}

/** CDP `Emulation.UserAgentMetadata`; what Sec-CH-UA* headers and navigator.userAgentData report. */
export interface PreviewUserAgentMetadata {
  readonly brands: ReadonlyArray<UserAgentBrand>;
  readonly fullVersionList: ReadonlyArray<UserAgentBrand>;
  readonly platform: string;
  readonly platformVersion: string;
  readonly architecture: string;
  readonly bitness: string;
  readonly model: string;
  readonly mobile: boolean;
  readonly wow64: boolean;
}

const hostChromePlatform = (platform: NodeJS.Platform): ChromePlatform =>
  platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux";

const CHROME_PLATFORM_NAMES = { macos: "macOS", windows: "Windows", linux: "Linux" } as const;
// Versions a real Chrome on that system reports when this host is a different system.
const FOREIGN_PLATFORM_VERSIONS = { macos: "15.0.0", windows: "10.0.0", linux: "" } as const;
// Chromium's GREASE brand for the current engine, as Electron already reports it.
const GREASE_BRAND = { brand: "Not?A_Brand", version: "24" } as const;

const chromeBrands = (major: string, fullVersion: string) => ({
  brands: [
    GREASE_BRAND,
    { brand: "Chromium", version: major },
    { brand: "Google Chrome", version: major },
  ],
  fullVersionList: [
    { brand: GREASE_BRAND.brand, version: `${GREASE_BRAND.version}.0.0.0` },
    { brand: "Chromium", version: fullVersion },
    { brand: "Google Chrome", version: fullVersion },
  ],
});

const presetChromePlatform = (
  preset: PreviewUserAgentSettings["browserUserAgentPreset"],
  host: NodeJS.Platform,
): ChromePlatform | null => {
  switch (preset) {
    case "chrome":
      return hostChromePlatform(host);
    case "chrome-macos":
      return "macos";
    case "chrome-windows":
      return "windows";
    case "chrome-linux":
      return "linux";
    case "native":
    case "custom":
      return null;
  }
};

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

/** Client Hints that match a Chrome preset; null for Built-in and Custom, whose browser is unknown. */
export const resolvePreviewUserAgentMetadata = (
  settings: PreviewUserAgentSettings,
  engine: PreviewEngine,
): PreviewUserAgentMetadata | null => {
  const platform = presetChromePlatform(settings.browserUserAgentPreset, engine.platform);
  const major = engine.chromeVersion.split(".")[0] ?? "";
  if (platform === null || major === "") return null;
  const native = platform === hostChromePlatform(engine.platform);
  const arm = native && engine.arch.startsWith("arm");
  return {
    ...chromeBrands(major, engine.chromeVersion),
    platform: CHROME_PLATFORM_NAMES[platform],
    platformVersion: native ? engine.systemVersion : FOREIGN_PLATFORM_VERSIONS[platform],
    architecture: arm ? "arm" : "x86",
    bitness: "64",
    model: "",
    mobile: false,
    wow64: false,
  };
};

/** The low-entropy Client Hints Chrome sends on every secure request. */
export const clientHintHeaders = (metadata: PreviewUserAgentMetadata): Record<string, string> => ({
  "sec-ch-ua": metadata.brands.map(({ brand, version }) => `"${brand}";v="${version}"`).join(", "),
  "sec-ch-ua-mobile": metadata.mobile ? "?1" : "?0",
  "sec-ch-ua-platform": `"${metadata.platform}"`,
});

export interface PreviewDeviceEmulation {
  readonly presetId: string;
  readonly userAgent: string;
  readonly metadata: PreviewUserAgentMetadata;
  readonly deviceScaleFactor: number;
  readonly mobile: boolean;
}

/** Null keeps the desktop identity: no preset, a legacy preset, or an engine without a version. */
export const resolvePreviewDeviceEmulation = (
  presetId: string | null,
  engine: PreviewEngine,
): PreviewDeviceEmulation | null => {
  const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === presetId);
  const major = engine.chromeVersion.split(".")[0] ?? "";
  if (!preset || major === "") return null;
  const { device } = preset;
  return {
    presetId: preset.id,
    userAgent: device.userAgent.replaceAll("{chrome}", major),
    metadata: {
      ...chromeBrands(major, engine.chromeVersion),
      platform: device.platform,
      platformVersion: device.platformVersion,
      architecture: device.mobile ? "" : "x86",
      bitness: device.mobile ? "" : "64",
      model: device.model,
      mobile: device.mobile,
      wow64: false,
    },
    deviceScaleFactor: device.deviceScaleFactor,
    mobile: device.mobile,
  };
};
