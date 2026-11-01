import type { AuditLog, Paged } from "@smart-speed/shared";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { apiGet, qs } from "../lib/api";
import { formatDateTime } from "../lib/format";

const ENTITIES = ["", "device", "detection", "settings", "user", "vehicle"];

export function AuditPage() {
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const query = useQuery({
    queryKey: ["audit", { action, entity }],
    queryFn: () =>
      apiGet<Paged<AuditLog>>(
        `/audit${qs({ page: 1, limit: 100, action: action || undefined, entity: entity || undefined })}`
      ),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Log"
        description="Administrative and operator changes recorded by the server."
      />
      <Card>
        <CardContent className="flex flex-wrap gap-3">
          <label className="min-w-48 flex-1">
            <span className="mb-1 block text-xs text-muted-foreground">Action</span>
            <span className="relative block">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={action}
                onChange={(event) => setAction(event.target.value)}
                placeholder="Search actions"
              />
            </span>
          </label>
          <label className="w-44">
            <span className="mb-1 block text-xs text-muted-foreground">Entity</span>
            <Select value={entity} onChange={(event) => setEntity(event.target.value)}>
              {ENTITIES.map((item) => (
                <option key={item || "all"} value={item}>
                  {item || "All entities"}
                </option>
              ))}
            </Select>
          </label>
        </CardContent>
      </Card>
      {query.isPending ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : query.isError ? (
        <ErrorState message="Could not load audit entries." retry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState title="No matching audit entries" />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-border bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr key={item.id} className="border-b border-border/60 align-top">
                    <td className="whitespace-nowrap px-4 py-3 num">{formatDateTime(item.at)}</td>
                    <td className="px-4 py-3">{item.actorName ?? "System"}</td>
                    <td className="px-4 py-3 font-medium">{item.action}</td>
                    <td className="px-4 py-3">{item.entity}</td>
                    <td className="max-w-sm break-words px-4 py-3 text-muted-foreground">
                      {item.meta ? JSON.stringify(item.meta) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Showing {query.data.items.length} of {query.data.total} entries · updates every 15
            seconds
          </p>
        </Card>
      )}
    </div>
  );
}
