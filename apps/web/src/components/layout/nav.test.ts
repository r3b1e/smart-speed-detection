import { describe, expect, it } from "vitest";
import { navForRole } from "./nav";

describe("navForRole", () => {
  it("returns nothing when the user is unknown", () => {
    expect(navForRole(undefined)).toEqual([]);
  });

  it("admin sees every section", () => {
    expect(navForRole("admin")).toHaveLength(10);
  });

  it("authority keeps devices but loses user/settings/audit", () => {
    const tos = navForRole("authority").map((item) => item.to);
    expect(tos).toContain("/devices");
    expect(tos).not.toContain("/users");
    expect(tos).not.toContain("/settings");
    expect(tos).not.toContain("/audit");
  });

  it("plain user sees only the public sections", () => {
    const tos = navForRole("user").map((item) => item.to);
    expect(tos).toEqual([
      "/dashboard",
      "/detections",
      "/map",
      "/analytics",
      "/camera",
      "/vehicles",
    ]);
  });
});
