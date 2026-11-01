import type { Layer } from "leaflet";
import "leaflet"; // must evaluate before the plugin: it reads the global `L`
import "leaflet.heat";

export interface HeatLatLng {
  lat: number;
  lng: number;
  weight?: number;
}

export interface HeatOptions {
  minOpacity?: number;
  maxZoom?: number;
  max?: number;
  radius?: number;
  blur?: number;
  gradient?: Record<string, string>;
}

export interface HeatLayer extends Layer {
  setLatLngs(latlngs: HeatLatLng[]): this;
}

interface HeatGlobal {
  L?: {
    heatLayer?: (latlngs: HeatLatLng[], options?: HeatOptions) => HeatLayer;
  };
}

/**
 * leaflet.heat only registers on the global `L` object (no ESM exports).
 * Returns null when the plugin failed to load — callers fall back to markers.
 */
export function createHeatLayer(latlngs: HeatLatLng[], options?: HeatOptions): HeatLayer | null {
  const globalL = (globalThis as unknown as HeatGlobal).L;
  if (!globalL || typeof globalL.heatLayer !== "function") return null;
  return globalL.heatLayer(latlngs, options);
}
