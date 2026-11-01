import type { Detection, Paged } from "@smart-speed/shared";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CameraOff, Loader2, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { frameImageUrl } from "../../lib/env";
import { cn, formatTime } from "../../lib/format";
import { getAccessToken } from "../../lib/session";
import { useLive } from "../../stores/live";
import { DetectionDrawer } from "../detections/DetectionDrawer";
import { SeverityBadge } from "../ui/badge";
import { Card, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/states";

const GRID_SIZE = 8;

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function excessPct(d: Detection): number {
  return d.limitKmh > 0 ? ((d.scaledSpeedKmh - d.limitKmh) / d.limitKmh) * 100 : 0;
}

/** Today's overspeed detections: server page merged with live socket updates. */
function useTodayViolations() {
  const from = useMemo(startOfTodayIso, []);
  const query = useQuery({
    queryKey: ["detections", "overspeed", "today", from],
    queryFn: () =>
      apiGet<Paged<Detection>>(
        `/detections?overspeed=true&from=${encodeURIComponent(from)}&limit=500&sort=-detectedAt`
      ),
    staleTime: 30_000,
  });
  const recent = useLive((s) => s.recent);

  const items = useMemo(() => {
    const byId = new Map<string, Detection>();
    for (const d of query.data?.items ?? []) byId.set(d.id, d);
    // live copies win: they carry frame status updates from the socket
    for (const d of recent) if (d.overspeed && d.detectedAt >= from) byId.set(d.id, d);
    return [...byId.values()].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }, [query.data, recent, from]);

  return { items, isLoading: query.isLoading };
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("num mt-0.5 text-lg font-bold", tone)}>{value}</div>
    </div>
  );
}

function Photo({ detection }: { detection: Detection }) {
  const [broken, setBroken] = useState(false);
  const src = frameImageUrl(
    detection.frame.thumbFileId ?? detection.frame.fileId,
    getAccessToken()
  );
  const status = detection.frame.status;

  if (status === "ready" && src && !broken) {
    return (
      <img
        src={src}
        alt={`Camera snapshot of vehicle at ${detection.scaledSpeedKmh.toFixed(1)} km/h`}
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
    );
  }
  const pending = status === "pending";
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground">
      {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CameraOff className="h-5 w-5" />}
      <span className="text-[11px]">
        {pending ? "Capturing photo…" : status === "failed" || broken ? "Photo failed" : "No photo"}
      </span>
    </div>
  );
}

function EvidenceCard({ detection, onOpen }: { detection: Detection; onOpen: () => void }) {
  const pct = excessPct(detection);
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      onClick={onOpen}
      className="group overflow-hidden rounded-lg border border-danger/40 bg-card text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <Photo detection={detection} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2.5 pb-2 pt-6">
          <div className="flex items-baseline justify-between gap-2">
            <span className="num text-xl font-bold text-red-400">
              {detection.scaledSpeedKmh.toFixed(1)}
              <span className="ml-0.5 text-[10px] font-normal text-white/70">km/h</span>
            </span>
            <span className="num text-[11px] font-semibold text-red-300">+{pct.toFixed(0)}%</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <div className="min-w-0">
          <div className="num text-[11px] text-foreground">{formatTime(detection.detectedAt)}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            limit {detection.limitKmh} · {detection.direction === "fwd" ? "IN→OUT" : "OUT→IN"}
            {detection.plate ? ` · ${detection.plate}` : ""}
          </div>
        </div>
        <SeverityBadge severity={detection.severity} />
      </div>
    </motion.button>
  );
}

/** Summary of today's overspeed vehicles with their camera snapshots. */
export function OverspeedEvidence() {
  const { items, isLoading } = useTodayViolations();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const photos = { ready: 0, pending: 0, failed: 0 };
    let worst = 0;
    let excessSum = 0;
    for (const d of items) {
      worst = Math.max(worst, d.scaledSpeedKmh);
      excessSum += excessPct(d);
      if (d.frame.status === "ready") photos.ready += 1;
      else if (d.frame.status === "pending") photos.pending += 1;
      else photos.failed += 1;
    }
    return {
      count: items.length,
      worst,
      avgExcess: items.length ? excessSum / items.length : 0,
      photos,
    };
  }, [items]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-3.5 w-3.5 text-danger" /> Overspeed evidence — today
        </CardTitle>
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
          <Camera className="h-3 w-3" /> phone camera snapshots
        </span>
      </CardHeader>

      <div className="grid grid-cols-2 gap-2 px-4 md:grid-cols-4">
        <Stat
          label="Violations"
          value={stats.count.toString()}
          tone={stats.count ? "text-danger" : undefined}
        />
        <Stat label="Worst speed" value={stats.count ? `${stats.worst.toFixed(1)} km/h` : "—"} />
        <Stat
          label="Avg over limit"
          value={stats.count ? `+${stats.avgExcess.toFixed(0)}%` : "—"}
        />
        <Stat
          label="Photos"
          value={`${stats.photos.ready}/${stats.count}`}
          tone={stats.photos.failed ? "text-warn" : undefined}
        />
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
            No overspeed vehicles yet today — snapshots appear here as they are captured.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <AnimatePresence initial={false}>
              {items.slice(0, GRID_SIZE).map((d) => (
                <EvidenceCard key={d.id} detection={d} onOpen={() => setSelectedId(d.id)} />
              ))}
            </AnimatePresence>
          </div>
        )}
        {items.length > GRID_SIZE ? (
          <p className="mt-2 text-right text-[11px] text-muted-foreground">
            Showing latest {GRID_SIZE} of {items.length} — see Detections for all.
          </p>
        ) : null}
      </div>

      <DetectionDrawer detectionId={selectedId} onClose={() => setSelectedId(null)} />
    </Card>
  );
}
