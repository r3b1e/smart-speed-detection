import { LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button } from "../ui/button";
import { RoleBadge } from "../ui/badge";
import { cn } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { useAuth } from "../../stores/auth";
import { useLive } from "../../stores/live";
import { ConnectionBanner } from "./ConnectionBanner";
import { navForRole } from "./nav";

export function AppShell() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { dark, toggle } = useTheme();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const connect = useLive((s) => s.connect);
  const disconnect = useLive((s) => s.disconnect);
  const status = useLive((s) => s.status);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const items = navForRole(user?.role);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2 px-3 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
        <span className="num text-sm font-bold">SS</span>
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold">Smart Speed</p>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">traffic ops</p>
      </div>
    </div>
  );

  const userCard = (
    <div className="border-t border-border/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
        </div>
        {user ? <RoleBadge role={user.role} /> : null}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={toggle}
          aria-label="Toggle theme"
        >
          {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          {dark ? "Light" : "Dark"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void logout()} aria-label="Sign out">
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border/60 bg-card/40 lg:flex">
        {brand}
        {nav}
        <div className="mt-auto">{userCard}</div>
      </aside>

      {/* mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-card">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            {nav}
            <div className="mt-auto">{userCard}</div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border/60 bg-card/40 px-4 py-2.5 backdrop-blur">
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
              status === "connected"
                ? "border-ok/40 bg-ok/10 text-ok"
                : status === "idle"
                  ? "border-border bg-muted text-muted-foreground"
                  : "border-warn/40 bg-warn/10 text-warn"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                status === "connected"
                  ? "bg-ok"
                  : status === "idle"
                    ? "bg-muted-foreground"
                    : "bg-warn"
              )}
            />
            {status === "connected" ? "live" : status === "idle" ? "offline" : "connecting"}
          </span>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>

        <ConnectionBanner />

        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
