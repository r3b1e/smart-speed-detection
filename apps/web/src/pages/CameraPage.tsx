import type { DeviceMarker } from "@smart-speed/shared";
import { useQuery } from "@tanstack/react-query";
import { Camera, CameraOff, CheckCircle2, Loader2, Radio, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Spinner } from "../components/ui/states";
import { apiGet } from "../lib/api";
import { VISION_STREAM_TOKEN, VISION_URL, frameImageUrl } from "../lib/env";
import { cn, formatDateTime, formatRelative, formatTime } from "../lib/format";
import { getAccessToken } from "../lib/session";
import { useLive } from "../stores/live";

interface VisionStats {
  framesProcessed: number;
  framesCaptured: number;
  uploadsOk: number;
  uploadsFailed: number;
  queueDrops: number;
  cameraFlips: number;
}

interface VisionHealth {
  status: "ok" | "waiting" | "offline";
  cameraStatus: string;
  cameraSource: string;
  cameraLabel: string | null;
  ringFrames: number;
  uptimeMs: number;
  stats: VisionStats;
  version?: string;
}

const CHECKLIST = [
  "Connect the configured USB camera and wait for macOS to enumerate it",
  "Allow camera access for the vision service when macOS asks",
  "Keep the camera mounted and aimed at the single gate",
  "Connect the Arduino to USB for serial sensor readings",
];

/** Probe /health with a hard timeout so a dead service fails fast. */
async function probeVision(): Promise<VisionHealth> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`${VISION_URL}/health`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`vision health ${res.status}`);
    return (await res.json()) as VisionHealth;
  } finally {
    window.clearTimeout(timer);
  }
}

function statusTone(status: string): "ok" | "warn" | "danger" {
  if (status === "ok" || status === "online") return "ok";
  if (status === "waiting") return "warn";
  return "danger";
}

function StatusDot({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        tone === "ok" && "bg-ok",
        tone === "warn" && "animate-pulse bg-warn",
        tone === "danger" && "bg-danger"
      )}
      aria-label={status}
    />
  );
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Bottom-left HUD: latest live detection + its frame capture status. */
function LiveOverlay() {
  const latest = useLive((s) => s.latest);
  const frame = useLive((s) => (latest ? s.frames[latest.id] : undefined));
  if (!latest) {
    return (
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/60 px-3 py-1.5 text-[11px] text-white/80 backdrop-blur-sm">
        waiting for the next detection…
      </div>
    );
  }
  const frameStatus = frame?.status ?? latest.frame.status;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-3 rounded-lg bg-black/70 px-3 py-2 text-white backdrop-blur-sm">
      <div>
        <span
          className={cn("num text-2xl font-bold", latest.overspeed ? "text-danger" : "text-ok")}
        >
          {latest.scaledSpeedKmh.toFixed(0)}
        </span>
        <span className="num ml-1 text-[10px] text-white/70">/ {latest.limitKmh} km/h</span>
        <p className="num text-[10px] text-white/70">
          {latest.plate ?? "untagged"} · {latest.deviceName ?? latest.deviceId} ·{" "}
          {formatTime(latest.detectedAt)}
        </p>
      </div>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          frameStatus === "ready" && "bg-ok/80 text-black",
          frameStatus === "pending" && "bg-warn/80 text-black",
          frameStatus === "failed" && "bg-danger text-white",
          frameStatus === "skipped" && "bg-muted text-muted-foreground"
        )}
      >
        frame {frameStatus}
      </span>
    </div>
  );
}

/** Honest fallback when the service or configured USB camera is unreachable. */
function WaitingPanel({ probeFailed, onRetry }: { probeFailed: boolean; onRetry: () => void }) {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-warn/40 bg-warn/10">
        {probeFailed ? (
          <CameraOff className="h-6 w-6 text-warn" />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-warn" />
        )}
      </span>
      <div>
        <p className="text-sm font-semibold">
          {probeFailed
            ? "Vision service unreachable"
            : "camera_waiting — configured USB camera not attached"}
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          {probeFailed
            ? "Start it with pnpm dev:vision, then connect the configured USB camera."
            : "The service is up but the configured USB camera is not open. No other camera is used as a fallback."}
        </p>
      </div>
      <div className="w-full max-w-md rounded-lg border border-border bg-muted/40 p-3 text-left">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Camera connection checklist
        </p>
        <ul className="space-y-1 text-[11px] text-muted-foreground">
          {CHECKLIST.map((item) => (
            <li key={item} className="flex gap-1.5">
              <span className="text-warn">›</span> {item}
            </li>
          ))}
        </ul>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" /> Retry now
      </Button>
    </div>
  );
}

function Counter({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2 text-center">
      <p className={cn("num text-lg font-bold", warn && value > 0 && "text-warn")}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

/** Latest capture: thumbnail + frame status for the newest detection. */
function LatestCapture() {
  const latest = useLive((s) => s.latest);
  const frame = useLive((s) => (latest ? s.frames[latest.id] : undefined));
  const thumb = latest ? frameImageUrl(latest.frame.thumbFileId, getAccessToken()) : null;
  const status = frame?.status ?? latest?.frame.status ?? "skipped";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Latest capture</span>
          <Badge tone={status === "ready" ? "ok" : status === "failed" ? "danger" : "warn"}>
            {status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!latest ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            Waiting for a physical gate reading over USB serial.
          </p>
        ) : (
          <div className="flex gap-3">
            <div className="h-20 w-28 shrink-0 overflow-hidden rounded border border-border bg-muted">
              {thumb && status === "ready" ? (
                <img src={thumb} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                  {status === "pending" ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <CameraOff className="h-4 w-4" />
                  )}
                </span>
              )}
            </div>
            <div className="min-w-0 space-y-0.5 text-xs">
              <p className="num font-bold">
                {latest.scaledSpeedKmh.toFixed(0)} / {latest.limitKmh} km/h
              </p>
              <p className="truncate text-muted-foreground">
                {latest.plate ?? "untagged"} · {latest.deviceName ?? latest.deviceId}
              </p>
              <p className="num text-muted-foreground">{formatDateTime(latest.detectedAt)}</p>
              <p className="text-[11px] text-muted-foreground">
                {status === "ready"
                  ? "frame uploaded by vision"
                  : status === "pending"
                    ? "waiting for vision /capture…"
                    : status === "skipped"
                      ? "capture skipped: speed was within the limit"
                      : "capture failed — retry from the detection drawer"}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CameraPage() {
  const system = useLive((s) => s.system);
  const socketCamera = system?.cameraStatus ?? null;
  const [streamKey, setStreamKey] = useState(0);
  const [streamBroken, setStreamBroken] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const {
    data: health,
    error: probeError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["vision-health"],
    queryFn: probeVision,
    refetchInterval: 10_000,
    retry: 1,
    staleTime: 5_000,
  });

  // A healthy probe after a broken stream remounts the MJPEG <img>.
  const probeOk = health !== undefined && !probeError;
  useEffect(() => {
    if (probeOk && streamBroken) {
      setStreamBroken(false);
      setStreamKey((k) => k + 1);
    }
  }, [probeOk, streamBroken]);

  // tick for uptime display
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const stations = useQuery({
    queryKey: ["map-devices"],
    queryFn: () => apiGet<{ markers: DeviceMarker[] }>("/map/devices"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const cameraStatus = health?.status ?? (probeOk ? socketCamera : null) ?? "offline";
  const label =
    health?.cameraLabel ??
    (health?.cameraSource === "ip" ? health.cameraSource : "continuity camera");
  const stats = health?.stats;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Camera"
        description="iPhone Continuity Camera — live preview, capture diagnostics"
        actions={
          <div className="flex items-center gap-2">
            <Badge
              tone={
                statusTone(cameraStatus) === "ok"
                  ? "ok"
                  : statusTone(cameraStatus) === "warn"
                    ? "warn"
                    : "danger"
              }
            >
              <StatusDot status={cameraStatus} />
              camera {cameraStatus}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              refresh
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="relative aspect-video w-full bg-black">
              {probeOk && !streamBroken ? (
                <>
                  <img
                    key={streamKey}
                    src={`${VISION_URL}/live?token=${encodeURIComponent(VISION_STREAM_TOKEN)}`}
                    alt="iPhone camera live preview"
                    className="h-full w-full object-cover"
                    onError={() => setStreamBroken(true)}
                  />
                  <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/90">
                    <Radio className="h-3 w-3 animate-pulse text-danger" /> live · mjpeg
                  </span>
                  <LiveOverlay />
                </>
              ) : (
                <WaitingPanel
                  probeFailed={Boolean(probeError) || health === undefined}
                  onRetry={() => {
                    setStreamBroken(false);
                    setStreamKey((k) => k + 1);
                    void refetch();
                  }}
                />
              )}
            </div>
          </Card>

          <LatestCapture />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Vision service</span>
                <Badge tone={probeOk ? "ok" : "danger"}>
                  {probeOk ? "connected" : "unreachable"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <span className="text-muted-foreground">camera</span>
                <span className="flex items-center gap-2 font-medium">
                  <Camera className="h-3.5 w-3.5" /> {label}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">source</span>
                <span className="num">{health?.cameraSource ?? "continuity"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ring buffer</span>
                <span className="num">{health?.ringFrames ?? 0} frames</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">uptime</span>
                <span className="num">{health ? fmtUptime(health.uptimeMs) : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">last heartbeat</span>
                <span className="num">
                  {system?.components.find((c) => c.name === "vision")?.lastSeenAt
                    ? formatRelative(
                        system.components.find((c) => c.name === "vision")?.lastSeenAt ?? null
                      )
                    : "—"}
                </span>
              </div>

              {stats ? (
                <div className="grid grid-cols-3 gap-2 pt-2">
                  <Counter label="frames read" value={stats.framesProcessed} />
                  <Counter label="captured" value={stats.framesCaptured} />
                  <Counter label="uploads ok" value={stats.uploadsOk} />
                  <Counter label="upload fail" value={stats.uploadsFailed} warn />
                  <Counter label="queue drops" value={stats.queueDrops} warn />
                  <Counter label="cam flips" value={stats.cameraFlips} />
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 pt-3 text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5" /> waiting for first probe…
                </div>
              )}
              <p className="pt-1 text-[10px] text-muted-foreground" key={now}>
                refreshed {formatRelative(new Date().toISOString())}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Station cameras</span>
                <Badge tone="muted">{stations.data?.markers.length ?? 0}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(stations.data?.markers ?? []).map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs"
                >
                  <span className="min-w-0 truncate font-medium">{m.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <StatusDot status={m.bridgeOnline ? "ok" : "offline"} /> bridge
                    </span>
                    <span className="flex items-center gap-1">
                      <StatusDot status={m.cameraStatus} />
                      {m.cameraStatus}
                    </span>
                  </span>
                </div>
              ))}
              {(stations.data?.markers.length ?? 0) === 0 ? (
                <p className="py-2 text-center text-[11px] text-muted-foreground">
                  No stations registered yet.
                </p>
              ) : null}
              <p className="flex items-center gap-1.5 pt-1 text-[10px] text-muted-foreground">
                <CheckCircle2 className="h-3 w-3" /> camera status mirrors vision heartbeats
                (watchdog marks offline after 15 s).
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
