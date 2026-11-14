import { expect, it } from "vite-plus/test";

import { deleteThreadTagStyle, renameThreadTagStyle, type ThreadTagStyle } from "./threadTags.ts";

const styles: ReadonlyArray<ThreadTagStyle> = [
  { tag: "critical", color: "red" },
  { tag: "bug", color: "orange" },
  { tag: "defect", color: "blue" },
];

it.each([
  {
    name: "a rename keeps the entry's place and color",
    tag: "Critical",
    to: "urgent",
    expected: [
      { tag: "urgent", color: "red" },
      { tag: "bug", color: "orange" },
      { tag: "defect", color: "blue" },
    ],
  },
  {
    name: "a case-only rename takes the new spelling",
    tag: "bug",
    to: "Bug",
    expected: [
      { tag: "critical", color: "red" },
      { tag: "Bug", color: "orange" },
      { tag: "defect", color: "blue" },
    ],
  },
  {
    name: "a merge keeps the target's entry",
    tag: "bug",
    to: "Defect",
    expected: [
      { tag: "critical", color: "red" },
      { tag: "defect", color: "blue" },
    ],
  },
])("$name", ({ tag, to, expected }) => {
  expect(renameThreadTagStyle(styles, tag, to)).toEqual(expected);
});

it("leaves styles alone when the tag has none", () => {
  expect(renameThreadTagStyle(styles, "other", "new")).toBe(styles);
  expect(deleteThreadTagStyle(styles, "other")).toBe(styles);
});

it("deleting a tag drops its entry ignoring case", () => {
  expect(deleteThreadTagStyle(styles, "BUG")).toEqual([
    { tag: "critical", color: "red" },
    { tag: "defect", color: "blue" },
  ]);
});
