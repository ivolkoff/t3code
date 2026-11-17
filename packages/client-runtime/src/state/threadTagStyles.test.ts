import { THREAD_TAG_COLORS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveThreadTagStyles,
  sortThreadTags,
  swapThreadTagStyles,
  THREAD_TAG_PALETTE,
  threadTagColor,
  withPresetThreadTags,
} from "./threadTagStyles.ts";

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].toSorted((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

describe("THREAD_TAG_PALETTE", () => {
  it.each(
    THREAD_TAG_COLORS.flatMap((color) =>
      (["light", "dark"] as const).map((theme) => ({ color, theme })),
    ),
  )("$color text meets WCAG AA in the $theme theme", ({ color, theme }) => {
    const pair = THREAD_TAG_PALETTE[color][theme];
    expect(pair.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(pair.foreground).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(pair.background, pair.foreground)).toBeGreaterThanOrEqual(4.5);
  });

  it("checks the ratio against WCAG's reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("sortThreadTags", () => {
  it("puts presets first, then the rest alphabetically ignoring case", () => {
    expect(
      sortThreadTags(["zeta", "Private", "Alpha", "beta", "critical", "background"], []),
    ).toEqual(["critical", "background", "Private", "Alpha", "beta", "zeta"]);
  });

  it("follows the stored order, then presets it leaves out, then unknown tags", () => {
    const styles = [
      { tag: "beta", color: "blue" },
      { tag: "Private", color: "violet" },
      { tag: "critical", color: "red" },
    ] as const;
    expect(
      sortThreadTags(["zeta", "critical", "background", "private", "Alpha", "BETA"], styles),
    ).toEqual(["BETA", "private", "critical", "background", "Alpha", "zeta"]);
  });
});

it("colors stored tags, then preset defaults, then gray", () => {
  const styles = [{ tag: "Bug", color: "orange" }] as const;
  expect(threadTagColor("bug", styles)).toBe("orange");
  expect(threadTagColor("Critical", styles)).toBe("red");
  expect(threadTagColor("private", [])).toBe("violet");
  expect(threadTagColor("other", styles)).toBe("gray");
});

it("resolves the full ordered list a Settings edit writes, presets included", () => {
  const resolved = resolveThreadTagStyles(withPresetThreadTags(["bug", "CRITICAL"]), [
    { tag: "bug", color: "orange" },
  ]);
  expect(resolved).toEqual([
    { tag: "bug", color: "orange" },
    { tag: "CRITICAL", color: "red" },
    { tag: "background", color: "gray" },
    { tag: "private", color: "violet" },
  ]);
  expect(swapThreadTagStyles(resolved, 1, 0).map((style) => style.tag)).toEqual([
    "CRITICAL",
    "bug",
    "background",
    "private",
  ]);
  expect(swapThreadTagStyles(resolved, 0, -1)).toBe(resolved);
});
