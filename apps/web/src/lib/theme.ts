import { useEffect, useState } from "react";

const KEY = "ssd-theme";

function apply(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem(KEY, dark ? "dark" : "light");
}

export function initTheme(): void {
  const stored = localStorage.getItem(KEY);
  const dark = stored ? stored === "dark" : true;
  apply(dark);
}

export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return {
    dark,
    toggle: () => apply(!document.documentElement.classList.contains("dark")),
  };
}
