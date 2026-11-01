import type {
  AnalyticsSummary,
  HeatmapResponse,
  SpeedDistributionResponse,
  TimeseriesResponse,
} from "@smart-speed/shared";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Gauge, Percent, Timer } from "lucide-react";
import { useState } from "react";
import {
  DistributionChart,
  HeatmapChart,
  TimeseriesChart,
  ViolationsBar,
} from "../components/charts";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";
import { apiGet } from "../lib/api";

type Period = "today" | "7d" | "30d";

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <span className="text-primary">{icon}</span>
      </CardHeader>
      <p className="num text-2xl font-semibold">{value}</p>
    </Card>
  );
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const bucket = period === "today" ? "minute" : period === "7d" ? "hour" : "day";
  const summary = useQuery({
    queryKey: ["analytics", "summary", period],
    queryFn: () => apiGet<AnalyticsSummary>(`/analytics/summary?period=${period}`),
  });
  const series = useQuery({
    queryKey: ["analytics", "timeseries", period, bucket],
    queryFn: () =>
      apiGet<TimeseriesResponse>(`/analytics/timeseries?period=${period}&bucket=${bucket}`),
  });
  const heatmap = useQuery({
    queryKey: ["analytics", "heatmap", period],
    queryFn: () => apiGet<HeatmapResponse>(`/analytics/hourly-heatmap?period=${period}`),
  });
  const distribution = useQuery({
    queryKey: ["analytics", "distribution", period],
    queryFn: () =>
      apiGet<SpeedDistributionResponse>(`/analytics/speed-distribution?period=${period}`),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        description="Aggregate speed and overspeed trends calculated from stored gate readings."
        actions={
          <Select
            aria-label="Analytics period"
            value={period}
            onChange={(event) => setPeriod(event.target.value as Period)}
            className="w-36"
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </Select>
        }
      />
      {summary.isError ? (
        <ErrorState message="Could not load analytics." retry={() => void summary.refetch()} />
      ) : summary.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Detections"
            value={summary.data.total.value.toLocaleString()}
            icon={<Activity className="h-4 w-4" />}
          />
          <Metric
            label="Overspeed"
            value={summary.data.overspeed.value.toLocaleString()}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <Metric
            label="Average speed"
            value={`${summary.data.avgSpeedKmh.value.toFixed(1)} km/h`}
            icon={<Gauge className="h-4 w-4" />}
          />
          <Metric
            label="Violation rate"
            value={`${(summary.data.violationRate * 100).toFixed(1)}%`}
            icon={<Percent className="h-4 w-4" />}
          />
        </div>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Speed over time</CardTitle>
            <Timer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {series.isPending ? (
              <Skeleton className="h-64" />
            ) : series.isError ? (
              <ErrorState message="Time series unavailable." retry={() => void series.refetch()} />
            ) : series.data.points.length ? (
              <TimeseriesChart points={series.data.points} />
            ) : (
              <EmptyState title="No readings in this period" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Overspeed by interval</CardTitle>
          </CardHeader>
          <CardContent>
            {series.isPending ? (
              <Skeleton className="h-56" />
            ) : series.data?.points.length ? (
              <ViolationsBar points={series.data.points} />
            ) : (
              <EmptyState title="No readings in this period" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Speed distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {distribution.isPending ? (
              <Skeleton className="h-56" />
            ) : distribution.isError ? (
              <ErrorState
                message="Distribution unavailable."
                retry={() => void distribution.refetch()}
              />
            ) : (
              <DistributionChart buckets={distribution.data.buckets} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Traffic by day and hour</CardTitle>
          </CardHeader>
          <CardContent>
            {heatmap.isPending ? (
              <Skeleton className="h-56" />
            ) : heatmap.isError ? (
              <ErrorState message="Heatmap unavailable." retry={() => void heatmap.refetch()} />
            ) : (
              <HeatmapChart data={heatmap.data} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
