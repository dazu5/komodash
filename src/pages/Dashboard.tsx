import { PageHeader, PagePlaceholder } from "@/components/page-shell";

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Live view of monitors, workspaces and managed windows."
      />
      <PagePlaceholder
        message="Live state, status badges, and quick toggles land in task #7."
      />
    </div>
  );
}
