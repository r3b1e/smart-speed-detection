import type { ComponentStatus, HealthStatus } from "@smart-speed/shared";
import { Cpu, Database, Server, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, formatRelative } from "../../lib/format";
import { useLive } from "../../stores/live";

const LABELS: Record<string, string> = {
  bridge: "IR gate / bridge",
  vision: "Camera service",
  server: "API server",
  db: "Database",
};

const ICONS: Record<string, LucideIcon> = {
  bridge: Cpu,
  vision: Video,
  server: Server,
  db: Database,
};

const TONE: Record<HealthStatus, string> = {
  online: "border-ok/40 bg-ok/10 text-ok",
  degraded: "border-warn/40 bg-warn/10 text-warn",
  waiting: "border-warn/40 bg-warn/10 text-warn",
  offline: "border-danger/40 bg-danger/10 text-danger",
};

function Pill({ component }: { component: ComponentStatus }) {
  const Icon = ICONS[component.name] ?? Server;
  return (
    <div
      className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", TONE[component.status])}
    >
      <Icon className="h-3.5 w-3.5" />
      <div className="leading-tight">
        <p className="text-[11px] font-semibold">{LABELS[component.name] ?? component.name}</p>
        <p className="num text-[10px] opacity-70">
          {component.status} · {formatRelative(component.lastSeenAt)}
        </p>
      </div>
    </div>
  );
}

/** System health strip driven by the `system:status` socket event. */
export function HealthStrip() {
  const system = useLive((s) => s.system);
  const status = useLive((s) => s.status);

  const components: ComponentStatus[] = system?.components ?? [
    {
      name: "server",
      status: status === "connected" ? "online" : "offline",
      lastSeenAt: null,
      detail: null,
    },
    { name: "db", status: "waiting", lastSeenAt: null, detail: null },
    { name: "bridge", status: "waiting", lastSeenAt: null, detail: null },
    { name: "vision", status: "waiting", lastSeenAt: null, detail: null },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {components.map((c) => (
        <Pill key={c.name} component={c} />
      ))}
    </div>
  );
}
