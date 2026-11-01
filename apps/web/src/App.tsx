import { useQuery, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Settings, Vehicle } from "@smart-speed/shared";
import { useEffect, useRef } from "react";
import { Toaster, toast } from "sonner";
import { Spinner } from "./components/ui/states";
import { apiGet } from "./lib/api";
import { playAlertSound } from "./lib/sound";
import { AppRoutes } from "./router";
import { useAuth } from "./stores/auth";
import { useLive } from "./stores/live";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

/** Overspeed toasts + optional alert sound; keeps live analytics fresh. */
function AppEffects() {
  const alertSeq = useLive((s) => s.alertSeq);
  const lastAlert = useLive((s) => s.lastAlert);
  const authed = useAuth((s) => s.status === "authed");
  const seen = useRef(0);

  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ settings: Settings }>("/settings"),
    enabled: authed,
    staleTime: 60_000,
  });

  const role = useAuth((s) => s.user?.role);
  const { data: vehicleData } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => apiGet<{ items: Vehicle[] }>("/vehicles"),
    enabled: authed && role === "user",
    staleTime: 60_000,
  });

  // mirror the server's plate scope for plain users (live socket feed only)
  useEffect(() => {
    if (!authed) return;
    if (role === "user" && vehicleData) {
      useLive.getState().setPlateScope(vehicleData.items.map((v) => v.plate));
    } else if (role !== "user") {
      useLive.getState().setPlateScope(null);
    }
  }, [authed, role, vehicleData]);

  useEffect(() => {
    if (alertSeq === 0 || alertSeq === seen.current || !lastAlert) return;
    seen.current = alertSeq;
    toast.error(`Overspeed · ${lastAlert.scaledSpeedKmh.toFixed(0)} km/h`, {
      description: `${lastAlert.deviceName} · limit ${lastAlert.limitKmh} km/h${
        lastAlert.plate ? ` · ${lastAlert.plate}` : ""
      }`,
      duration: 6000,
      action: { label: "View", onClick: () => (window.location.href = "/detections") },
    });
    if (settingsData?.settings.alertSound) playAlertSound();
  }, [alertSeq, lastAlert, settingsData]);

  useEffect(() => {
    if (!authed) return;
    return useLive.subscribe((state, prev) => {
      if (state.recent.length > prev.recent.length) {
        void queryClient.invalidateQueries({ queryKey: ["summary"] });
        void queryClient.invalidateQueries({ queryKey: ["timeseries"] });
      }
    });
  }, [authed]);

  return null;
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center gap-3 text-muted-foreground">
      <Spinner className="h-5 w-5" />
      <span className="text-sm">Loading Smart Speed…</span>
    </div>
  );
}

export function App() {
  const status = useAuth((s) => s.status);
  const boot = useAuth((s) => s.boot);

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <QueryClientProvider client={queryClient}>
      <AppEffects />
      <Toaster theme="dark" position="top-right" richColors closeButton />
      {status === "booting" ? <Splash /> : <AppRoutes />}
    </QueryClientProvider>
  );
}
