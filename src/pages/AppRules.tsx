import { PageHeader, PagePlaceholder } from "@/components/page-shell";

export default function AppRulesPage() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Application Rules"
        subtitle="Manage ignore, floating, and per-workspace application rules."
      />
      <PagePlaceholder message="App-rule manager lands in task #6." />
    </div>
  );
}
