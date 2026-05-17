# Komodash

A Tauri desktop dashboard that lets non-technical Windows users configure the Komorebi tiling window manager without ever opening a JSON file.

## Language

### Audience

**End user**:
The person Komodash is built for — someone who wants a tiling window manager but does not want to (or cannot) hand-edit JSON or text config files.
_Avoid_: non-coder, beginner, normie, layperson.

**Power user**:
Someone who edits Komorebi's config files directly in a text editor. Komodash supports them as a side effect, but they are **not** the target audience and the UI is not tuned for them.
_Avoid_: developer (too narrow), advanced user.

### Configuration model

**Managed config**:
A config file whose lifecycle Komodash owns. The three managed configs are `komorebi.json`, `komorebi.bar.json`, and `whkdrc`. Komodash is the **sole writer** of all three; any hand-edit may be overwritten on the next save.
_Avoid_: user config, editable file.

**Community catalog**:
The `applications.json` file shipped by the upstream Komorebi-application-specific-configurations project. It is treated as **read-only** by Komodash — never authored, only refreshed via `komorebic fetch-app-specific-configuration`. **End users** add their own rules to the **Static configuration**, not to the **Community catalog**.

**Working buffer**:
Komodash's in-memory representation of a **Managed config** while the **End user** is editing it. Saves flush the working buffer to disk.

**Hot reload**:
Applying a changed `komorebi.json` to a running Komorebi instance without restarting it. Triggered by `komorebic replace-configuration <path>`.

**Live-apply**:
The combined operation Komodash performs after an **End user** changes a value in the **Static configuration** editor: debounce → write the **Working buffer** to disk → trigger **Hot reload**. **Live-apply** is *only* used for the **Static configuration**; the **Bar configuration** and `whkdrc` use an explicit "Apply" affordance instead, because applying them restarts a visible subsystem (the bar process or whkd).

### Editor model

**Field catalog**:
A Komodash-bundled metadata file that overrides label, description, grouping, and widget hints for fields in the Komorebi **Static configuration** schema. Lookup is by JSON-path. Fields not in the **Field catalog** fall back to the raw schema and render under an "Other" group.

**Command catalog**:
Komodash's cached parse of `komorebic --help` output: the list of valid `komorebic` subcommands and the arg specs for each. The Hotkey editor uses it to validate the right-hand-side of each binding and to drive the searchable command picker. Re-parsed when Komorebi is upgraded.

### Hotkeys

**Chord**:
A keyboard key combination that triggers a hotkey — one or more modifiers (Ctrl, Alt, Shift, Win) plus one base key. The **End user** enters a **Chord** in the Hotkey editor by pressing the keys; Komodash normalises modifier order on capture and on save.

### Bar geometry

The status bar's footprint is the result of four distinct numbers that share no inheritance relationship — each lives at a different layer and reserves a different kind of space. Bug reports use these terms precisely.

**Bar height**:
The painted height of the pill bar in pixels. Set on `komorebi.bar.json:height`. Independent of the window's vertical position.

**Bar margin**:
Pixels of empty space between the bar's painted edge and the window's edge it sits closest to. Set on `komorebi.bar.json:margin.{top,bottom,left,right}`. Only `top` is meaningful for a top-anchored bar.

**Frame inner margin**:
Pixels of empty space between the inside of the painted pill and the widgets it contains. Set on `komorebi.bar.json:frame.inner_margin.{x,y}`. Widgets are inset from the pill edge by this amount before chip rendering takes over.

**Work-area offset (`work_area_offset.{top,bottom,left,right}`)**:
Pixels of space at each *monitor* edge that **Komorebi** must keep empty when tiling **Workspaces**. Set on `komorebi.bar.json:monitor.work_area_offset`, also pushable at runtime via `komorebic monitor-work-area-offset`. The four edges are **independent** — each only affects its own monitor edge. `top` is where the bar sits; `bottom` clears the Windows taskbar; `left`/`right` reserve for hypothetical side bars. This is a **Komorebi** concept, not a bar concept.

**Container padding**:
Pixels of space **Komorebi** adds between tiled **Windows** and the **Workspace** edge. Set on `komorebi.json:container_padding`. Lives in a **different file** than the bar geometry. This is what produces the visible gap between tiled windows and the screen sides — *not* `work_area_offset.left/right`, which are usually zero.

**Taskbar height**:
The pixel height of the visible Windows taskbar on a given **Monitor**. Probed at runtime via Win32 `GetMonitorInfoW` (`rcMonitor.bottom − rcWork.bottom`). Auto-hidden taskbar → 0; side-anchored taskbar → 0 (and `left`/`right` non-zero instead).

**Bar reservation**:
The computed `work_area_offset` Komodash pushes for the bar's target **Monitor**. Derived from **Bar margin**, **Bar height**, and **Taskbar height** by `compute_bar_reservation()`. The on-disk `work_area_offset` is a **derived value** — users edit the inputs, not the result. Sole source of truth.

### Live view

**Live state**:
The real-time view of Komorebi's **Monitors**, **Workspaces**, **Containers**, and **Windows** that Komodash receives over its **Named pipe** subscription. Event-driven, not polled. The Dashboard page is the **End user**'s window onto **Live state**.

### Onboarding

**First-run wizard**:
The flow Komodash shows on launch when Komorebi is not installed, has no config, is not running, or autostart is not enabled. Skipped entirely on the happy path.

**Starter config**:
A Komodash-bundled `starter-config.json` representing opinionated defaults for a **End user**'s first **Static configuration**. Used by the **First-run wizard** when no `komorebi.json` exists. Differs deliberately from `komorebic quickstart`'s output where the non-technical default makes more sense.

### Komorebi terms (upstream — do not redefine)

Komodash inherits the following vocabulary directly from Komorebi. Do not invent synonyms.

**Komorebi**:
The tiling window manager Komodash sits on top of. The long-running binary is `komorebi.exe`.

**komorebic**:
Komorebi's CLI client (`komorebic.exe`). Every imperative action Komodash takes — apply config, query state, toggle a setting — is a `komorebic` invocation.

**whkd**:
Windows Hotkey Daemon. A separate binary that maps key chords to `komorebic` invocations. Configured via the **whkdrc** managed config.

**Static configuration**:
The JSON file Komorebi loads at startup and on **Hot reload**. Canonical path: `~/komorebi.json`. Its shape is defined by the JSON Schema emitted by `komorebic static-config-schema`.

**Bar configuration**:
The JSON file describing the Komorebi status bar. Canonical path: `~/komorebi.bar.json`. Separate from the **Static configuration**.

**whkdrc**:
The whkd hotkey file. Canonical path: `~/.config/whkdrc`. Plain text — supports comments, `.shell`, `.imports`, and one binding per line.

**applications.json**:
The on-disk file holding the **Community catalog**. Canonical path: `~/applications.json`.

**Monitor**:
A physical display. Indexed; the index is stable for a given hardware setup.

**Workspace**:
A virtual desktop bound to a **Monitor**. A **Monitor** has one or more **Workspaces**; the **End user** switches between them.

**Container**:
A group of windows tiled together on a **Workspace**. Stacking and tabbing happen inside containers.

**Window**:
A top-level OS window that Komorebi has decided to manage. Unmanaged windows are visible but ignored by the tiler.

**Layout**:
The tiling algorithm a **Workspace** uses (BSP, columns, rows, vertical-stack, ultrawide-vertical-stack, custom, etc.).

**Named pipe**:
The Windows IPC mechanism Komorebi uses to push state to subscribers. Komodash subscribes via `komorebic subscribe-pipe <name>` and reads from `\\.\pipe\<name>`.

**Application rule**:
An entry in `applications.json` or in one of the rule arrays inside the **Static configuration**, telling Komorebi how to treat a specific application (ignore, float, route to **Workspace**, etc.).

## Relationships

- A **Monitor** has one or more **Workspaces**; a **Workspace** belongs to exactly one **Monitor**.
- A **Workspace** holds zero or more **Containers**; a **Container** holds one or more **Windows**.
- A **Workspace** has exactly one active **Layout** at a time.
- A **Managed config** has exactly one **Working buffer** in Komodash at any moment.
- A **Working buffer** is flushed to disk on save; saving the **Static configuration** can optionally trigger a **Hot reload** via **Live-apply**.
- The **Field catalog** overrides the JSON Schema's metadata; the schema is still the source of truth for *which* fields exist and what their types are.
- Komodash targets the **End user**. **Power users** can run Komodash but should expect manual edits to a **Managed config** to be overwritten.

## Example dialogue

> **Dev:** "If the user changes a colour in the **Static configuration** editor and saves, does Komorebi pick it up?"
> **PM:** "Only if we also trigger **Hot reload**. The save writes to disk; **Hot reload** is the `komorebic replace-configuration` call. We bundle the two together as **Live-apply**."
> **Dev:** "What if someone has hand-edited `komorebi.json` while Komodash is open?"
> **PM:** "Their edits lose. We're the sole writer of every **Managed config** — that's the deal for the **End user** audience."
> **Dev:** "What about a **Power user** who likes editing both?"
> **PM:** "We support them only insofar as we don't crash on a file we didn't write. We don't try to merge or preserve their changes."

## Flagged ambiguities

- The user's preferred phrase **non-coder** was generalised to **End user** in this glossary, because Komodash's target is defined by relationship to the tool ("does not edit JSON"), not by profession.
- "Catalog" is used for three distinct concepts (**Field catalog**, **Community catalog**, **Command catalog**). The scoping prefix is mandatory — bare "catalog" should not appear in code or docs.
