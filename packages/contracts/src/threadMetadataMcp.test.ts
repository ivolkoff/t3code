import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ThreadMetadataMcpUpdateInput } from "./threadMetadataMcp.ts";

const decodeUpdate = Schema.decodeUnknownSync(ThreadMetadataMcpUpdateInput);

describe("ThreadMetadataMcpUpdateInput", () => {
  it("rejects malformed client request ids without normalizing valid keys", () => {
    const validKey = "metadata-\ud83d\ude80-1";
    assert.equal(
      decodeUpdate({ action: "regenerate_title", clientRequestId: validKey }).clientRequestId,
      validKey,
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\ud800" }),
    );
    assert.throws(() =>
      decodeUpdate({ action: "regenerate_title", clientRequestId: "metadata-\udc00" }),
    );
  });

  it("accepts a single-line working-on text or null only for set_working_on", () => {
    assert.equal(
      decodeUpdate({ action: "set_working_on", workingOn: "  Fix login #123 " }).workingOn,
      "Fix login #123",
    );
    assert.equal(decodeUpdate({ action: "set_working_on", workingOn: null }).workingOn, null);
    assert.equal(
      decodeUpdate({ action: "set_working_on", workingOn: "a".repeat(120) }).action,
      "set_working_on",
    );
    for (const input of [
      { action: "set_working_on" },
      { action: "set_working_on", title: "Title" },
      { action: "set_working_on", workingOn: "a".repeat(121) },
      { action: "set_working_on", workingOn: "a\nb" },
      { action: "set_working_on", workingOn: "a\tb" },
      { action: "rename", title: "Title", workingOn: "x" },
      { action: "regenerate_title", workingOn: null },
    ]) {
      assert.throws(() => decodeUpdate(input), undefined, undefined, JSON.stringify(input));
    }
  });
});
