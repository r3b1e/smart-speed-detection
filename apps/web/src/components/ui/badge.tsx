import type { Severity, ReviewStatus, Role, HealthStatus, DeviceStatus } from "@smart-speed/shared";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/format";

type Tone = "ok" | "warn" | "danger" | "info" | "muted";

const toneClass: Record<Tone, string> = {
  ok: "border-ok/40 bg-ok/15 text-ok",
  warn: "border-warn/40 bg-warn/15 text-warn",
  danger: "border-danger/40 bg-danger/15 text-danger",
  info: "border-primary/40 bg-primary/15 text-primary",
  muted: "border-border bg-muted text-muted-foreground",
};

export function Badge({
  tone = "muted",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        toneClass[tone],
        className
      )}
      {...props}
    />
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const tone: Tone = severity === "high" ? "danger" : severity === "medium" ? "warn" : "info";
  return <Badge tone={tone}>{severity}</Badge>;
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const tone: Tone = status === "confirmed" ? "danger" : status === "dismissed" ? "ok" : "warn";
  return <Badge tone={tone}>{status}</Badge>;
}

export function RoleBadge({ role }: { role: Role }) {
  const tone: Tone = role === "admin" ? "danger" : role === "authority" ? "info" : "muted";
  return <Badge tone={tone}>{role}</Badge>;
}

export function HealthBadge({ status }: { status: HealthStatus }) {
  const tone: Tone =
    status === "online"
      ? "ok"
      : status === "waiting"
        ? "warn"
        : status === "degraded"
          ? "warn"
          : "danger";
  return <Badge tone={tone}>{status}</Badge>;
}

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const tone: Tone = status === "active" ? "ok" : status === "maintenance" ? "warn" : "muted";
  return <Badge tone={tone}>{status}</Badge>;
}

export function LiveDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        online ? "bg-ok shadow-[0_0_8px_hsl(var(--ok))]" : "bg-danger",
        className
      )}
    />
  );
}
