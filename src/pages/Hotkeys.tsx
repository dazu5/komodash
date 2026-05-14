import { PageHeader, PagePlaceholder } from "@/components/page-shell";

export default function HotkeysPage() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Hotkeys"
        subtitle="Edit whkdrc bindings with conflict detection."
      />
      <PagePlaceholder message="Hotkey editor lands in task #5." />
    </div>
  );
}
