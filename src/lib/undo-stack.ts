/**
 * Pure undo-stack core (issue #21, per ADR-0006).
 *
 * The store holds a stack of `Change` entries; `apply` pushes + dispatches
 * to the right Tauri command, `undo` pops the top entry and dispatches the
 * reverse via the same code path so error surfaces stay consistent.
 *
 * Same-field static-live-apply changes within a 500 ms window collapse
 * into one entry — so a colour-picker drag is one Ctrl+Z, not 50.
 *
 * This module is pure logic. The Zustand store wrapper lives in
 * `src/stores/undo-stack.ts`; tests import from here directly with a
 * fake handlers object so no Tauri / DOM is in scope.
 */

export type Change =
  | {
      kind: "static-live-apply";
      path: string;
      before: unknown;
      after: unknown;
    }
  | {
      kind: "bar-apply";
      before: unknown;
      after: unknown;
    }
  | {
      kind: "whkdrc-apply";
      before: unknown;
      after: unknown;
    };

/** Internal: stamped form of a Change for coalescing. */
type StampedChange = Change & { _at: number };

/**
 * Handlers that wire the undo controller to the actual apply paths
 * (Tauri commands in production; vi.fn in tests).
 */
export interface UndoHandlers {
  applyStatic: (path: string, value: unknown) => Promise<void>;
  applyBar: (config: unknown) => Promise<void>;
  applyWhkdrc: (model: unknown) => Promise<void>;
}

const COALESCE_WINDOW_MS = 500;

/**
 * Push a `Change` onto the stack, coalescing with the top entry when
 * appropriate (same `static-live-apply` path within the 500 ms
 * window). Returns a new array — the input is not mutated.
 *
 * `now` is injected so tests can drive the coalescing window
 * deterministically.
 */
export function pushChange(
  stack: Change[],
  change: Change,
  now: number,
): Change[] {
  const top = stack[stack.length - 1] as StampedChange | undefined;
  const next: StampedChange = { ...change, _at: now };

  if (
    top &&
    top.kind === "static-live-apply" &&
    change.kind === "static-live-apply" &&
    top.path === change.path &&
    now - top._at <= COALESCE_WINDOW_MS
  ) {
    // Coalesce: keep the earliest `before`, take the latest `after`,
    // refresh the timestamp so further pushes within the window
    // continue to fold in.
    const merged: StampedChange = {
      kind: "static-live-apply",
      path: top.path,
      before: top.before,
      after: change.after,
      _at: now,
    };
    return [...stack.slice(0, -1), merged];
  }
  return [...stack, next];
}

/**
 * Pop the top `Change` off the stack. Returns the entry (if any) +
 * the remaining stack. The input is not mutated.
 */
export function popChange(stack: Change[]): {
  entry?: Change;
  remaining: Change[];
} {
  if (stack.length === 0) return { remaining: [] };
  return {
    entry: stripStamp(stack[stack.length - 1] as StampedChange),
    remaining: stack.slice(0, -1),
  };
}

function stripStamp(c: StampedChange): Change {
  const { _at: _at, ...rest } = c;
  void _at;
  return rest as Change;
}

/**
 * Imperative controller: holds the stack + the handlers, exposes
 * `apply` / `undo` / `peekStack`. The Zustand store wraps this with
 * subscription support; tests use the controller directly.
 *
 * `clock` is injected so tests can advance time deterministically;
 * production wires it to `() => Date.now()`.
 */
export function createUndoController(
  handlers: UndoHandlers,
  clock: () => number = () => Date.now(),
) {
  let stack: Change[] = [];

  return {
    peekStack(): Change[] {
      return stack.slice();
    },
    async apply(change: Change): Promise<void> {
      stack = pushChange(stack, change, clock());
      await dispatch(handlers, change, "after");
    },
    async undo(): Promise<void> {
      const { entry, remaining } = popChange(stack);
      stack = remaining;
      if (!entry) return;
      await dispatch(handlers, entry, "before");
    },
  };
}

async function dispatch(
  handlers: UndoHandlers,
  change: Change,
  direction: "before" | "after",
): Promise<void> {
  switch (change.kind) {
    case "static-live-apply":
      await handlers.applyStatic(
        change.path,
        direction === "after" ? change.after : change.before,
      );
      return;
    case "bar-apply":
      await handlers.applyBar(
        direction === "after" ? change.after : change.before,
      );
      return;
    case "whkdrc-apply":
      await handlers.applyWhkdrc(
        direction === "after" ? change.after : change.before,
      );
      return;
  }
}
