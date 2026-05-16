import { describe, expect, it } from "vitest";

import { filterWindows, parseVisibleWindowsResponse } from "./visible-windows";

const fixtures = [
  { exe: "discord.exe", class: "Chrome_WidgetWin_1", title: "general — Discord" },
  { exe: "opera.exe", class: "Chrome_WidgetWin_1", title: "GitHub - Opera" },
  { exe: "Code.exe", class: "Chrome_WidgetWin_1", title: "main.rs — Komodash" },
  { exe: "explorer.exe", class: "CabinetWClass", title: "File Explorer" },
];

describe("filterWindows", () => {
  it("filters by case-insensitive substring of exe, title, or class", () => {
    expect(filterWindows(fixtures, "discord").map((w) => w.exe)).toEqual([
      "discord.exe",
    ]);
    expect(filterWindows(fixtures, "OPERA").map((w) => w.exe)).toEqual([
      "opera.exe",
    ]);
    expect(filterWindows(fixtures, "Komodash").map((w) => w.exe)).toEqual([
      "Code.exe",
    ]);
    expect(filterWindows(fixtures, "CabinetWClass").map((w) => w.exe)).toEqual([
      "explorer.exe",
    ]);
  });

  it("returns all windows when query is empty or whitespace", () => {
    expect(filterWindows(fixtures, "")).toEqual(fixtures);
    expect(filterWindows(fixtures, "   ")).toEqual(fixtures);
  });
});

describe("parseVisibleWindowsResponse", () => {
  it("flattens komorebic visible-windows JSON (keyed by monitor) to a flat list", () => {
    const json = JSON.stringify({
      "MON-A": [
        { title: "T1", exe: "a.exe", class: "C1" },
        { title: "T2", exe: "b.exe", class: "C2" },
      ],
      "MON-B": [{ title: "T3", exe: "c.exe", class: "C3" }],
    });
    const flat = parseVisibleWindowsResponse(json);
    expect(flat).toHaveLength(3);
    expect(flat.map((w) => w.exe).sort()).toEqual(["a.exe", "b.exe", "c.exe"]);
  });

  it("dedupes by exe + class + title (same window across monitors only counted once)", () => {
    const json = JSON.stringify({
      "MON-A": [{ title: "T", exe: "a.exe", class: "C" }],
      "MON-B": [{ title: "T", exe: "a.exe", class: "C" }],
    });
    expect(parseVisibleWindowsResponse(json)).toHaveLength(1);
  });

  it("returns an empty array on invalid JSON or wrong shape", () => {
    expect(parseVisibleWindowsResponse("not json")).toEqual([]);
    expect(parseVisibleWindowsResponse("[]")).toEqual([]);
    expect(parseVisibleWindowsResponse("null")).toEqual([]);
  });
});
