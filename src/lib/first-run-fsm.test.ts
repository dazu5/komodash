import { describe, expect, it } from "vitest";

import { nextState, type DetectionResult } from "./first-run-fsm";

const allGood: DetectionResult = {
  installed: true,
  configExists: true,
  running: true,
  autostartEnabled: true,
};

describe("nextState — happy path skip", () => {
  it("goes from `detecting` directly to `done` when everything passes", () => {
    expect(nextState("detecting", allGood)).toBe("done");
  });
});

describe("nextState — picks the first failing condition", () => {
  it("routes to install_komorebi when komorebi is not installed", () => {
    expect(
      nextState("detecting", { ...allGood, installed: false }),
    ).toBe("install_komorebi");
  });

  it("routes to create_config when installed but no config on disk", () => {
    expect(
      nextState("detecting", { ...allGood, configExists: false }),
    ).toBe("create_config");
  });

  it("routes to start_komorebi when installed + configured but not running", () => {
    expect(
      nextState("detecting", { ...allGood, running: false }),
    ).toBe("start_komorebi");
  });

  it("routes to enable_autostart when running but autostart is off", () => {
    expect(
      nextState("detecting", { ...allGood, autostartEnabled: false }),
    ).toBe("enable_autostart");
  });

  it("prefers earlier prerequisites — install before create_config", () => {
    // Both fail; the wizard should fix install first.
    expect(
      nextState("detecting", {
        installed: false,
        configExists: false,
        running: false,
        autostartEnabled: false,
      }),
    ).toBe("install_komorebi");
  });
});

describe("nextState — re-detection after an action step", () => {
  it("advances from install_komorebi to the next failing condition", () => {
    // Install succeeded; config still missing.
    expect(
      nextState("install_komorebi", {
        ...allGood,
        configExists: false,
      }),
    ).toBe("create_config");
  });

  it("advances from create_config to done when every remaining condition passes", () => {
    expect(nextState("create_config", allGood)).toBe("done");
  });
});
