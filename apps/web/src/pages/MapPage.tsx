import type {
  DeviceMarker,
  GeoJsonFeatureCollection,
  MapDetectionProps,
} from "@smart-speed/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { LocateFixed, Navigation, Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { apiGet } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { formatAccuracy } from "../lib/geolocation";
import { useLiveLocation } from "../lib/useLiveLocation";
import { useAuth } from "../stores/auth";
import { useLive } from "../stores/live";

// ── types ────────────────────────────────────────────────────────────────────

interface DeviceMarkersResponse {
  markers: DeviceMarker[];
}

type OverspeedFilter = "all" | "true" | "false";

// ── Live-ping animation for new detections ───────────────────────────────────

function LivePing({ center }: { center: [number, number] }) {
  const map = useMap();
  const markerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    const m = L.circleMarker(center, {
      radius: 8,
      color: "#f43f5e",
      fillColor: "#f43f5e",
      fillOpacity: 0.8,
      weight: 2,
    }).addTo(map);
    markerRef.current = m;

    // Animate outward pulse then remove
    let r = 8;
    const timer = setInterval(() => {
      r += 2;
      m.setRadius(r);
      m.setStyle({ fillOpacity: Math.max(0, 0.8 - (r - 8) * 0.06) });
      if (r > 24) {
        clearInterval(timer);
        m.remove();
      }
    }, 40);

    return () => {
      clearInterval(timer);
      m.remove();
    };
  }, [map, center]);

  return null;
}

// ── Location panel ────────────────────────────────────────────────────────────

interface LocationPanelProps {
  deviceId: string | undefined;
  canUpdate: boolean;
}

function LocationPanel({ deviceId, canUpdate }: LocationPanelProps) {
  const { status, coords, error, triggerLocate } = useLiveLocation();
  const activeSessions = useLive((s) => s.activeSessions);
  const hasActiveSession = Object.keys(activeSessions).length > 0;

  if (!canUpdate) return null;

  return (
    <AnimatePresence>
      {(hasActiveSession || status !== "idle") && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="mb-3 flex flex-wrap items-center gap-3"
        >
          {hasActiveSession && (
            <span className="flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-3 py-1 text-xs font-medium text-ok">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
              </span>
              <Radio className="h-3 w-3" />
              Live scanning active
            </span>
          )}

          {deviceId && (
            <Button
              size="sm"
              variant="outline"
              disabled={status === "pending"}
              onClick={() => void triggerLocate(deviceId)}
              className="gap-1.5"
            >
              {status === "pending" ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <LocateFixed className="h-3.5 w-3.5" />
              )}
              {status === "pending" ? "Locating…" : "Update gate location"}
            </Button>
          )}

          {status === "ok" && coords && (
            <span className="text-xs text-muted-foreground">
              <Navigation className="mr-1 inline h-3 w-3 text-ok" />
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} · {formatAccuracy(coords.accuracy)}
            </span>
          )}

          {error && (
            <span className="text-xs text-danger">{error}</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Auto-locate on session start ──────────────────────────────────────────────

function AutoLocate({
  deviceId,
  triggerLocate,
  canUpdate,
}: {
  deviceId: string | undefined;
  triggerLocate: (id: string) => Promise<void>;
  canUpdate: boolean;
}) {
  const activeSessions = useLive((s) => s.activeSessions);
  const triggered = useRef(false);

  useEffect(() => {
    if (!canUpdate || !deviceId || triggered.current) return;
    const hasActive = Object.keys(activeSessions).length > 0;
    if (hasActive) {
      triggered.current = true;
      void triggerLocate(deviceId);
    }
  }, [activeSessions, deviceId, canUpdate, triggerLocate]);

  return null;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function MapPage() {
  const [overspeed, setOverspeed] = useState<OverspeedFilter>("all");
  const queryClient = useQueryClient();
  const user = useAuth((s) => s.user);
  const canUpdate = user?.role === "admin" || user?.role === "authority";
  const latestDetection = useLive((s) => s.latest);
  const deviceBump = useLive((s) => s.deviceBump);
  const { triggerLocate } = useLiveLocation();

  // Refetch device markers when bridge comes online
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["map", "devices"] });
  }, [deviceBump, queryClient]);

  const devices = useQuery({
    queryKey: ["map", "devices"],
    queryFn: () => apiGet<DeviceMarkersResponse>("/map/devices"),
    refetchInterval: 15_000,
  });
  const detections = useQuery({
    queryKey: ["map", "detections", overspeed],
    queryFn: () =>
      apiGet<GeoJsonFeatureCollection<MapDetectionProps>>(
        `/map/detections?limit=1000${overspeed === "all" ? "" : `&overspeed=${overspeed}`}`
      ),
    refetchInterval: 15_000,
  });

  // Refresh detections when a new one arrives live
  useEffect(() => {
    if (latestDetection) {
      void queryClient.invalidateQueries({ queryKey: ["map", "detections"] });
    }
  }, [latestDetection, queryClient]);

  const markers = devices.data?.markers ?? [];
  const primaryDevice = markers[0];
  const center: [number, number] = primaryDevice
    ? [primaryDevice.lat, primaryDevice.lng]
    : [20, 0];

  // Track latest overspeed detection for live ping
  const [pingCenter, setPingCenter] = useState<[number, number] | null>(null);
  const [pingKey, setPingKey] = useState(0);

  useEffect(() => {
    if (latestDetection?.overspeed) {
      const [lng, lat] = latestDetection.location.coordinates;
      setPingCenter([lat, lng]);
      setPingKey((k) => k + 1);
    }
  }, [latestDetection]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Live Map"
        description="Gate location and recent crossings. Location updates automatically when scanning starts."
        actions={
          <Select
            aria-label="Detection filter"
            value={overspeed}
            onChange={(event) => setOverspeed(event.target.value as OverspeedFilter)}
            className="w-40"
          >
            <option value="all">All detections</option>
            <option value="true">Overspeed only</option>
            <option value="false">Within limit</option>
          </Select>
        }
      />

      {/* Location panel — shown when scanning is active or location was just fetched */}
      <LocationPanel deviceId={primaryDevice?.id} canUpdate={canUpdate} />

      {/* Auto-locate when session fires (admin/authority only) */}
      {canUpdate && primaryDevice && (
        <AutoLocate
          deviceId={primaryDevice.id}
          triggerLocate={triggerLocate}
          canUpdate={canUpdate}
        />
      )}

      {devices.isPending || detections.isPending ? (
        <div className="flex min-h-64 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : devices.isError || detections.isError ? (
        <ErrorState
          message="Could not load map data."
          retry={() => {
            void devices.refetch();
            void detections.refetch();
          }}
        />
      ) : markers.length === 0 ? (
        <EmptyState
          title="Gate location not registered"
          description="Register the gate and allow location access to place it on the map."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <MapContainer
            key={center.join(",")}
            center={center}
            zoom={14}
            scrollWheelZoom
            className="h-[min(70vh,720px)] min-h-[360px] w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />

            {/* Device/gate markers */}
            {markers.map((marker) => (
              <CircleMarker
                key={marker.id}
                center={[marker.lat, marker.lng]}
                radius={10}
                pathOptions={{
                  color: marker.bridgeOnline ? "#22d3ee" : "#64748b",
                  fillColor: marker.bridgeOnline ? "#22d3ee" : "#64748b",
                  fillOpacity: 0.9,
                  weight: 2,
                }}
              >
                <Popup>
                  <strong>{marker.name}</strong>
                  <br />
                  Limit {marker.speedLimitKmh} km/h
                  {marker.scaleFactor !== 1 && ` · ×${marker.scaleFactor} scale`}
                  <br />
                  Bridge {marker.bridgeOnline ? "🟢 connected" : "⚫ offline"}
                  <br />
                  Camera {marker.cameraStatus === "ok" ? "🟢 ready" : `⚫ ${marker.cameraStatus}`}
                </Popup>
              </CircleMarker>
            ))}

            {/* Detection markers */}
            {detections.data?.features.map((feature) => {
              const [lng, lat] = feature.geometry.coordinates;
              const item = feature.properties;
              const color = item.overspeed ? "#fb7185" : "#34d399";
              return (
                <CircleMarker
                  key={item.id}
                  center={[lat, lng]}
                  radius={item.overspeed ? 6 : 4}
                  pathOptions={{ color, fillColor: color, fillOpacity: 0.72, weight: 1 }}
                >
                  <Popup>
                    <strong>{item.scaledSpeedKmh.toFixed(1)} km/h</strong> / {item.limitKmh}
                    <br />
                    {item.overspeed ? "⚠️ Over limit" : "✓ Within limit"} · {item.severity}
                    <br />
                    {item.plate ?? "Unidentified vehicle"}
                    <br />
                    {formatDateTime(item.detectedAt)}
                  </Popup>
                </CircleMarker>
              );
            })}

            {/* Live ping on latest overspeed */}
            {pingCenter && <LivePing key={pingKey} center={pingCenter} />}
          </MapContainer>

          <div className="flex flex-wrap gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <i className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Gate (online)
            </span>
            <span className="flex items-center gap-2">
              <i className="h-2.5 w-2.5 rounded-full bg-slate-500" /> Gate (offline)
            </span>
            <span className="flex items-center gap-2">
              <i className="h-2.5 w-2.5 rounded-full bg-rose-400" /> Overspeed
            </span>
            <span className="flex items-center gap-2">
              <i className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Within limit
            </span>
            <span className="ml-auto">
              {detections.data?.features.length.toLocaleString() ?? 0} crossings · auto-refreshes
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
