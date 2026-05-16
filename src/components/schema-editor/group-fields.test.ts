import { describe, expect, it } from "vitest";

import type { FieldCatalog } from "@/api/field-catalog";
import type { JsonSchema } from "@/api/schema";

import { groupFieldsBySection } from "./group-fields";

const SECTIONS = [
  { id: "behaviour", label: "Behaviour", order: 10 },
];

const SCHEMA: JsonSchema = {
  properties: {
    border: { type: "boolean" },
    ignore_rules: { type: "array" },
  },
};

describe("groupFieldsBySection", () => {
  it("drops fields whose overlay sets hidden: true", () => {
    const catalog: FieldCatalog = {
      sections: SECTIONS,
      fields: {
        border: { label: "Border", section: "behaviour" },
        ignore_rules: {
          label: "Ignore rules",
          section: "behaviour",
          hidden: true,
        },
      },
    };

    const grouped = groupFieldsBySection(SCHEMA, catalog);
    const allFieldNames = grouped.flatMap((g) => g.fields.map((f) => f.name));
    expect(allFieldNames).toEqual(["border"]);
  });

  it("hidden field is dropped even if it would fall into 'Other'", () => {
    const catalog: FieldCatalog = {
      sections: SECTIONS,
      fields: {
        ignore_rules: {
          label: "Ignore rules",
          section: "nonexistent",
          hidden: true,
        },
      },
    };

    const grouped = groupFieldsBySection(SCHEMA, catalog);
    const allFieldNames = grouped.flatMap((g) => g.fields.map((f) => f.name));
    expect(allFieldNames).not.toContain("ignore_rules");
  });
});
