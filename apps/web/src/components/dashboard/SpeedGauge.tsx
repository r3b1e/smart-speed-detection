import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/format";

const START = 135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export interface GaugeProps {
  value: number;
  limit: number;
  label?: string;
  sublabel?: string;
}

/** Radial speed gauge — sweeps to `value`, turns red and pulses above the limit. */
export function SpeedGauge({ value, limit, label, sublabel }: GaugeProps) {
  const max = useMemo(() => {
    const candidate = Math.max(limit * 1.8, value * 1.05, 80);
    return Math.ceil(candidate / 10) * 10;
  }, [limit, value]);

  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDisplay(value), 60);
    return () => window.clearTimeout(id);
  }, [value]);

  const clamped = Math.min(Math.max(display, 0), max);
  const frac = clamped / max;
  const over = limit > 0 && value > limit;
  const color = over ? "hsl(var(--danger))" : "hsl(var(--primary))";
  const cx = 120;
  const cy = 120;
  const r = 88;
  const valueEnd = START + SWEEP * frac;
  const limitAngle = START + SWEEP * Math.min(limit / max, 1);
  const [lx1, ly1] = polar(cx, cy, r - 34, limitAngle);
  const [lx2, ly2] = polar(cx, cy, r + 8, limitAngle);

  return (
    <div className="relative flex flex-col items-center">
      <svg
        viewBox="0 0 240 210"
        className="w-full max-w-[300px]"
        role="img"
        aria-label={`Speed ${value.toFixed(1)} km/h`}
      >
        <path
          d={arcPath(cx, cy, r, START, START + SWEEP)}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <motion.path
          d={arcPath(cx, cy, r, START, Math.max(valueEnd, START + 0.5))}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          animate={{ stroke: color, d: arcPath(cx, cy, r, START, Math.max(valueEnd, START + 0.5)) }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
          style={{ filter: over ? `drop-shadow(0 0 8px ${color})` : "none" }}
        />
        {/* limit marker */}
        <line
          x1={lx1}
          y1={ly1}
          x2={lx2}
          y2={ly2}
          stroke="hsl(var(--warn))"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <text
          x={polar(cx, cy, r + 20, limitAngle)[0]}
          y={polar(cx, cy, r + 20, limitAngle)[1]}
          textAnchor="middle"
          fontSize="10"
          fill="hsl(var(--warn))"
          fontFamily="JetBrains Mono, monospace"
        >
          {limit}
        </text>
        {/* scale ends */}
        <text
          x={polar(cx, cy, r - 26, START)[0]}
          y={polar(cx, cy, r - 26, START)[1]}
          textAnchor="middle"
          fontSize="10"
          fill="hsl(var(--muted-foreground))"
          fontFamily="JetBrains Mono, monospace"
        >
          0
        </text>
        <text
          x={polar(cx, cy, r - 26, START + SWEEP)[0]}
          y={polar(cx, cy, r - 26, START + SWEEP)[1]}
          textAnchor="middle"
          fontSize="10"
          fill="hsl(var(--muted-foreground))"
          fontFamily="JetBrains Mono, monospace"
        >
          {max}
        </text>
        <text
          x={cx}
          y={cy + 8}
          textAnchor="middle"
          fontSize="46"
          fontWeight="700"
          fill={over ? color : "hsl(var(--foreground))"}
          fontFamily="JetBrains Mono, monospace"
        >
          {display.toFixed(1)}
        </text>
        <text
          x={cx}
          y={cy + 34}
          textAnchor="middle"
          fontSize="12"
          fill="hsl(var(--muted-foreground))"
          fontFamily="JetBrains Mono, monospace"
        >
          km/h
        </text>
      </svg>
      <div className="mt-1 text-center">
        <p
          className={cn(
            "num text-xs font-semibold uppercase tracking-widest",
            over ? "animate-pulse text-danger" : "text-ok"
          )}
        >
          {over ? "OVERSPEED" : "within limit"}
        </p>
        {label ? <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p> : null}
        {sublabel ? <p className="text-[11px] text-muted-foreground">{sublabel}</p> : null}
      </div>
    </div>
  );
}
