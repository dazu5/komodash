import { PageHeader, PagePlaceholder } from "@/components/page-shell";

export default function BarConfigPage() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Status Bar"
        subtitle="Edit komorebi.bar.json — widgets, layout, colours."
      />
      <PagePlaceholder message="Bar editor lands in task #4." />
    </div>
  );
}
