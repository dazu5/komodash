import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createUndoController,
  pushChange,
  type Change,
  type UndoHandlers,
} from "./undo-stack";

const staticChange = (
  path: string,
  before: unknown,
  after: unknown,
): Change => ({
  kind: "static-live-apply",
  path,
  before,
  after,
});

describe("pushChange — coalescing", () => {
  it("appends a fresh entry to an empty stack", () => {
    const next = pushChange([], staticChange("border", true, false), 1000);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ path: "border", before: true, after: false });
  });

  it("coalesces same-path static changes within the 500 ms window", () => {
    let stack: Change[] = [];
    stack = pushChange(stack, staticChange("border_colours.single", "#000", "#111"), 1000);
    stack = pushChange(stack, staticChange("border_colours.single", "#111", "#222"), 1200);
    stack = pushChange(stack, staticChange("border_colours.single", "#222", "#333"), 1450);
    expect(stack).toHaveLength(1);
    // Earliest before, latest after.
    expect(stack[0]).toMatchObject({ before: "#000", after: "#333" });
  });

  it("does NOT coalesce when the same-path change is later than 500 ms", () => {
    let stack: Change[] = [];
    stack = pushChange(stack, staticChange("border", true, false), 1000);
    stack = pushChange(stack, staticChange("border", false, true), 1600);
    expect(stack).toHaveLength(2);
  });

  it("does NOT coalesce different-path changes even if within 500 ms", () => {
    let stack: Change[] = [];
    stack = pushChange(stack, staticChange("border", true, false), 1000);
    stack = pushChange(stack, staticChange("animation.enabled", true, false), 1100);
    expect(stack).toHaveLength(2);
  });

  it("does NOT coalesce a bar-apply change with a same-time static change", () => {
    let stack: Change[] = [];
    stack = pushChange(stack, staticChange("border", true, false), 1000);
    stack = pushChange(
      stack,
      { kind: "bar-apply", before: { x: 1 }, after: { x: 2 } },
      1100,
    );
    expect(stack).toHaveLength(2);
  });

  it("never coalesces bar-apply or whkdrc-apply changes (each Apply is one entry)", () => {
    let stack: Change[] = [];
    stack = pushChange(stack, { kind: "bar-apply", before: { x: 1 }, after: { x: 2 } }, 1000);
    stack = pushChange(stack, { kind: "bar-apply", before: { x: 2 }, after: { x: 3 } }, 1050);
    expect(stack).toHaveLength(2);
  });
});

describe("createUndoController — apply / undo orchestration", () => {
  let handlers: UndoHandlers;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    handlers = {
      applyStatic: vi.fn(async (path: string, value: unknown) => {
        calls.push(`static:${path}=${JSON.stringify(value)}`);
      }),
      applyBar: vi.fn(async (config: unknown) => {
        calls.push(`bar=${JSON.stringify(config)}`);
      }),
      applyWhkdrc: vi.fn(async (model: unknown) => {
        calls.push(`whkdrc=${JSON.stringify(model)}`);
      }),
    };
  });

  it("apply pushes a single static change and invokes applyStatic", async () => {
    const ctrl = createUndoController(handlers, () => 1000);
    await ctrl.apply(staticChange("border", true, false));
    expect(ctrl.peekStack()).toHaveLength(1);
    expect(calls).toEqual(["static:border=false"]);
  });

  it("undo pops the top static change and re-applies the `before` value", async () => {
    const ctrl = createUndoController(handlers, () => 1000);
    await ctrl.apply(staticChange("border", true, false));
    calls.length = 0;
    await ctrl.undo();
    expect(ctrl.peekStack()).toHaveLength(0);
    expect(calls).toEqual(["static:border=true"]);
  });

  it("apply / undo of a bar-apply change uses the bar handler", async () => {
    const ctrl = createUndoController(handlers, () => 1000);
    const before = { font_size: 12 };
    const after = { font_size: 14 };
    await ctrl.apply({ kind: "bar-apply", before, after });
    calls.length = 0;
    await ctrl.undo();
    expect(calls).toEqual([`bar=${JSON.stringify(before)}`]);
  });

  it("apply / undo of a whkdrc-apply change uses the whkdrc handler", async () => {
    const ctrl = createUndoController(handlers, () => 1000);
    const before = { bindings: [] };
    const after = { bindings: [{ chord: "Alt+H", command: "focus left" }] };
    await ctrl.apply({ kind: "whkdrc-apply", before, after });
    calls.length = 0;
    await ctrl.undo();
    expect(calls).toEqual([`whkdrc=${JSON.stringify(before)}`]);
  });

  it("undo unwinds an interleaved (static, bar, whkdrc) sequence in LIFO order", async () => {
    const ctrl = createUndoController(handlers, () => 1000);
    await ctrl.apply(staticChange("border", true, false));
    await ctrl.apply({
      kind: "bar-apply",
      before: { font: 12 },
      after: { font: 14 },
    });
    await ctrl.apply({
      kind: "whkdrc-apply",
      before: { b: [] },
      after: { b: [{ c: "x" }] },
    });
    calls.length = 0;
    await ctrl.undo();
    await ctrl.undo();
    await ctrl.undo();
    expect(calls).toEqual([
      `whkdrc=${JSON.stringify({ b: [] })}`,
      `bar=${JSON.stringify({ font: 12 })}`,
      `static:border=true`,
    ]);
    expect(ctrl.peekStack()).toHaveLength(0);
  });

  it("undo on an empty stack is a no-op (no handler invocations)", async () => {
    const ctrl = createUndoController(handlers, () => 1000);
    await ctrl.undo();
    expect(calls).toEqual([]);
    expect(handlers.applyStatic).not.toHaveBeenCalled();
  });

  it("coalesced static changes undo as a single entry to the earliest `before`", async () => {
    let now = 1000;
    const ctrl = createUndoController(handlers, () => now);
    await ctrl.apply(staticChange("border_colours.single", "#000", "#111"));
    now = 1200;
    await ctrl.apply(staticChange("border_colours.single", "#111", "#222"));
    now = 1450;
    await ctrl.apply(staticChange("border_colours.single", "#222", "#333"));
    expect(ctrl.peekStack()).toHaveLength(1);
    calls.length = 0;
    await ctrl.undo();
    // Should restore the original "#000" — the earliest before, not "#222".
    expect(calls).toEqual(["static:border_colours.single=\"#000\""]);
  });
});
