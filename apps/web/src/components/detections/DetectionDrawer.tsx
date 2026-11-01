import type { AuditLog, Detection, FineStatus, Paged, ReviewStatus } from "@smart-speed/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Car, Check, FileClock, ImageOff, Maximize2, RefreshCw, X, XCircle } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import { toast } from "sonner";
import { SeverityBadge, Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { Input, Label, Textarea } from "../ui/input";
import { Select } from "../ui/select";
import { EmptyState, ErrorState, Spinner } from "../ui/states";
import { apiGet, apiPost } from "../../lib/api";
import { frameImageUrl } from "../../lib/env";
import { cn, formatDateTime } from "../../lib/format";
import { getAccessToken } from "../../lib/session";
import { useAuth } from "../../stores/auth";
import { useLive } from "../../stores/live";

/** Static dark-tile preview of where the crossing happened. */
function MiniMap({ coordinates }: { coordinates: [number, number] }) {
  const [lng, lat] = coordinates;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <MapContainer
        center={[lat, lng]}
        zoom={15}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        zoomControl={false}
        keyboard={false}
        attributionControl={false}
        className="h-40 w-full"
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <Marker position={[lat, lng]} />
      </MapContainer>
      <p className="border-t border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
        detection point · {lat.toFixed(5)}, {lng.toFixed(5)}
      </p>
    </div>
  );
}

/** Admin-only: recent audit entries recorded against this detection. */
function AuditTrail({ detectionId }: { detectionId: string }) {
  const role = useAuth((s) => s.user?.role);
  const isAdmin = role === "admin";
  const { data } = useQuery({
    queryKey: ["audit", "detection", detectionId],
    queryFn: () => apiGet<Paged<AuditLog>>("/audit?entity=detection&limit=200"),
    enabled: isAdmin,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  if (!isAdmin) return null;

  const rows = (data?.items ?? []).filter((l) => l.entityId === detectionId).slice(0, 6);
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <FileClock className="h-3 w-3" /> Audit trail
      </p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {data ? "No recorded changes yet." : "Loading…"}
        </p>
      ) : (
        <ul className="space-y-1 text-[11px] text-muted-foreground">
          {rows.map((l) => (
            <li key={l.id} className="num truncate">
              {formatDateTime(l.at)} · {l.actorName ?? "system"} · {l.action}
              {l.meta ? ` · ${JSON.stringify(l.meta)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-right text-xs font-medium", mono && "num")}>{value}</span>
    </div>
  );
}

function FrameBlock({ detection }: { detection: Detection }) {
  const [zoom, setZoom] = useState(false);
  const qc = useQueryClient();
  const role = useAuth((s) => s.user?.role);
  const canRetry = role === "admin" || role === "authority";
  const token = getAccessToken();
  const src = frameImageUrl(detection.frame.fileId, token);

  const retryMut = useMutation({
    mutationFn: () =>
      apiPost<{ detection: Detection }>(`/detections/${detection.id}/frame/retry`, {}),
    onSuccess: () => {
      toast.success("Frame capture requested");
      void qc.invalidateQueries({ queryKey: ["detection", detection.id] });
      void qc.invalidateQueries({ queryKey: ["detections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retryButton =
    canRetry && detection.overspeed ? (
      <Button
        size="sm"
        variant="outline"
        disabled={retryMut.isPending}
        onClick={() => retryMut.mutate()}
      >
        <RefreshCw className="h-3.5 w-3.5" /> Retry capture
      </Button>
    ) : null;

  if (detection.frame.status === "skipped") {
    return (
      <div className="space-y-2">
        <EmptyState
          icon={<ImageOff className="h-6 w-6" />}
          title="Capture not requested"
          description="A frame is captured only when the vehicle exceeds the speed limit."
        />
        {retryButton}
      </div>
    );
  }

  if (detection.frame.status === "failed") {
    return (
      <div className="space-y-2">
        <EmptyState
          icon={<ImageOff className="h-6 w-6" />}
          title="Frame capture failed"
          description="The camera service could not deliver a snapshot for this detection."
        />
        {retryButton}
      </div>
    );
  }
  if (detection.frame.status === "pending" || !src) {
    return (
      <div className="flex h-52 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground">
        <Spinner className="h-4 w-4" />
        <p className="text-xs">Waiting for frame…</p>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="group relative block w-full overflow-hidden rounded-lg border border-border"
        onClick={() => setZoom(true)}
        aria-label="Zoom frame"
      >
        <img src={src} alt="Detection frame" className="max-h-64 w-full object-cover" />
        <span className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
      </button>
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent wide className="max-w-4xl border-0 bg-black/90 p-2">
          <img
            src={src}
            alt="Detection frame enlarged"
            className="max-h-[80vh] w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReviewActions({ detection }: { detection: Detection }) {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const canReview = user?.role === "admin" || user?.role === "authority";
  const [note, setNote] = useState(detection.review.note ?? "");
  const [plate, setPlate] = useState(detection.plate ?? "");
  const [fineAmount, setFineAmount] = useState(detection.fine ? String(detection.fine.amount) : "");

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ["detection", detection.id] });
    void qc.invalidateQueries({ queryKey: ["detections"] });
  };

  const reviewMut = useMutation({
    mutationFn: (status: ReviewStatus) =>
      apiPost<{ detection: Detection }>(`/detections/${detection.id}/review`, {
        status,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Review saved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tagMut = useMutation({
    mutationFn: () =>
      apiPost<{ detection: Detection }>(`/detections/${detection.id}/tag`, { plate }),
    onSuccess: () => {
      toast.success("Plate tagged");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fineMut = useMutation({
    mutationFn: (status: FineStatus) =>
      apiPost<{ detection: Detection }>(`/detections/${detection.id}/fine`, {
        amount: Number(fineAmount || 0),
        status,
      }),
    onSuccess: () => {
      toast.success("Fine updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canReview) {
    return detection.review.status !== "pending" ? (
      <p className="text-xs text-muted-foreground">
        Reviewed as <b>{detection.review.status}</b>.
      </p>
    ) : null;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={detection.review.status === "confirmed" ? "danger" : "outline"}
          disabled={reviewMut.isPending}
          onClick={() => reviewMut.mutate("confirmed")}
        >
          <Check className="h-3.5 w-3.5" /> Confirm
        </Button>
        <Button
          size="sm"
          variant={detection.review.status === "dismissed" ? "ok" : "outline"}
          disabled={reviewMut.isPending}
          onClick={() => reviewMut.mutate("dismissed")}
        >
          <XCircle className="h-3.5 w-3.5" /> Dismiss
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={reviewMut.isPending}
          onClick={() => reviewMut.mutate("pending")}
        >
          Reset
        </Button>
      </div>

      <div>
        <Label htmlFor="review-note">Note</Label>
        <Textarea
          id="review-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional review note…"
          maxLength={500}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="plate">Tag plate</Label>
          <div className="flex gap-1.5">
            <Input
              id="plate"
              className="num uppercase"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="MH 12 AB 1234"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={plate.trim().length < 2 || tagMut.isPending}
              onClick={() => tagMut.mutate()}
            >
              Tag
            </Button>
          </div>
        </div>
        <div>
          <Label htmlFor="fine">Fine (₹)</Label>
          <div className="flex gap-1.5">
            <Input
              id="fine"
              type="number"
              min={0}
              value={fineAmount}
              onChange={(e) => setFineAmount(e.target.value)}
              placeholder="500"
            />
            <Select
              aria-label="Fine status"
              value={detection.fine?.status ?? "unpaid"}
              onChange={(e) => fineMut.mutate(e.target.value as FineStatus)}
            >
              <option value="unpaid">unpaid</option>
              <option value="paid">paid</option>
              <option value="waived">waived</option>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DetectionDrawer({
  detectionId,
  onClose,
}: {
  detectionId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const liveDetection = useLive((s) =>
    detectionId ? s.recent.find((d) => d.id === detectionId) : undefined
  );
  const frameUpdate = useLive((s) => (detectionId ? s.frames[detectionId] : undefined));

  const { data, error, isLoading } = useQuery({
    queryKey: ["detection", detectionId],
    queryFn: () => apiGet<{ detection: Detection }>(`/detections/${detectionId ?? ""}`),
    enabled: detectionId !== null,
  });

  useEffect(() => {
    if (detectionId) {
      void qc.invalidateQueries({ queryKey: ["detection", detectionId] });
    }
  }, [detectionId, qc]);

  const base = liveDetection ?? data?.detection ?? null;
  const detection: Detection | null = base
    ? frameUpdate
      ? {
          ...base,
          frame: {
            ...base.frame,
            status: frameUpdate.status,
            capturedAt: frameUpdate.capturedAt ?? base.frame.capturedAt,
          },
        }
      : base
    : null;

  return (
    <AnimatePresence>
      {detectionId ? (
        <>
          <motion.button
            type="button"
            aria-label="Close detection detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-card p-5 shadow-2xl scrollbar-thin"
            role="dialog"
            aria-label="Detection detail"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  detection
                </p>
                <p className="num text-sm font-semibold">{detectionId}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {isLoading && !detection ? (
              <div className="flex justify-center py-16">
                <Spinner className="h-5 w-5 text-muted-foreground" />
              </div>
            ) : error ? (
              <ErrorState message="Detection not found (or not visible to your role)." />
            ) : detection ? (
              <div className="space-y-4">
                <FrameBlock detection={detection} />

                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "num text-3xl font-bold",
                        detection.overspeed ? "text-danger" : "text-ok"
                      )}
                    >
                      {detection.scaledSpeedKmh.toFixed(1)}
                    </span>
                    <span className="num text-xs text-muted-foreground">km/h scaled</span>
                  </div>
                  <div className="flex gap-1.5">
                    <SeverityBadge severity={detection.severity} />
                    <Badge tone={detection.overspeed ? "danger" : "ok"}>
                      {detection.overspeed ? "over limit" : "ok"}
                    </Badge>
                  </div>
                </div>

                <div>
                  <Row label="Device" value={detection.deviceName ?? detection.deviceId} />
                  <Row
                    label="Measured"
                    value={`${detection.measuredSpeedKmh.toFixed(1)} km/h`}
                    mono
                  />
                  <Row label="Limit" value={`${detection.limitKmh} km/h`} mono />
                  <Row label="Arduino buzzer" value={detection.deviceOver ? "sounded" : "silent"} />
                  <Row
                    label="Direction"
                    value={detection.direction === "fwd" ? "forward →" : "reverse ←"}
                  />
                  <Row label="Plate" value={detection.plate ?? "untagged"} mono />
                  <Row label="Source" value={detection.source} />
                  <Row label="Detected" value={formatDateTime(detection.detectedAt)} mono />
                  <Row label="Frame" value={detection.frame.status} />
                  <Row
                    label="Location"
                    value={`${detection.location.coordinates[1].toFixed(4)}, ${detection.location.coordinates[0].toFixed(4)}`}
                    mono
                  />
                </div>

                <MiniMap coordinates={detection.location.coordinates} />

                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Timeline
                  </p>
                  <ul className="space-y-1 text-[11px] text-muted-foreground">
                    <li className="num">gate crossed · {formatDateTime(detection.detectedAt)}</li>
                    <li className="num">
                      received by bridge · {formatDateTime(detection.receivedAt)}
                    </li>
                    {detection.frame.capturedAt ? (
                      <li className="num">
                        frame captured · {formatDateTime(detection.frame.capturedAt)}
                      </li>
                    ) : null}
                    {detection.review.at ? (
                      <li className="num">reviewed · {formatDateTime(detection.review.at)}</li>
                    ) : null}
                  </ul>
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Review workflow
                  </p>
                  <ReviewActions detection={detection} />
                </div>

                <AuditTrail detectionId={detection.id} />

                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Car className="h-3 w-3" /> vehicle uid:{" "}
                  <span className="num">{detection.vehicleUid}</span>
                </p>
              </div>
            ) : null}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
