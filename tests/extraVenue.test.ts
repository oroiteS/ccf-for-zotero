import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatVenueExtraValue,
  stripVenueLinesFromExtra,
  upsertVenueLineInExtra,
} from "../src/modules/extraVenue";
import { matchCandidates } from "../src/modules/matcher";
import { resolveVenueCandidates } from "../src/modules/venueResolver";

function makeItem(fields: Record<string, string>, itemType = "preprint"): any {
  let extra = fields.extra ?? "";
  return {
    libraryID: 1,
    id: 1,
    itemType,
    isRegularItem: () => true,
    getField: (field: string) => (field === "extra" ? extra : fields[field] ?? ""),
    setField: (field: string, value: string) => {
      if (field === "extra") extra = value;
    },
    saveTx: async () => {},
  };
}

describe("CCF Venue extra persistence", () => {
  it("appends the venue line to an empty or existing extra", () => {
    assert.equal(upsertVenueLineInExtra("", "ICLR"), "CCF Venue: ICLR");
    assert.equal(
      upsertVenueLineInExtra("arXiv:2602.12116 [cs.CL]", "ICLR"),
      "arXiv:2602.12116 [cs.CL]\nCCF Venue: ICLR",
    );
  });

  it("replaces the previous CCF Venue line instead of appending duplicates", () => {
    const extra = "arXiv:2602.12116 [cs.CL]\nCCF Venue: NeurIPS";
    assert.equal(
      upsertVenueLineInExtra(extra, "ICLR"),
      "arXiv:2602.12116 [cs.CL]\nCCF Venue: ICLR",
    );
    const twice = upsertVenueLineInExtra(
      upsertVenueLineInExtra(extra, "ICLR"),
      "ICLR",
    );
    assert.equal(
      (twice.match(/CCF Venue:/g) || []).length,
      1,
      "upsert must stay idempotent",
    );
  });

  it("prefers the venue abbreviation for the extra value", () => {
    assert.equal(
      formatVenueExtraValue({
        kind: "conference",
        abbr: "ICLR",
        fullName: "International Conference on Learning Representations",
        rank: "A",
        category: "人工智能",
      } as any),
      "ICLR",
    );
  });

  it("strips CCF Venue lines when restoring automatic matching", () => {
    assert.equal(
      stripVenueLinesFromExtra("foo\nCCF Venue: ICLR\nbar"),
      "foo\nbar",
    );
  });

  it("resolves the persisted line back to the same venue after cache loss", () => {
    const item = makeItem({
      extra: "arXiv:2602.12116 [cs.CL]\nCCF Venue: ICLR",
      DOI: "10.48550/arXiv.2602.12116",
    });
    const resolution = resolveVenueCandidates(item);
    const result = matchCandidates(
      resolution.candidates,
      resolution.isPreprint,
    );
    assert.equal(result.status, "matched");
    assert.equal(result.rank, "A");
    assert.equal(result.abbr, "ICLR");
  });
});
