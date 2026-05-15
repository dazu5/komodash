import { useEffect, useRef, useState } from "react";

import type { Chord } from "@/api/hotkey-validator";
import { cn } from "@/lib/utils";

/**
 * Chord-capture input (issue #20). Click activates "press a key combo"
 * mode; the next keydown captures and normalises into a `Chord`. Esc
 * cancels capture.
 *
 * We listen on the window during capture mode so the chord registers
 * even when the user releases modifier keys before pressing the base
 * key — and we preventDefault on the captured event so the browser
 * doesn't try to interpret it (e.g. Ctrl+S triggering Save).
 *
 * Modifier-only chords (just Ctrl, just Shift) don't capture — we
 * wait for a non-modifier key before committing.
 */
export function ChordCapture({
  value,
  onChange,
}: {
  value: Chord;
  onChange: (next: Chord) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!capturing) return;

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }

      // Skip pure-modifier keydowns — wait for a real base key.
      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta" ||
        e.key === "OS"
      ) {
        return;
      }

      const modifiers: Chord["modifiers"] = [];
      if (e.metaKey) modifiers.push("Win");
      if (e.ctrlKey) modifiers.push("Ctrl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");

      onChange({
        modifiers,
        key: normaliseKey(e.key, e.code),
      });
      setCapturing(false);
    };

    // capture phase so we run before the browser's own shortcuts.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onChange]);

  const display = formatChord(value);

  return (
    <button
      ref={(el) => {
        containerRef.current = el?.parentElement as HTMLDivElement | null;
      }}
      type="button"
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      className={cn(
        "w-full rounded-md border px-2 py-1 text-left text-sm font-mono",
        capturing
          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300 animate-pulse"
          : "border-border bg-secondary/40 hover:bg-secondary/60",
      )}
      title={capturing ? "Press the key combination, or Esc to cancel" : "Click to record a new chord"}
    >
      {capturing ? "Press a key combination…" : display || "(no chord)"}
    </button>
  );
}

function formatChord(chord: Chord): string {
  if (chord.modifiers.length === 0 && !chord.key) return "";
  return [...chord.modifiers, chord.key || ""].filter(Boolean).join("+");
}

/**
 * Map a `KeyboardEvent` to the same canonical form `whkdrc_parser`
 * produces on the Rust side. We use `event.code` (`KeyH`, `Digit1`,
 * `Space`, …) rather than `event.key` so the result is keyboard-
 * layout-independent and matches whkd's underlying scancode mapping.
 */
function normaliseKey(eventKey: string, eventCode: string): string {
  // Letters: KeyH -> H.
  if (eventCode.startsWith("Key") && eventCode.length === 4) {
    return eventCode.slice(3);
  }
  // Digits: Digit1 -> 1.
  if (eventCode.startsWith("Digit") && eventCode.length === 6) {
    return eventCode.slice(5);
  }
  // Function keys: F1..F24.
  if (/^F\d{1,2}$/.test(eventCode)) {
    return eventCode;
  }
  // Common named keys.
  const named: Record<string, string> = {
    Space: "Space",
    Tab: "Tab",
    Enter: "Return",
    Escape: "Esc",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    Backspace: "Backspace",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Minus: "OEM_MINUS",
    Equal: "OEM_PLUS",
    BracketLeft: "OEM_4",
    BracketRight: "OEM_6",
    Backslash: "OEM_5",
    Semicolon: "OEM_1",
    Quote: "OEM_7",
    Comma: "OEM_COMMA",
    Period: "OEM_PERIOD",
    Slash: "OEM_2",
    Backquote: "OEM_3",
  };
  if (named[eventCode]) return named[eventCode];
  // Fallback: uppercase the event.key as the parser does. Loses
  // layout-independence but works for unusual keys we haven't mapped.
  return eventKey.toUpperCase();
}
