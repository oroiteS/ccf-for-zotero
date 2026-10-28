import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatItemDiagnostics } from "../src/modules/diagnostics";

function fakeJournalArticle(fields: Record<string, string>): Zotero.Item {
  return {
    itemType: "journalArticle",
    getField(field: string) {
      return fields[field] || "";
    },
  } as unknown as Zotero.Item;
}

describe("CCF item diagnostics", () => {
  it("reports the full venue name when the matched journal has no abbreviation", () => {
    // 回归：Neural Networks 无官方简称，诊断曾输出 “结果：CCF B | ”（竖线后为空）。
    const item = fakeJournalArticle({
      title:
        "Large language model with retrieval semantics for cold-start recommendations",
      publicationTitle: "Neural Networks",
      journalAbbreviation: "Neural Networks",
      extra: "CCF Venue: Neural Networks",
    });

    const report = formatItemDiagnostics(item);

    assert.ok(report.includes("结果：CCF B | Neural Networks"));
    assert.ok(report.includes("全称：Neural Networks"));
    assert.ok(report.includes("分类：人工智能"));
    assert.ok(report.includes("命中字段：publicationTitle"));
  });

  it("keeps reporting the abbreviation when one exists", () => {
    const item = fakeJournalArticle({
      publicationTitle: "IEEE Transactions on Neural Networks and learning systems",
    });

    const report = formatItemDiagnostics(item);

    assert.ok(report.includes("结果：CCF B | TNNLS"));
  });
});
