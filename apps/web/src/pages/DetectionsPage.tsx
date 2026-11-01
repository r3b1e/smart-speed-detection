import type { Detection, Paged, Severity } from "@smart-speed/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { DetectionDrawer } from "../components/detections/DetectionDrawer";
import { PageHeader } from "../components/layout/PageHeader";
import { SeverityBadge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { apiGet, qs } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useLive } from "../stores/live";

const PAGE_SIZE = 25;

export function DetectionsPage() {
  const queryClient = useQueryClient();
  const latestId = useLive((state) => state.latest?.id);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [overspeed, setOverspeed] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (latestId) void queryClient.invalidateQueries({ queryKey: ["detections"] });
  }, [latestId, queryClient]);

  useEffect(() => setPage(1), [search, overspeed, severity]);

  const params = {
    page,
    limit: PAGE_SIZE,
    q: search.trim() || undefined,
    overspeed: overspeed || undefined,
    severity: severity || undefined,
    sort: "-detectedAt",
  };
  const query = useQuery({
    queryKey: ["detections", params],
    queryFn: () => apiGet<Paged<Detection>>(`/detections${qs(params)}`),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Detections"
        description="Live gate measurements and overspeed reviews stored in MongoDB."
      />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1">
            <span className="mb-1 block text-xs text-muted-foreground">
              Search plate or vehicle ID
            </span>
            <span className="relative block">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </span>
          </label>
          <label className="w-36">
            <span className="mb-1 block text-xs text-muted-foreground">Result</span>
            <Select value={overspeed} onChange={(event) => setOverspeed(event.target.value)}>
              <option value="">All detections</option>
              <option value="true">Overspeed</option>
              <option value="false">Within limit</option>
            </Select>
          </label>
          <label className="w-36">
            <span className="mb-1 block text-xs text-muted-foreground">Severity</span>
            <Select
              value={severity}
              onChange={(event) => setSeverity(event.target.value as Severity | "")}
            >
              <option value="">All severity</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </label>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh detections"
            onClick={() => void query.refetch()}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {query.isPending ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : query.isError ? (
        <ErrorState message="Could not load detections." retry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title="No matching detections"
          description="New readings from the gate will appear here."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-border bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Speed</th>
                  <th className="px-4 py-3">Limit</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Frame</th>
                  <th className="px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((detection) => (
                  <tr
                    key={detection.id}
                    className="cursor-pointer border-b border-border/60 hover:bg-muted/40"
                    onClick={() => setSelectedId(detection.id)}
                  >
                    <td className="whitespace-nowrap px-4 py-3 num">
                      {formatDateTime(detection.detectedAt)}
                    </td>
                    <td
                      className={`px-4 py-3 font-semibold num ${detection.overspeed ? "text-danger" : "text-ok"}`}
                    >
                      {detection.scaledSpeedKmh.toFixed(1)} km/h
                    </td>
                    <td className="px-4 py-3 num">{detection.limitKmh} km/h</td>
                    <td className="px-4 py-3">
                      {detection.direction === "fwd" ? "Forward" : "Reverse"}
                    </td>
                    <td className="px-4 py-3">
                      {detection.overspeed ? "Over limit" : "Within limit"}
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={detection.severity} />
                    </td>
                    <td className="px-4 py-3">{detection.frame.status}</td>
                    <td className="px-4 py-3 uppercase">{detection.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>{query.data.total.toLocaleString()} records</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                {page} / {query.data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= query.data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
      <DetectionDrawer detectionId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
