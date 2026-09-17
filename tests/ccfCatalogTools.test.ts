import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-ignore
import { buildCcfCatalog, parseVenueRow } from "../tools/build-ccf-catalog.mjs";

describe("CCF catalog build tools", () => {
  it("parses CSV rows with Chinese headers", () => {
    const row = {
      类型: "会议",
      简称: "NeurIPS",
      全称: "Conference on Neural Information Processing Systems",
      推荐等级: "A类",
      学科领域: "人工智能",
      别名: "NIPS; Advances in Neural Information Processing Systems",
    };

    const venue = parseVenueRow(row);
    assert.equal(venue?.kind, "conference");
    assert.equal(venue?.abbr, "NeurIPS");
    assert.equal(venue?.fullName, "Conference on Neural Information Processing Systems");
    assert.equal(venue?.rank, "A");
    assert.equal(venue?.category, "人工智能");
    assert.ok(venue?.aliases.includes("NeurIPS"));
    assert.ok(venue?.aliases.includes("NIPS"));
    assert.ok(venue?.aliases.includes("Advances in Neural Information Processing Systems"));
  });

  it("builds a catalog from CSV content", () => {
    const csvContent = [
      "kind,abbr,fullName,rank,category,aliases",
      "conference,NeurIPS,Conference on Neural Information Processing Systems,A,人工智能,NIPS",
      "journal,TOIS,ACM Transactions on Information Systems,A,数据库,",
    ].join("\n");

    const catalog = buildCcfCatalog(csvContent, "csv", null, { version: "TEST-v1" });
    assert.equal(catalog.version, "TEST-v1");
    assert.equal(catalog.venues.length, 2);
    assert.equal(catalog.venues[0].abbr, "NeurIPS");
    assert.equal(catalog.venues[1].abbr, "TOIS");
  });

  it("supports merging new venues into existing catalog", () => {
    const existing = {
      version: "ORIGINAL-v1",
      updateDate: "2026-01-01",
      source: "existing",
      venues: [
        {
          kind: "conference",
          abbr: "CVPR",
          fullName: "IEEE/CVF Conference on Computer Vision and Pattern Recognition",
          rank: "A",
          category: "人工智能",
          aliases: ["CVPR"],
        },
      ],
    };

    const csvContent = [
      "类型,简称,全称,等级,大类,别名",
      "会议,ICCV,International Conference on Computer Vision,A,人工智能,ICCV",
    ].join("\n");

    const merged = buildCcfCatalog(csvContent, "csv", existing, { merge: true });
    assert.equal(merged.venues.length, 2);
    assert.ok(merged.venues.some((v: any) => v.abbr === "CVPR"));
    assert.ok(merged.venues.some((v: any) => v.abbr === "ICCV"));
  });
});
