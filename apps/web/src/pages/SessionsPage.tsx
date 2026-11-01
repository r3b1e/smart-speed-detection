import type { Session, SessionQuery } from "@smart-speed/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Camera,
  Car,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gauge,
  MapPin,
  Radio,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { apiGet, qs } from "../lib/api";
import { cn, formatDateTime } from "../lib/format";
import { useLive, type LiveSession } from "../stores/live";

// ── helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "ongoing";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function violationRate(s: { detectionCount: number; overspeedCount: number }): string {
  if (s.detectionCount === 0) return "—";
  return `${Math.round((s.overspeedCount / s.detectionCount) * 100)}%`;
}

// ── Live session banner ──────────────────────────────────────────────────────

function LiveBanner({ sessions }: { sessions: Record<string, LiveSession> }) {
  const list = Object.values(sessions);
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((s) => (
        <motion.div
          key={s.sessionId}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-full border border-ok/40 bg-ok/10 px-3 py-1 text-xs font-medium text-ok"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
          </span>
          <Radio className="h-3 w-3" />
          {s.deviceName} · {s.detectionCount} detected · {s.overspeedCount} overspeed
        </motion.div>
      ))}
    </div>
  );
}

// ── Session card ─────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: Session }) {
  const isActive = session.status === "active";
  const rate = violationRate(session);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
    >
      <Card
        className={cn(
          "transition-all duration-200",
          isActive && "border-ok/30 ring-1 ring-ok/20"
        )}
      >
        {/* Header row */}
        <CardHeader>
          <div className="flex items-center gap-2">
            {isActive ? (
              <span className="flex items-center gap-1.5 rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-ok">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" />
                </span>
                Live
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                <CheckCircle className="h-3 w-3" /> Completed
              </span>
            )}
            <CardTitle className="flex-1 truncate">
              {session.deviceName ?? session.deviceId}
            </CardTitle>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            Boot {session.bootId.slice(0, 8)}
          </span>
        </CardHeader>

        <CardContent>
          {/* Stats grid */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatPill
              icon={<Car className="h-3.5 w-3.5" />}
              label="Vehicles"
              value={String(session.detectionCount)}
            />
            <StatPill
              icon={<TriangleAlert className="h-3.5 w-3.5 text-danger" />}
              label="Overspeed"
              value={String(session.overspeedCount)}
              danger={session.overspeedCount > 0}
            />
            <StatPill
              icon={<Gauge className="h-3.5 w-3.5" />}
              label="Max speed"
              value={session.maxSpeed > 0 ? `${session.maxSpeed.toFixed(0)} km/h` : "—"}
            />
            <StatPill
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Avg speed"
              value={session.avgSpeed > 0 ? `${session.avgSpeed.toFixed(1)} km/h` : "—"}
            />
          </div>

          {/* Detail row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDateTime(session.startedAt)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 opacity-50" />
              {formatDuration(session.duration)}
            </span>
            {session.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {session.location.coordinates[1].toFixed(4)},{" "}
                {session.location.coordinates[0].toFixed(4)}
              </span>
            )}
            {rate !== "—" && (
              <span
                className={cn(
                  "font-semibold",
                  parseInt(rate) > 30 ? "text-danger" : "text-muted-foreground"
                )}
              >
                {rate} violation rate
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function StatPill({
  icon,
  label,
  value,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-2">
      <div className={cn("flex items-center gap-1 text-muted-foreground", danger && "text-danger")}>
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <span className={cn("num text-sm font-semibold", danger && "text-danger")}>{value}</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export function SessionsPage() {
  const queryClient = useQueryClient();
  const activeSessions = useLive((s) => s.activeSessions);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "completed">("");

  const params: Partial<SessionQuery> = {
    page,
    limit: PAGE_SIZE,
    status: statusFilter || undefined,
  };

  const query = useQuery({
    queryKey: ["sessions", params],
    queryFn: () =>
      apiGet<{ items: Session[]; total: number; pages: number }>(`/sessions${qs(params)}`),
    refetchInterval: 15_000,
  });

  // Refresh list when a live session is updated
  const activeSessionCount = Object.keys(activeSessions).length;
  const [prevCount, setPrevCount] = useState(activeSessionCount);
  if (activeSessionCount !== prevCount) {
    setPrevCount(activeSessionCount);
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
  }

  const sessions = query.data?.items ?? [];
  const totalPages = query.data?.pages ?? 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Scanning Sessions"
        description="Each Arduino boot starts a new session. Statistics are updated in real time."
      />

      <LiveBanner sessions={activeSessions} />

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="min-w-36">
            <span className="mb-1 block text-xs text-muted-foreground">Status</span>
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as "" | "active" | "completed");
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </Select>
          </label>
        </CardContent>
      </Card>

      {/* Content */}
      {query.isError ? (
        <ErrorState message="Could not load sessions." retry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<Camera className="h-6 w-6" />}
          title="No sessions yet"
          description="Scanning sessions are created automatically when the Arduino bridge connects and sends detections."
        />
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-3">
            {sessions.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
