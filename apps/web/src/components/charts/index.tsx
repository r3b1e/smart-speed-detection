import type { HeatmapResponse, Severity, TimeseriesPoint } from "@smart-speed/shared";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import type { EChartsReactProps } from "echarts-for-react/lib/types";

const PALETTE = {
  cyan: "#22d3ee",
  emerald: "#34d399",
  amber: "#fbbf24",
  red: "#fb7185",
  violet: "#a78bfa",
  slate: "#94a3b8",
  grid: "rgba(148,163,184,0.15)",
};

const AXIS = {
  axisLine: { lineStyle: { color: PALETTE.grid } },
  axisLabel: { color: PALETTE.slate, fontSize: 10 },
  splitLine: { lineStyle: { color: PALETTE.grid } },
  axisTick: { show: false },
};

type Option = NonNullable<EChartsReactProps["option"]>;

function BaseChart({ option, height = 260 }: { option: Option; height?: number }) {
  return (
    <ReactECharts
      option={option}
      style={{ height, width: "100%" }}
      notMerge
      opts={{ renderer: "canvas" }}
    />
  );
}

/* ---------------- sparkline (KPI cards) ---------------- */

export function Sparkline({ data, color = PALETTE.cyan }: { data: number[]; color?: string }) {
  const option = useMemo<Option>(
    () => ({
      grid: { left: 2, right: 2, top: 4, bottom: 2 },
      xAxis: { type: "category", show: false, boundaryGap: false, data: data.map((_, i) => i) },
      yAxis: { type: "value", show: false, min: "dataMin" },
      tooltip: { show: false },
      series: [
        {
          type: "line",
          data,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 1.5, color },
          areaStyle: { color, opacity: 0.12 },
        },
      ],
    }),
    [data, color]
  );
  return (
    <ReactECharts
      option={option}
      style={{ height: 40, width: "100%" }}
      opts={{ renderer: "canvas" }}
    />
  );
}

/* ---------------- speed over time ---------------- */

export function TimeseriesChart({ points }: { points: TimeseriesPoint[] }) {
  const option = useMemo<Option>(
    () => ({
      grid: { left: 40, right: 12, top: 24, bottom: 24 },
      legend: {
        data: ["avg speed", "max speed"],
        textStyle: { color: PALETTE.slate, fontSize: 10 },
        top: 0,
        right: 0,
      },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        ...AXIS,
        data: points.map((p) =>
          new Date(p.t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        ),
      },
      yAxis: { type: "value", ...AXIS, name: "km/h", nameTextStyle: { color: PALETTE.slate } },
      series: [
        {
          name: "avg speed",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: points.map((p) => p.avgSpeedKmh),
          lineStyle: { color: PALETTE.cyan, width: 2 },
          itemStyle: { color: PALETTE.cyan },
        },
        {
          name: "max speed",
          type: "line",
          smooth: true,
          showSymbol: false,
          data: points.map((p) => p.maxSpeedKmh),
          lineStyle: { color: PALETTE.violet, width: 1.5, type: "dashed" },
          itemStyle: { color: PALETTE.violet },
        },
      ],
    }),
    [points]
  );
  return <BaseChart option={option} />;
}

/* ---------------- violations by hour ---------------- */

export function ViolationsBar({ points }: { points: TimeseriesPoint[] }) {
  const option = useMemo<Option>(
    () => ({
      grid: { left: 36, right: 8, top: 20, bottom: 24 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        ...AXIS,
        data: points.map((p) => new Date(p.t).toLocaleTimeString(undefined, { hour: "2-digit" })),
      },
      yAxis: { type: "value", ...AXIS, minInterval: 1 },
      series: [
        {
          name: "overspeed",
          type: "bar",
          data: points.map((p) => p.overspeed),
          itemStyle: { color: PALETTE.amber, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 18,
        },
        {
          name: "total",
          type: "bar",
          data: points.map((p) => p.total),
          itemStyle: { color: "rgba(34,211,238,0.25)", borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 18,
        },
      ],
    }),
    [points]
  );
  return <BaseChart option={option} height={220} />;
}

/* ---------------- day × hour heatmap ---------------- */

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function HeatmapChart({ data }: { data: HeatmapResponse }) {
  const cells = useMemo(() => {
    const out: [number, number, number][] = [];
    data.matrix.forEach((row, dow) => {
      row.forEach((count, hour) => {
        out.push([hour, dow, count]);
      });
    });
    return out;
  }, [data]);

  const option = useMemo<Option>(
    () => ({
      grid: { left: 44, right: 12, top: 8, bottom: 32 },
      tooltip: {
        formatter: (p: unknown) => {
          const cell = Array.isArray(p) ? (p as [number, number, number]) : null;
          if (!cell) return "";
          const day = DAY_LABELS[cell[1]] ?? "";
          return `${day} ${String(cell[0]).padStart(2, "0")}:00 — <b>${cell[2]}</b> detections`;
        },
      },
      xAxis: {
        type: "category",
        ...AXIS,
        data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
        splitArea: { show: true },
      },
      yAxis: { type: "category", ...AXIS, data: DAY_LABELS, splitArea: { show: true } },
      visualMap: {
        min: 0,
        max: Math.max(data.maxCount, 1),
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemWidth: 10,
        itemHeight: 80,
        textStyle: { color: PALETTE.slate, fontSize: 9 },
        inRange: { color: ["#0b2536", "#164e63", "#0891b2", "#22d3ee", "#fbbf24", "#fb7185"] },
      },
      series: [
        {
          type: "heatmap",
          data: cells,
          emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.5)" } },
        },
      ],
    }),
    [cells, data.maxCount]
  );
  return <BaseChart option={option} height={240} />;
}

/* ---------------- speed distribution ---------------- */

export function DistributionChart({
  buckets,
}: {
  buckets: { from: number; to: number; count: number; overspeed: number }[];
}) {
  const option = useMemo<Option>(
    () => ({
      grid: { left: 40, right: 8, top: 20, bottom: 24 },
      tooltip: { trigger: "axis" },
      legend: {
        data: ["within limit", "overspeed"],
        textStyle: { color: PALETTE.slate, fontSize: 10 },
        top: 0,
        right: 0,
      },
      xAxis: {
        type: "category",
        ...AXIS,
        data: buckets.map((b) => `${b.from}`),
      },
      yAxis: { type: "value", ...AXIS, minInterval: 1 },
      series: [
        {
          name: "within limit",
          type: "bar",
          stack: "total",
          data: buckets.map((b) => b.count - b.overspeed),
          itemStyle: { color: "rgba(34,211,238,0.55)" },
          barMaxWidth: 22,
        },
        {
          name: "overspeed",
          type: "bar",
          stack: "total",
          data: buckets.map((b) => b.overspeed),
          itemStyle: { color: PALETTE.red, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 22,
        },
      ],
    }),
    [buckets]
  );
  return <BaseChart option={option} height={220} />;
}

/* ---------------- severity donut ---------------- */

const SEVERITY_COLOR: Record<Severity, string> = {
  low: PALETTE.cyan,
  medium: PALETTE.amber,
  high: PALETTE.red,
};

export function SeverityDonut({ counts }: { counts: Record<Severity, number> }) {
  const total = counts.low + counts.medium + counts.high;
  const option = useMemo<Option>(
    () => ({
      tooltip: { trigger: "item" },
      legend: {
        orient: "vertical",
        right: 4,
        top: "center",
        textStyle: { color: PALETTE.slate, fontSize: 10 },
      },
      series: [
        {
          type: "pie",
          radius: ["58%", "82%"],
          center: ["38%", "50%"],
          avoidLabelOverlap: true,
          label: { show: false },
          data: [
            { name: "low", value: counts.low, itemStyle: { color: SEVERITY_COLOR.low } },
            { name: "medium", value: counts.medium, itemStyle: { color: SEVERITY_COLOR.medium } },
            { name: "high", value: counts.high, itemStyle: { color: SEVERITY_COLOR.high } },
          ],
        },
      ],
      graphic: [
        {
          type: "text",
          left: "30%",
          top: "44%",
          style: {
            text: total.toLocaleString(),
            fill: "#e2e8f0",
            fontSize: 20,
            fontWeight: 700,
            fontFamily: "JetBrains Mono, monospace",
          },
        },
        {
          type: "text",
          left: "31%",
          top: "56%",
          style: { text: "recent", fill: "#94a3b8", fontSize: 10 },
        },
      ],
    }),
    [counts, total]
  );
  return <BaseChart option={option} height={220} />;
}
