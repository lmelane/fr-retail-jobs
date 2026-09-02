'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { COUNTRY_CENTROIDS } from '@/lib/country-centroids';
import { countryLabel } from '@/lib/countries';

/**
 * World map of the employer footprint: one bubble per country, sized by how
 * many offers sit there. Country-level, not city-level — most foreign offers
 * are not geocoded, and the question here is "where in the world are these
 * Maisons hiring", which a per-country bubble answers directly.
 *
 * Leaflet touches `window` at import time, so the parent loads this with
 * next/dynamic and ssr:false.
 */

const WORLD_CENTER: L.LatLngExpression = [30, 10];
const WORLD_ZOOM = 2;
const MARKER_STROKE = 'oklch(0.575 0.235 336)';
const MARKER_FILL = 'oklch(0.72 0.16 336)';

export type CountryCount = { code: string; count: number };

type WorldMapProps = {
  countries: CountryCount[];
  selected?: string | null;
  onSelect?: (code: string | null) => void;
};

/** Bubble radius scales with volume so a dominant country reads at a glance. */
function radius(count: number, max: number): number {
  const scaled = 8 + (Math.sqrt(count) / Math.sqrt(max || 1)) * 26;
  return Math.min(34, scaled);
}

export default function WorldMap({ countries, selected, onSelect }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
      scrollWheelZoom: true,
      zoomControl: true,
      worldCopyJump: true,
      minZoom: 2,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const max = countries.reduce((m, c) => Math.max(m, c.count), 0);
    for (const { code, count } of countries) {
      const centroid = COUNTRY_CENTROIDS[code];
      if (!centroid) continue;
      const isSelected = selected === code;
      const marker = L.circleMarker(centroid, {
        radius: radius(count, max),
        color: MARKER_STROKE,
        weight: isSelected ? 3 : 2,
        fillColor: isSelected ? MARKER_STROKE : MARKER_FILL,
        fillOpacity: isSelected ? 0.95 : 0.7,
      });
      marker.bindTooltip(
        `${countryLabel(code)} · ${count.toLocaleString('fr-FR')} offre${count > 1 ? 's' : ''}`,
        { direction: 'top', offset: [0, -6] },
      );
      marker.on('click', () => onSelect?.(isSelected ? null : code));
      marker.addTo(layer);
    }
  }, [countries, selected, onSelect]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {countries.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="text-muted-foreground text-sm">Aucune offre localisée</p>
        </div>
      )}
    </div>
  );
}
