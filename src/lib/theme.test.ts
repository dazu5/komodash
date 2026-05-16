import { describe, expect, it } from "vitest";

import type { JsonSchema } from "@/api/schema";

import {
  KNOWN_PALETTES,
  buildThemeValue,
  extractPaletteNames,
  parseTheme,
} from "./theme";

describe("KNOWN_PALETTES", () => {
  it("lists the three komorebi theme variants", () => {
    expect(KNOWN_PALETTES).toEqual(["Catppuccin", "Base16", "Custom"]);
  });
});

describe("parseTheme", () => {
  it("returns nulls for undefined / non-object input", () => {
    for (const v of [undefined, null, 7, "foo", []] as unknown[]) {
      const parsed = parseTheme(v);
      expect(parsed.palette).toBeNull();
      expect(parsed.name).toBeNull();
      expect(parsed.isCustom).toBe(false);
    }
  });

  it("returns palette + name when both are present", () => {
    const parsed = parseTheme({ palette: "Catppuccin", name: "Mocha" });
    expect(parsed.palette).toBe("Catppuccin");
    expect(parsed.name).toBe("Mocha");
    expect(parsed.isCustom).toBe(false);
  });

  it("flags isCustom when palette is Custom", () => {
    const parsed = parseTheme({ palette: "Custom", base_palette: {} });
    expect(parsed.isCustom).toBe(true);
  });
});

describe("extractPaletteNames", () => {
  it("returns the Catppuccin variant consts", () => {
    const schema: JsonSchema = {
      $defs: {
        Catppuccin: {
          oneOf: [
            { type: "string", const: "Frappe" },
            { type: "string", const: "Latte" },
            { type: "string", const: "Macchiato" },
            { type: "string", const: "Mocha" },
          ],
        },
      },
    };
    expect(extractPaletteNames(schema, "Catppuccin")).toEqual([
      "Frappe",
      "Latte",
      "Macchiato",
      "Mocha",
    ]);
  });

  it("returns an empty list when the named palette isn't defined", () => {
    expect(extractPaletteNames({}, "Catppuccin")).toEqual([]);
  });
});

describe("buildThemeValue", () => {
  it("produces the on-disk shape for a Catppuccin selection", () => {
    expect(buildThemeValue("Catppuccin", "Mocha")).toEqual({
      palette: "Catppuccin",
      name: "Mocha",
    });
  });

  it("returns null when the palette is cleared", () => {
    expect(buildThemeValue(null, "Mocha")).toBeNull();
  });
});
