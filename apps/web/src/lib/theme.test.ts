import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initTheme, useTheme } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("defaults to dark mode", () => {
    initTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("ssd-theme")).toBe("dark");
  });

  it("respects a stored light preference", () => {
    localStorage.setItem("ssd-theme", "light");
    initTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("ssd-theme")).toBe("light");
  });

  it("toggles the class and persists the choice", async () => {
    initTheme();
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.dark).toBe(false));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("ssd-theme")).toBe("light");
  });
});
