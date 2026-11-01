import type { Role } from "@smart-speed/shared";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { Spinner } from "./components/ui/states";
import { useAuth } from "./stores/auth";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AuditPage } from "./pages/AuditPage";
import { CameraPage } from "./pages/CameraPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DetectionsPage } from "./pages/DetectionsPage";
import { DevicesPage } from "./pages/DevicesPage";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";
import { VehiclesPage } from "./pages/VehiclesPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();

  if (status === "booting") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }
  if (status !== "authed") return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user || !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function LoginRedirect() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === "booting") return null;
  if (status === "authed") {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    return <Navigate to={from && from !== "/login" ? from : "/dashboard"} replace />;
  }
  return <LoginPage />;
}

function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <p className="num text-4xl font-bold text-muted-foreground">404</p>
      <p className="text-sm text-muted-foreground">This page does not exist.</p>
      <a
        href="/dashboard"
        className="text-sm font-medium text-primary underline underline-offset-4"
      >
        Back to dashboard
      </a>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRedirect />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="detections" element={<DetectionsPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="camera" element={<CameraPage />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route
          path="devices"
          element={
            <RequireRole roles={["admin", "authority"]}>
              <DevicesPage />
            </RequireRole>
          }
        />
        <Route
          path="users"
          element={
            <RequireRole roles={["admin"]}>
              <UsersPage />
            </RequireRole>
          }
        />
        <Route
          path="settings"
          element={
            <RequireRole roles={["admin"]}>
              <SettingsPage />
            </RequireRole>
          }
        />
        <Route
          path="audit"
          element={
            <RequireRole roles={["admin"]}>
              <AuditPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
