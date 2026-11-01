import type { Detection } from "@smart-speed/shared";
import { AnimatePresence, motion } from "framer-motion";
import { Car } from "lucide-react";
import { frameImageUrl } from "../../lib/env";
import { cn, formatTime } from "../../lib/format";
import { getAccessToken } from "../../lib/session";
import { useLive } from "../../stores/live";
import { Badge, SeverityBadge } from "../ui/badge";

function Thumb({ detection }: { detection: Detection }) {
  const src = frameImageUrl(detection.frame.thumbFileId, getAccessToken());
  if (!src || detection.frame.status !== "ready") {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
        <Car className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-11 w-11 shrink-0 rounded-md border border-border object-cover"
    />
  );
}

/** Slide-in cards of the newest detections, newest on the left. */
export function Ticker() {
  const recent = useLive((s) => s.recent);

  if (recent.length === 0) {
    return (
      <div className="flex h-[86px] items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
        Waiting for the first detection…
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
      <AnimatePresence initial={false}>
        {recent.slice(0, 12).map((d) => (
          <motion.div
            key={d.id}
            layout
            initial={{ opacity: 0, x: -24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className={cn(
              "flex w-52 shrink-0 items-center gap-2.5 rounded-lg border bg-card/80 p-2",
              d.overspeed ? "border-danger/50" : "border-border"
            )}
          >
            <Thumb detection={d} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className={cn(
                    "num text-sm font-bold",
                    d.overspeed ? "text-danger" : "text-foreground"
                  )}
                >
                  {d.scaledSpeedKmh.toFixed(0)}
                  <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">km/h</span>
                </span>
                <span className="num text-[10px] text-muted-foreground">
                  {formatTime(d.detectedAt)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1">
                <SeverityBadge severity={d.severity} />
                {d.plate ? (
                  <Badge tone="muted" className="num">
                    {d.plate}
                  </Badge>
                ) : null}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
