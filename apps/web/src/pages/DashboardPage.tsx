import type {
  AnalyticsSummary,
  Detection,
  HeatmapResponse,
  Paged,
  Severity,
  SpeedDistributionResponse,
  TimeseriesResponse,
} from "@smart-speed/shared";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertOctagon,
  Gauge as GaugeIcon,
  GaugeCircle,
  Percent,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import {
  DistributionChart,
  HeatmapChart,
  SeverityDonut,
  TimeseriesChart,
  ViolationsBar,
} from "../components/charts";
import { HealthStrip } from "../components/dashboard/HealthStrip";
import { KpiCard } from "../components/dashboard/KpiCard";
import { SpeedGauge } from "../components/dashboard/SpeedGauge";
import { Ticker } from "../components/dashboard/Ticker";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { ErrorState, Skeleton, TableSkeleton } from "../components/ui/states";
import { apiGet } from "../lib/api";
import { useLive } from "../stores/live";

function useSummary() {
  return useQuery({
    queryKey: ["summary", "today"],
    queryFn: () => apiGet<AnalyticsSummary>("/analytics/summary?period=today"),
  });
}

function useMinuteSeries() {
  return useQuery({
    queryKey: ["timeseries", "today", "minute"],
    queryFn: () => apiGet<TimeseriesResponse>("/analytics/timeseries?period=today&bucket=minute"),
  });
}

function useHourSeries() {
  return useQuery({
    queryKey: ["timeseries", "7d", "hour"],
    queryFn: () => apiGet<TimeseriesResponse>("/analytics/timeseries?period=7d&bucket=hour"),
  });
}

function KpiRow() {
  const { data, isLoading } = useSummary();
  const { data: minutes } = useMinuteSeries();
  const { data: hours } = useHourSeries();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const minuteSpark = minutes?.points.map((p) => p.total) ?? [];
  const minuteOverspeed = minutes?.points.map((p) => p.overspeed) ?? [];
  const minuteAvg = minutes?.points.map((p) => p.avgSpeedKmh) ?? [];
  const minuteMax = minutes?.points.map((p) => p.maxSpeedKmh) ?? [];
  const rateSpark = hours?.points.map((p) => (p.total > 0 ? p.overspeed / p.total : 0)) ?? [];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <KpiCard
        label="Detections today"
        value={data.total.value.toLocaleString()}
        trend={data.total}
        spark={minuteSpark}
        icon={<Activity className="h-3.5 w-3.5" />}
      />
      <KpiCard
        label="Overspeed today"
        value={data.overspeed.value.toLocaleString()}
        trend={data.overspeed}
        spark={minuteOverspeed}
        sparkColor="#fb7185"
        icon={<AlertOctagon className="h-3.5 w-3.5" />}
      />
      <KpiCard
        label="Avg speed"
        value={data.avgSpeedKmh.value.toFixed(1)}
        unit="km/h"
        trend={data.avgSpeedKmh}
        spark={minuteAvg}
        sparkColor="#34d399"
        icon={<GaugeIcon className="h-3.5 w-3.5" />}
      />
      <KpiCard
        label="Max speed"
        value={data.maxSpeedKmh.toFixed(1)}
        unit="km/h"
        spark={minuteMax}
        sparkColor="#a78bfa"
        icon={<Zap className="h-3.5 w-3.5" />}
      />
      <KpiCard
        label="Violation rate"
        value={`${(data.violationRate * 100).toFixed(1)}%`}
        spark={rateSpark}
        sparkColor="#fbbf24"
        icon={<Percent className="h-3.5 w-3.5" />}
      />
    </div>
  );
}

function GaugePanel() {
  const latest = useLive((s) => s.latest);
  const recent = useLive((s) => s.recent);
  const { data: seed } = useQuery({
    queryKey: ["detections", "latest"],
    queryFn: () => apiGet<Paged<Detection>>("/detections?limit=1&sort=-detectedAt"),
    staleTime: 20_000,
  });

  const detection = latest ?? recent[0] ?? seed?.items[0] ?? null;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GaugeCircle className="h-3.5 w-3.5" /> Live speed
        </CardTitle>
        <span className="num text-[10px] uppercase tracking-widest text-muted-foreground">
          {detection ? detection.source : "no signal"}
        </span>
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-center">
        {detection ? (
          <SpeedGauge
            value={detection.scaledSpeedKmh}
            limit={detection.limitKmh}
            label={detection.deviceName ?? undefined}
            sublabel={`${detection.direction === "fwd" ? "forward" : "reverse"} · ${
              detection.plate ?? "unplated"
            }`}
          />
        ) : (
          <Skeleton className="h-48 w-full max-w-[300px]" />
        )}
      </CardContent>
    </Card>
  );
}

function ChartGrid() {
  const { data: hours, isLoading: hoursLoading } = useHourSeries();
  const { data: heatmap } = useQuery({
    queryKey: ["heatmap"],
    queryFn: () => apiGet<HeatmapResponse>("/analytics/hourly-heatmap"),
  });
  const { data: distribution } = useQuery({
    queryKey: ["distribution"],
    queryFn: () => apiGet<SpeedDistributionResponse>("/analytics/speed-distribution"),
  });
  const { data: recentPage } = useQuery({
    queryKey: ["severity-mix"],
    queryFn: () => apiGet<Paged<Detection>>("/detections?limit=500&sort=-detectedAt"),
    staleTime: 60_000,
  });

  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = { low: 0, medium: 0, high: 0 };
    for (const d of recentPage?.items ?? []) counts[d.severity] += 1;
    return counts;
  }, [recentPage]);

  if (hoursLoading) return <TableSkeleton rows={4} />;

  return (
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Speed over time — last 7 days</CardTitle>
        </CardHeader>
        {hours ? <TimeseriesChart points={hours.points} /> : <Skeleton className="h-64" />}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Severity mix — latest 500</CardTitle>
        </CardHeader>
        <SeverityDonut counts={severityCounts} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Violations by hour — today</CardTitle>
        </CardHeader>
        {hours ? <ViolationsBar points={hours.points} /> : <Skeleton className="h-52" />}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Speed distribution — 7 days</CardTitle>
        </CardHeader>
        {distribution ? (
          <DistributionChart buckets={distribution.buckets} />
        ) : (
          <Skeleton className="h-52" />
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Traffic × time heatmap</CardTitle>
        </CardHeader>
        {heatmap ? <HeatmapChart data={heatmap} /> : <Skeleton className="h-52" />}
      </Card>
    </div>
  );
}

export function DashboardPage() {
  const { data, error, isLoading, refetch } = useSummary();

  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" description="Live detection feed, KPIs and system health" />

      {error ? (
        <ErrorState message="Failed to load analytics summary" retry={() => void refetch()} />
      ) : null}

      <KpiRow />
      {isLoading && !data ? <Skeleton className="h-24" /> : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Live ticker</CardTitle>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                newest first
              </span>
            </CardHeader>
            <Ticker />
          </Card>
        </div>
        <GaugePanel />
      </div>

      <HealthStrip />
      <ChartGrid />
    </div>
  );
}
