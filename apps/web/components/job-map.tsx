'use client';

import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { JobRow } from '@/lib/jobs';

/**
 * France map of located jobs.
 *
 * Uses the Leaflet API directly rather than react-leaflet: offers at the same
 * address share exact coordinates, so they must be grouped into one marker per
 * city — a per-offer marker would stack dozens of invisible pins on Paris.
 *
 * Leaflet touches `window` at import time, so the parent loads this with
 * next/dynamic and `ssr: false`.
 */

const FRANCE_CENTER: L.LatLngExpression = [46.6, 2.4];
const FRANCE_ZOOM = 6;

/** One accent hue for every pin; volume is carried by radius, not by colour. */
const MARKER_STROKE = 'oklch(55% 0.21 264)';
const MARKER_FILL = 'oklch(72% 0.15 264)';

type JobMapProps = {
  jobs: JobRow[];
  onSelectCity?: (city: string | null) => void;
  selectedCity?: string | null;
};

type CityGroup = {
  city: string;
  latitude: number;
  longitude: number;
  jobs: JobRow[];
};

function groupByCity(jobs: JobRow[]): CityGroup[] {
  const groups = new Map<string, CityGroup>();
  for (const job of jobs) {
    if (job.latitude === null || job.longitude === null) continue;
    const key = job.city ?? `${job.latitude},${job.longitude}`;
    const existing = groups.get(key);
    if (existing) existing.jobs.push(job);
    else
      groups.set(key, {
        city: job.city ?? 'Localisation',
        latitude: job.latitude,
        longitude: job.longitude,
        jobs: [job],
      });
  }
  return [...groups.values()];
}

/** Marker size scales with volume so dense cities read at a glance. */
function markerRadius(count: number): number {
  return Math.min(30, 11 + Math.sqrt(count) * 3.2);
}

export default function JobMap({ jobs, onSelectCity, selectedCity }: JobMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const groups = useMemo(() => groupByCity(jobs), [jobs]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: FRANCE_CENTER,
      zoom: FRANCE_ZOOM,
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
    });

    // CARTO Voyager: full colour, but low-contrast roads and labels, so the
    // accent pins stay readable on top. Free for this usage, attribution kept.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
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
    const map = mapRef.current;
    if (!layer || !map) return;

    layer.clearLayers();

    for (const group of groups) {
      const isSelected = selectedCity === group.city;
      const marker = L.circleMarker([group.latitude, group.longitude], {
        radius: markerRadius(group.jobs.length),
        // A single accent hue over the full-colour basemap: pins read as data,
        // and selection is shown by a solid fill rather than a second colour.
        color: MARKER_STROKE,
        weight: isSelected ? 3 : 2,
        fillColor: isSelected ? MARKER_STROKE : MARKER_FILL,
        fillOpacity: isSelected ? 0.95 : 0.75,
      });

      marker.bindTooltip(`${group.city} · ${group.jobs.length} offre${group.jobs.length > 1 ? 's' : ''}`, {
        direction: 'top',
        offset: [0, -6],
      });

      marker.on('click', () => onSelectCity?.(isSelected ? null : group.city));
      marker.addTo(layer);
    }

    // Frame the results, but never zoom past city level on a single match.
    if (groups.length > 1) {
      map.fitBounds(L.latLngBounds(groups.map((g) => [g.latitude, g.longitude] as L.LatLngTuple)), {
        padding: [40, 40],
        maxZoom: 10,
      });
    } else if (groups.length === 1) {
      map.setView([groups[0].latitude, groups[0].longitude], 10);
    }
  }, [groups, onSelectCity, selectedCity]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {groups.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="text-muted-foreground text-sm">Aucune offre localisée</p>
        </div>
      )}
    </div>
  );
}
