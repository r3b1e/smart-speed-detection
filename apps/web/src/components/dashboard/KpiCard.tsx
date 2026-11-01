import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Card, CardTitle } from "../ui/card";
import { Sparkline } from "../charts";
import { cn, formatDelta } from "../../lib/format";
import type { TrendPoint } from "@smart-speed/shared";

export function KpiCard({
  label,
  value,
  unit,
  trend,
  spark,
  sparkColor,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  trend?: TrendPoint | null;
  spark?: number[];
  sparkColor?: string;
  icon?: ReactNode;
}) {
  const delta = trend?.deltaPct ?? null;
  const up = delta !== null && delta > 0;
  const deltaTone = delta === null ? "text-muted-foreground" : up ? "text-warn" : "text-ok";

  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-start justify-between">
        <CardTitle className="text-[11px] uppercase tracking-widest">{label}</CardTitle>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <div className="flex items-end gap-1.5">
        <motion.span
          key={value}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="num text-2xl font-bold leading-none"
        >
          {value}
        </motion.span>
        {unit ? <span className="mb-0.5 text-xs text-muted-foreground">{unit}</span> : null}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        {trend ? (
          <span className={cn("num text-[11px] font-medium", deltaTone)}>
            {formatDelta(delta)}
            <span className="ml-1 font-normal text-muted-foreground">vs prev</span>
          </span>
        ) : (
          <span />
        )}
        {spark && spark.length > 1 ? <Sparkline data={spark} color={sparkColor} /> : null}
      </div>
    </Card>
  );
}
