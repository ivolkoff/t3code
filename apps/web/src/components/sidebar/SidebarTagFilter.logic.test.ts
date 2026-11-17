import { describe, expect, it } from "vite-plus/test";

import {
  isSidebarTagFilterItem,
  nextSidebarTagFilter,
  sidebarTagFilterItems,
} from "./SidebarTagFilter.logic";

describe("sidebarTagFilterItems", () => {
  it("keeps an active tag no thread carries and never collides with project rows", () => {
    const items = sidebarTagFilterItems(["all", "Bug"], ["bug", "gone"]);
    expect(items.map((item) => item.tag)).toEqual(["all", "Bug", "gone"]);
    expect(items.every(isSidebarTagFilterItem)).toBe(true);
    expect(isSidebarTagFilterItem({ value: "all" })).toBe(false);
  });
});

describe("nextSidebarTagFilter", () => {
  it("narrows to one tag on a pick and toggles ignoring case on an additive pick", () => {
    expect(nextSidebarTagFilter(["a", "b"], "c", false)).toEqual(["c"]);
    expect(nextSidebarTagFilter(["a"], "b", true)).toEqual(["a", "b"]);
    expect(nextSidebarTagFilter(["A", "b"], "a", true)).toEqual(["b"]);
  });
});
