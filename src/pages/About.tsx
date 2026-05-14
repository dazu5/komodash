import { PageHeader } from "@/components/page-shell";

export default function AboutPage() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader title="About" subtitle="Komodash v0.1.0" />
      <div className="text-sm text-muted-foreground max-w-prose space-y-3">
        <p>
          Komodash is a Tauri-based dashboard for{" "}
          <a
            href="https://github.com/LGUG2Z/komorebi"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            Komorebi
          </a>
          , a tiling window manager for Windows.
        </p>
        <p>
          The editor is driven by the live JSON Schema emitted by{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
            komorebic static-config-schema
          </code>
          , so it stays in sync with whatever Komorebi version is installed.
        </p>
      </div>
    </div>
  );
}
