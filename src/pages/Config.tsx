import { PageHeader, PagePlaceholder } from "@/components/page-shell";

export default function ConfigPage() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Configuration"
        subtitle="Schema-driven editor for komorebi.json."
      />
      <PagePlaceholder message="Editor lands in task #4." />
    </div>
  );
}
