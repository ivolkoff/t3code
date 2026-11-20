import type {
  PreviewAutomationResizeInput,
  PreviewViewportPresetId,
  PreviewViewportSetting,
} from "@t3tools/contracts";
import { PREVIEW_VIEWPORT_PRESET_IDS } from "@t3tools/contracts";

export interface PreviewViewportPreset {
  readonly id: PreviewViewportPresetId;
  readonly label: string;
  readonly category: "Desktop" | "Tablet" | "Phone";
  readonly detail: string;
  readonly width: number;
  readonly height: number;
  readonly device: PreviewDeviceProfile;
}

/** What a preset reports besides its size; `{chrome}` in the User-Agent is the engine's major version. */
export interface PreviewDeviceProfile {
  readonly userAgent: string;
  readonly platform: "iOS" | "Android" | "Windows";
  readonly platformVersion: string;
  readonly model: string;
  readonly mobile: boolean;
  readonly deviceScaleFactor: number;
}

const iphone = (deviceScaleFactor: number): PreviewDeviceProfile => ({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  platform: "iOS",
  platformVersion: "17.0",
  model: "",
  mobile: true,
  deviceScaleFactor,
});

const ipad = (deviceScaleFactor: number): PreviewDeviceProfile => ({
  userAgent:
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  platform: "iOS",
  platformVersion: "17.0",
  model: "",
  mobile: true,
  deviceScaleFactor,
});

const android = (model: string, deviceScaleFactor: number): PreviewDeviceProfile => ({
  userAgent: `Mozilla/5.0 (Linux; Android 14; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome}.0.0.0 Mobile Safari/537.36`,
  platform: "Android",
  platformVersion: "14.0.0",
  model,
  mobile: true,
  deviceScaleFactor,
});

// Touch laptops run desktop Chrome, so sites must not get a mobile layout.
const windowsTouch = (deviceScaleFactor: number): PreviewDeviceProfile => ({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome}.0.0.0 Safari/537.36",
  platform: "Windows",
  platformVersion: "15.0.0",
  model: "",
  mobile: false,
  deviceScaleFactor,
});

const nestHub: PreviewDeviceProfile = {
  userAgent:
    "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome}.0.0.0 Safari/537.36 CrKey/1.54.248666",
  platform: "Android",
  platformVersion: "",
  model: "",
  mobile: true,
  deviceScaleFactor: 1,
};

type PreviewViewportPresetDefinition = Omit<PreviewViewportPreset, "id">;

// Chromium EmulatedDevices.ts CSS viewport sizes in Chrome DevTools default-device order.
const PREVIEW_VIEWPORT_PRESET_DEFINITIONS = {
  "iphone-se": {
    label: "iPhone SE",
    category: "Phone",
    detail: "375 × 667",
    width: 375,
    height: 667,
    device: iphone(2),
  },
  "iphone-xr": {
    label: "iPhone XR",
    category: "Phone",
    detail: "414 × 896",
    width: 414,
    height: 896,
    device: iphone(2),
  },
  "iphone-12-pro": {
    label: "iPhone 12 Pro",
    category: "Phone",
    detail: "390 × 844",
    width: 390,
    height: 844,
    device: iphone(3),
  },
  "iphone-14-pro-max": {
    label: "iPhone 14 Pro Max",
    category: "Phone",
    detail: "430 × 932",
    width: 430,
    height: 932,
    device: iphone(3),
  },
  "pixel-7": {
    label: "Pixel 7",
    category: "Phone",
    detail: "412 × 915",
    width: 412,
    height: 915,
    device: android("Pixel 7", 2.625),
  },
  "samsung-galaxy-s8-plus": {
    label: "Samsung Galaxy S8+",
    category: "Phone",
    detail: "360 × 740",
    width: 360,
    height: 740,
    device: android("SM-G955U", 4),
  },
  "samsung-galaxy-s20-ultra": {
    label: "Samsung Galaxy S20 Ultra",
    category: "Phone",
    detail: "412 × 915",
    width: 412,
    height: 915,
    device: android("SM-G988B", 3.5),
  },
  "ipad-mini": {
    label: "iPad Mini",
    category: "Tablet",
    detail: "768 × 1024",
    width: 768,
    height: 1024,
    device: ipad(2),
  },
  "ipad-air": {
    label: "iPad Air",
    category: "Tablet",
    detail: "820 × 1180",
    width: 820,
    height: 1180,
    device: ipad(2),
  },
  "ipad-pro": {
    label: "iPad Pro",
    category: "Tablet",
    detail: "1024 × 1366",
    width: 1024,
    height: 1366,
    device: ipad(2),
  },
  "surface-pro-7": {
    label: "Surface Pro 7",
    category: "Tablet",
    detail: "912 × 1368",
    width: 912,
    height: 1368,
    device: windowsTouch(2),
  },
  "surface-duo": {
    label: "Surface Duo",
    category: "Phone",
    detail: "540 × 720",
    width: 540,
    height: 720,
    device: android("Surface Duo", 2.5),
  },
  "galaxy-z-fold-5": {
    label: "Galaxy Z Fold 5",
    category: "Phone",
    detail: "344 × 882",
    width: 344,
    height: 882,
    device: android("SM-F946B", 2.625),
  },
  "asus-zenbook-fold": {
    label: "Asus Zenbook Fold",
    category: "Tablet",
    detail: "853 × 1280",
    width: 853,
    height: 1280,
    device: windowsTouch(1.5),
  },
  "samsung-galaxy-a51-71": {
    label: "Samsung Galaxy A51/71",
    category: "Phone",
    detail: "412 × 914",
    width: 412,
    height: 914,
    device: android("SM-A515F", 2.625),
  },
  "nest-hub": {
    label: "Nest Hub",
    category: "Tablet",
    detail: "1024 × 600",
    width: 1024,
    height: 600,
    device: nestHub,
  },
  "nest-hub-max": {
    label: "Nest Hub Max",
    category: "Tablet",
    detail: "1280 × 800",
    width: 1280,
    height: 800,
    device: nestHub,
  },
} as const satisfies Record<PreviewViewportPresetId, PreviewViewportPresetDefinition>;

export const PREVIEW_VIEWPORT_PRESETS: ReadonlyArray<PreviewViewportPreset> =
  PREVIEW_VIEWPORT_PRESET_IDS.map((id) => ({
    id,
    ...PREVIEW_VIEWPORT_PRESET_DEFINITIONS[id],
  }));

export function resolvePreviewViewport(
  input: PreviewAutomationResizeInput,
): PreviewViewportSetting {
  if (input.mode === "fill") return { _tag: "fill" };
  if (input.mode === "preset" && input.preset !== undefined) {
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === input.preset);
    if (!preset) throw new Error(`Unknown preview viewport preset: ${input.preset}`);
    const landscape = input.orientation === "landscape";
    const portrait = input.orientation === "portrait";
    const nativePortrait = preset.height >= preset.width;
    const shouldSwap = (landscape && nativePortrait) || (portrait && !nativePortrait);
    return {
      _tag: "preset",
      width: shouldSwap ? preset.height : preset.width,
      height: shouldSwap ? preset.width : preset.height,
      presetId: preset.id,
      ...(input.emulate === false ? { emulate: false } : {}),
    };
  }
  if (input.width === undefined || input.height === undefined) {
    throw new Error("Custom preview viewport requires width and height");
  }
  return {
    _tag: "freeform",
    width: input.width,
    height: input.height,
  };
}
