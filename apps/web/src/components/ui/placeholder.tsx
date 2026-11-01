import { PageHeader } from "../layout/PageHeader";
import { EmptyState } from "./states";

/**
 * Minimal route shell used until the page's own phase is implemented.
 * Later phases replace the whole page module; this file is the seam.
 */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} />
      <EmptyState
        title="Coming soon"
        description="This section is part of the roadmap and is not implemented yet."
      />
    </div>
  );
}
