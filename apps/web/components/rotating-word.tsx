'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The hero's rotating word — an inline pill that slides its width to fit each
 * word in turn. Ported from the Catwalks hero (its spirit, restyled for Fashion
 * Atlas): a ghost span in flow gives the natural width at SSR and is measured to
 * animate the transition; the width is remeasured once the custom font loads
 * (a width computed on the fallback font would otherwise stay wrong).
 *
 * Accessibility: the pill is hidden from assistive tech (the caller provides the
 * full phrase once in a visually-hidden span), and the rotation stops under
 * prefers-reduced-motion and whenever the hero is scrolled off-screen — an
 * animated width forces layout, so paying for it unseen is pure waste.
 */

const CADENCE_MS = 2200;

type Rotation = { index: number; previous: string | null };

export function RotatingWord({ words }: { words: readonly string[] }) {
  const [{ index, previous }, setRotation] = useState<Rotation>({ index: 0, previous: null });
  const [width, setWidth] = useState<number | undefined>(undefined);
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (words.length < 2) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number | undefined;
    let visible = true;

    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };

    const apply = () => {
      stop();
      if (reduceMotion.matches || !visible) return;
      timer = window.setInterval(() => {
        // Pure updater (React 19 StrictMode replays updaters).
        setRotation(({ index: i }) => ({
          index: (i + 1) % words.length,
          previous: words[i] ?? null,
        }));
      }, CADENCE_MS);
    };

    // The rotation stops when nobody is watching: an animated inline width forces
    // a layout recalc, so a hero scrolled off-screen must not keep paying for it.
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined' && rootRef.current) {
      observer = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        apply();
      });
      observer.observe(rootRef.current);
    }

    apply();
    reduceMotion.addEventListener('change', apply);
    return () => {
      stop();
      observer?.disconnect();
      reduceMotion.removeEventListener('change', apply);
    };
  }, [words]);

  // Measure after each word, remeasure when the custom font arrives.
  useLayoutEffect(() => {
    const measure = () => {
      const ghost = ghostRef.current;
      if (ghost) setWidth(ghost.getBoundingClientRect().width);
    };
    measure();
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, [index]);

  const current = words[index] ?? '';

  return (
    <span
      ref={rootRef}
      aria-hidden="true"
      className="relative inline-grid overflow-hidden rounded-full bg-foreground px-3 py-0.5 align-baseline text-background transition-[width] duration-300 ease-catwalks"
      style={width !== undefined ? { width: `${width + 24}px` } : undefined}
    >
      {/* Ghost in flow: gives the natural width, invisible. */}
      <span ref={ghostRef} className="invisible col-start-1 row-start-1 whitespace-nowrap">
        {current}
      </span>
      {previous !== null && (
        <span
          key={`out-${index}`}
          className="col-start-1 row-start-1 whitespace-nowrap [animation:rotating-word-out_0.3s_forwards]"
        >
          {previous}
        </span>
      )}
      <span
        key={`in-${index}`}
        className="col-start-1 row-start-1 whitespace-nowrap [animation:rotating-word-in_0.3s_forwards]"
      >
        {current}
      </span>
    </span>
  );
}
