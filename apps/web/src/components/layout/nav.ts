import type { Role } from "@smart-speed/shared";
import {
  BarChart3,
  Camera,
  Car,
  Cpu,
  Gauge,
  Map as MapIcon,
  Radar,
  ScrollText,
  Settings2,
  Users,
  BookOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge, roles: ["admin", "authority", "user"] },
  { to: "/sessions", label: "Sessions", icon: BookOpen, roles: ["admin", "authority", "user"] },
  { to: "/detections", label: "Detections", icon: Radar, roles: ["admin", "authority", "user"] },
  { to: "/map", label: "Live Map", icon: MapIcon, roles: ["admin", "authority", "user"] },
  { to: "/analytics", label: "Analytics", icon: BarChart3, roles: ["admin", "authority", "user"] },
  { to: "/camera", label: "Camera", icon: Camera, roles: ["admin", "authority", "user"] },
  { to: "/vehicles", label: "My Vehicles", icon: Car, roles: ["admin", "authority", "user"] },
  { to: "/devices", label: "Devices", icon: Cpu, roles: ["admin", "authority"] },
  { to: "/users", label: "Users", icon: Users, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings2, roles: ["admin"] },
  { to: "/audit", label: "Audit Log", icon: ScrollText, roles: ["admin"] },
];

export function navForRole(role: Role | undefined): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
