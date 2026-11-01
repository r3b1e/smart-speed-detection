import type { Device, DeviceCreate } from "@smart-speed/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, LocateFixed, MapPin, Radio, RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Label } from "../components/ui/input";
import { Spinner } from "../components/ui/states";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAuth } from "../stores/auth";

interface DeviceListResponse {
  items: Device[];
  total: number;
}

interface DeviceResponse {
  device: Device;
}

interface CreateDeviceResponse extends DeviceResponse {
  apiKey: string;
}

interface Coordinates {
  latitude: string;
  longitude: string;
}

const EMPTY_COORDINATES: Coordinates = { latitude: "", longitude: "" };

function getCurrentLocation(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location services are not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          latitude: coords.latitude.toFixed(6),
          longitude: coords.longitude.toFixed(6),
        }),
      (error) => reject(new Error(error.message || "Could not read the current location.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
}

function ConnectionValue({ label, online }: { label: string; online: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={online ? "text-xs font-medium text-ok" : "text-xs text-muted-foreground"}>
        {online ? "Connected" : "Waiting"}
      </span>
    </div>
  );
}

export function DevicesPage() {
  const user = useAuth((state) => state.user);
  const queryClient = useQueryClient();
  const [name, setName] = useState("Primary Gate");
  const [address, setAddress] = useState("");
  const [limit, setLimit] = useState("40");
  const [scaleFactor, setScaleFactor] = useState("1");
  const [coordinates, setCoordinates] = useState(EMPTY_COORDINATES);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [locating, setLocating] = useState(false);
  const isAdmin = user?.role === "admin";

  const devicesQuery = useQuery({
    queryKey: ["devices", "single-gate"],
    queryFn: () => apiGet<DeviceListResponse>("/devices?page=1&limit=50"),
  });
  const gate = devicesQuery.data?.items[0];

  useEffect(() => {
    if (gate) setLimit(String(gate.speedLimitKmh));
  }, [gate?.id, gate?.speedLimitKmh]);

  const refreshDevices = () => queryClient.invalidateQueries({ queryKey: ["devices"] });

  const createGate = useMutation({
    mutationFn: (input: DeviceCreate) => apiPost<CreateDeviceResponse>("/devices", input),
    onSuccess: async (result) => {
      setCreatedApiKey(result.apiKey);
      await refreshDevices();
    },
  });

  const updateLocation = useMutation({
    mutationFn: ({ deviceId, point }: { deviceId: string; point: [number, number] }) =>
      apiPatch<DeviceResponse>(`/devices/${deviceId}`, {
        location: { coordinates: point },
      }),
    onSuccess: refreshDevices,
  });

  const updateLimit = useMutation({
    mutationFn: ({ deviceId, speedLimitKmh }: { deviceId: string; speedLimitKmh: number }) =>
      apiPatch<DeviceResponse>(`/devices/${deviceId}`, { speedLimitKmh }),
    onSuccess: refreshDevices,
  });

  const locateForRegistration = async () => {
    setLocationError(null);
    setLocating(true);
    try {
      setCoordinates(await getCurrentLocation());
    } catch (error) {
      setLocationError(errorMessage(error));
    } finally {
      setLocating(false);
    }
  };

  const registerGate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const latitude = Number(coordinates.latitude);
    const longitude = Number(coordinates.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setLocationError("Choose the current location or enter valid latitude and longitude.");
      return;
    }
    setLocationError(null);
    createGate.mutate({
      name,
      address: address.trim() || undefined,
      location: { coordinates: [longitude, latitude] },
      scaleFactor: Number(scaleFactor),
      speedLimitKmh: Number(limit),
      status: "active",
    });
  };

  const updateGateLocation = async () => {
    if (!gate) return;
    setLocationError(null);
    setLocating(true);
    try {
      const current = await getCurrentLocation();
      await updateLocation.mutateAsync({
        deviceId: gate.id,
        point: [Number(current.longitude), Number(current.latitude)],
      });
    } catch (error) {
      setLocationError(errorMessage(error));
    } finally {
      setLocating(false);
    }
  };

  const saveLimit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gate) return;
    updateLimit.mutate({ deviceId: gate.id, speedLimitKmh: Number(limit) });
  };

  const copyApiKey = async () => {
    if (!createdApiKey) return;
    await navigator.clipboard.writeText(createdApiKey);
    setCopiedKey(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Gate"
        description="One physical gate, its live connection state, speed limit, and location."
      />

      {devicesQuery.isPending ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : devicesQuery.isError ? (
        <Card role="alert" className="border-danger/40 text-sm text-danger">
          {errorMessage(devicesQuery.error)}
        </Card>
      ) : !gate ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Register the physical gate</CardTitle>
            </CardHeader>
            <CardContent>
              {isAdmin ? (
                <form className="space-y-4" onSubmit={registerGate}>
                  <div>
                    <Label htmlFor="gate-name">Gate name</Label>
                    <Input
                      id="gate-name"
                      required
                      minLength={2}
                      maxLength={80}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="gate-address">Address (optional)</Label>
                    <Input
                      id="gate-address"
                      maxLength={200}
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder="Road, district, city"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="gate-limit">Speed limit (km/h)</Label>
                      <Input
                        id="gate-limit"
                        type="number"
                        min={5}
                        max={200}
                        step={1}
                        required
                        value={limit}
                        onChange={(event) => setLimit(event.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="gate-scale">Scale factor</Label>
                      <Input
                        id="gate-scale"
                        type="number"
                        min={0.01}
                        max={1000}
                        step="any"
                        required
                        value={scaleFactor}
                        onChange={(event) => setScaleFactor(event.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <Label htmlFor="gate-latitude">Gate location</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={locateForRegistration}
                        disabled={locating}
                      >
                        {locating ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          <LocateFixed className="h-3.5 w-3.5" />
                        )}
                        Use current location
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        id="gate-latitude"
                        aria-label="Latitude"
                        type="number"
                        min={-90}
                        max={90}
                        step="any"
                        required
                        placeholder="Latitude"
                        value={coordinates.latitude}
                        onChange={(event) =>
                          setCoordinates((current) => ({
                            ...current,
                            latitude: event.target.value,
                          }))
                        }
                      />
                      <Input
                        aria-label="Longitude"
                        type="number"
                        min={-180}
                        max={180}
                        step="any"
                        required
                        placeholder="Longitude"
                        value={coordinates.longitude}
                        onChange={(event) =>
                          setCoordinates((current) => ({
                            ...current,
                            longitude: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  {locationError && (
                    <p role="alert" className="text-xs text-danger">
                      {locationError}
                    </p>
                  )}
                  {createGate.isError && (
                    <p role="alert" className="text-xs text-danger">
                      {errorMessage(createGate.error)}
                    </p>
                  )}
                  <Button type="submit" disabled={createGate.isPending}>
                    {createGate.isPending ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <Radio className="h-4 w-4" />
                    )}
                    Register single gate
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  An administrator must register the gate before it can receive data.
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="flex flex-col justify-center">
            <MapPin className="mb-3 h-5 w-5 text-primary" />
            <p className="text-sm font-medium">
              Location permission is requested only when you choose it.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Coordinates are saved with the gate and copied onto each detection for the map and
              reports.
            </p>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {devicesQuery.data.items.length > 1 && (
            <Card role="alert" className="border-warn/50 text-sm text-warn">
              Multiple gate records already exist. New registrations are blocked; remove legacy
              records before relying on single-gate reports.
            </Card>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{gate.name}</CardTitle>
                <span className="rounded border border-border px-2 py-1 text-[11px] uppercase text-muted-foreground">
                  {gate.status}
                </span>
              </CardHeader>
              <CardContent>
                <ConnectionValue label="USB bridge" online={gate.bridgeOnline} />
                <ConnectionValue label="Live camera" online={gate.cameraStatus === "ok"} />
                <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2">
                  <span className="text-xs text-muted-foreground">Location</span>
                  <span className="num text-right text-xs">
                    {gate.location.coordinates[1].toFixed(6)},{" "}
                    {gate.location.coordinates[0].toFixed(6)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-xs text-muted-foreground">Last data received</span>
                  <span className="text-right text-xs">
                    {gate.lastSeenAt ? formatDateTime(gate.lastSeenAt) : "No serial data yet"}
                  </span>
                </div>
                {gate.address && (
                  <p className="mt-2 text-xs text-muted-foreground">{gate.address}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Gate configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <form className="flex items-end gap-3" onSubmit={saveLimit}>
                  <div className="min-w-0 flex-1">
                    <Label htmlFor="active-gate-limit">Speed limit (km/h)</Label>
                    <Input
                      id="active-gate-limit"
                      type="number"
                      min={5}
                      max={200}
                      step={1}
                      required
                      value={limit}
                      onChange={(event) => setLimit(event.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                  {isAdmin && (
                    <Button type="submit" disabled={updateLimit.isPending}>
                      Apply limit
                    </Button>
                  )}
                </form>
                {updateLimit.isSuccess && (
                  <p className="text-xs text-ok">Limit saved and sent to the bridge.</p>
                )}
                {updateLimit.isError && (
                  <p role="alert" className="text-xs text-danger">
                    {errorMessage(updateLimit.error)}
                  </p>
                )}
                <div className="border-t border-border pt-4">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Displayed as latitude, longitude; stored as longitude, latitude.
                  </p>
                  {isAdmin && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={updateGateLocation}
                      disabled={locating || updateLocation.isPending}
                    >
                      {locating ? <Spinner className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                      Update from current location
                    </Button>
                  )}
                  {locationError && (
                    <p role="alert" className="mt-2 text-xs text-danger">
                      {locationError}
                    </p>
                  )}
                  {updateLocation.isSuccess && (
                    <p className="mt-2 text-xs text-ok">Gate location updated.</p>
                  )}
                  {updateLocation.isError && (
                    <p role="alert" className="mt-2 text-xs text-danger">
                      {errorMessage(updateLocation.error)}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {createdApiKey && (
        <Card className="border-ok/40">
          <CardHeader>
            <CardTitle>Bridge API key</CardTitle>
            <Check className="h-4 w-4 text-ok" />
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              Copy this once into `apps/bridge/.env` as `DEVICE_API_KEY`.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded border border-border bg-muted px-3 py-2 text-xs">
                {createdApiKey}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyApiKey()}>
                {copiedKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKey ? "Copied" : "Copy"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Button type="button" variant="ghost" size="sm" onClick={() => void devicesQuery.refetch()}>
        <RefreshCw className="h-3.5 w-3.5" /> Refresh gate status
      </Button>
    </div>
  );
}
