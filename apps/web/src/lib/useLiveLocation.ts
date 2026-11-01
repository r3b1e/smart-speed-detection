/**
 * useLiveLocation
 *
 * When the first active session fires (session:new socket event), this hook
 * automatically requests geolocation and PATCHes the device's location.
 * Admins and authorities get a one-time toast asking to allow it; plain users
 * see nothing (they don't manage devices).
 *
 * The hook also exposes a manual `triggerLocate(deviceId)` so the Map page
 * can have a dedicated "Update Gate Location" button.
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { apiPatch } from "./api";
import { getCurrentLocation, type GeoCoords, type GeoStatus } from "./geolocation";
import type { Device } from "@smart-speed/shared";

interface LocationState {
  status: GeoStatus;
  coords: GeoCoords | null;
  error: string | null;
}

interface UseLiveLocationReturn extends LocationState {
  /** Imperatively request location and PATCH the device. */
  triggerLocate: (deviceId: string) => Promise<void>;
}

export function useLiveLocation(): UseLiveLocationReturn {
  const [state, setState] = useState<LocationState>({
    status: "idle",
    coords: null,
    error: null,
  });
  const lastPatched = useRef<string | null>(null); // deviceId

  const triggerLocate = useCallback(async (deviceId: string): Promise<void> => {
    setState({ status: "pending", coords: null, error: null });
    try {
      const coords = await getCurrentLocation();
      setState({ status: "ok", coords, error: null });

      await apiPatch<{ device: Device }>(`/devices/${deviceId}/location`, {
        coordinates: [coords.lng, coords.lat],
      });

      lastPatched.current = deviceId;
      toast.success(`Gate location updated (±${Math.round(coords.accuracy)} m accuracy)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not get location";
      setState((s) => ({ ...s, status: "denied", error: message }));
      toast.error(`Location: ${message}`);
    }
  }, []);

  return { ...state, triggerLocate };
}
