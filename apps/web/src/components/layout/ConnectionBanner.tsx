import { useLive } from "../../stores/live";
import { AlertTriangle, Wifi, WifiOff } from "lucide-react";
import { cn } from "../../lib/format";

/** Persistent strip: socket state + bridge/camera health. */
export function ConnectionBanner() {
  const status = useLive((s) => s.status);
  const system = useLive((s) => s.system);

  const bridge = system?.components.find((c) => c.name === "bridge");
  const camera = system?.cameraStatus;

  const socketDown = status !== "connected" && status !== "idle";
  const bridgeDown = bridge ? bridge.status !== "online" : false;
  const cameraWaiting = camera === "waiting";
  const cameraDown = camera === "offline";

  const problems: string[] = [];
  if (socketDown) problems.push("Live connection reconnecting…");
  if (bridgeDown)
    problems.push(bridge?.status === "waiting" ? "IR gate waiting…" : "IR gate / bridge offline");
  if (cameraWaiting) problems.push("Camera waiting for iPhone");
  if (cameraDown) problems.push("Camera offline");

  if (problems.length === 0) {
    if (status === "idle") return null;
    return (
      <div className="flex items-center gap-2 border-b border-border/60 bg-ok/10 px-4 py-1.5 text-[11px] text-ok">
        <Wifi className="h-3 w-3" />
        <span className="font-medium">All systems live</span>
        <span className="text-ok/70">socket connected · streaming detections</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-[11px]",
        "border-warn/30 bg-warn/10 text-warn"
      )}
    >
      {socketDown ? (
        <WifiOff className="h-3 w-3 shrink-0" />
      ) : (
        <AlertTriangle className="h-3 w-3 shrink-0" />
      )}
      {problems.map((p) => (
        <span key={p} className="font-medium">
          {p}
        </span>
      ))}
    </div>
  );
}
