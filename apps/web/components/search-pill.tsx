'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The Indeed search pill — Poste | Ville | Rechercher — with live autocomplete
 * on both fields, shared between the landing page and the results header so
 * the two can never drift apart.
 *
 * Field proportions were measured against the live fr.indeed.com pill with
 * Playwright (getComputedStyle) — Indeed only ever supplied the STRUCTURE:
 *  - field: height 60px, font 16px
 *  - suggestion row: 42px tall, 14px text, a 20px icon (search-with-clock for
 *    Poste, a pin for Ville), flex, icon + label with gap
 *
 * The SKIN is the Catwalks DA (decision D17) instead: the pill and its submit
 * button are fully rounded (100vmax), the submit button is black (not
 * Indeed's blue, not the old brand magenta), and there is no shadow at rest —
 * only a hairline border.
 *
 * `size="hero"` is the landing page's own big centered pill; `size="compact"`
 * is the smaller pill that sits in the results header. Both share the exact
 * same autocomplete behavior — only the outer dimensions differ.
 */

export interface SearchPillProps {
  /** Current "Poste" field value — controlled, so the caller owns the draft. */
  query: string;
  onQueryChange: (value: string) => void;
  /** Current "Ville" field value. */
  city: string;
  onCityChange: (value: string) => void;
  onSubmit: (values: { query: string; city: string }) => void;
  size?: 'hero' | 'compact';
  className?: string;
}

export function SearchPill({
  query,
  onQueryChange,
  city,
  onCityChange,
  onSubmit,
  size = 'compact',
  className,
}: SearchPillProps) {
  const hero = size === 'hero';

  return (
    <form
      className={cn(
        'border-border mx-auto flex h-auto w-full flex-col items-stretch rounded-full border bg-white focus-within:ring-2 focus-within:ring-black/20 sm:flex-row sm:items-center',
        hero ? 'max-w-[900px] sm:h-[62px]' : 'max-w-[900px] sm:h-[60px]',
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ query: query.trim(), city: city.trim() });
      }}
    >
      <AutocompleteField
        type="title"
        value={query}
        onChange={onQueryChange}
        onCommit={(value) => onQueryChange(value)}
        icon={<Search className="text-foreground/70 size-5 shrink-0" aria-hidden />}
        placeholder="Poste, Maison, mot-clé…"
        ariaLabel="Poste ou mot-clé"
        hero={hero}
      />

      <span className="bg-border mx-4 h-px w-auto shrink-0 sm:mx-1 sm:h-9 sm:w-px" aria-hidden />

      <AutocompleteField
        type="city"
        value={city}
        onChange={onCityChange}
        onCommit={(value) => onCityChange(value)}
        icon={<MapPin className="text-foreground/70 size-5 shrink-0" aria-hidden />}
        placeholder="Ville, région ou pays"
        ariaLabel="Lieu"
        hero={hero}
        flexClassName="sm:flex-[0.7] sm:pl-2"
      />

      <div className="p-2">
        {/* Catwalks DA primary button: black pill, weight 400, hover to
            grey-600 — not Indeed's blue, not the old brand magenta. */}
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-grey-600 focus-visible:ring-black/30 h-11 w-full rounded-full px-6 text-[16px] font-normal tracking-[0.4px] transition-colors duration-300 ease-catwalks focus-visible:ring-2 focus-visible:outline-none sm:w-auto"
        >
          Rechercher
        </button>
      </div>
    </form>
  );
}

/**
 * One field of the pill — a text input plus its own suggestion dropdown.
 *
 * Debounced (150ms) and gated at 2 characters, matching the endpoint's own
 * floor (`/api/suggest` returns nothing below 2 chars — see lib/jobs.ts
 * suggestCities/suggestTitles). Keyboard: Up/Down moves the highlighted row,
 * Enter picks it (or submits the form if nothing is highlighted), Escape
 * closes. Outside click closes. This is the same headless-dropdown discipline
 * FilterMenu already uses in jobs-view.tsx — a real button/panel, not a
 * native <details>.
 */
export function AutocompleteField({
  type,
  value,
  onChange,
  onCommit,
  icon,
  placeholder,
  ariaLabel,
  hero,
  flexClassName,
}: {
  type: 'title' | 'city' | 'company';
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  icon: React.ReactNode;
  placeholder: string;
  ariaLabel: string;
  hero: boolean;
  flexClassName?: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const listboxId = `${type}-suggestions`;

  // Debounced fetch: a keystroke schedules a fetch 150ms out, and a later
  // keystroke cancels the pending one rather than letting both land — the
  // request counter below additionally guards against an in-flight fetch
  // resolving out of order and overwriting a newer, still-typed query.
  useEffect(() => {
    // Only fetch + open while the field is actually focused: without this, the
    // pre-filled "France" default (or any programmatic value) tripped the
    // dropdown open on page load, with no candidate interaction.
    if (!focused) return;
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      fetch(`/api/suggest?type=${type}&q=${encodeURIComponent(q)}`)
        .then((response) => (response.ok ? response.json() : { suggestions: [] }))
        .then((data: { suggestions?: string[] }) => {
          if (id !== requestId.current) return; // a newer query already superseded this one
          setSuggestions(data.suggestions ?? []);
          setOpen(true);
          setHighlighted(-1);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setSuggestions([]);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [value, type, focused]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const pick = useCallback(
    (suggestion: string) => {
      onCommit(suggestion);
      setOpen(false);
      setSuggestions([]);
      inputRef.current?.focus();
    },
    [onCommit],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && highlighted >= 0) {
      event.preventDefault();
      pick(suggestions[highlighted]!);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={cn('relative flex min-w-0 flex-1 items-center gap-3 px-4 pt-2 sm:pt-0', flexClassName)}>
      {icon}
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          setFocused(true);
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        className={cn(
          'text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[16px] outline-none',
          hero ? 'h-12 sm:h-full' : 'h-11 sm:h-full',
        )}
      />

      {/* Suggestion panel — measured against Indeed's own #combobox-what-list:
          white, radius 12, the same soft shadow as the pill itself, anchored
          4px below the field. Rendered inline (not portaled): the pill does
          not sit inside a scroll-clipped container the way the filter row
          does, so a plain absolute panel is enough here. */}
      {open && suggestions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Suggestions de recherche"
          className="border-border/60 absolute top-full left-0 z-20 mt-1 max-h-80 w-full min-w-[280px] overflow-y-auto rounded-[12px] border bg-white py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => pick(suggestion)}
              className={cn(
                'flex h-[42px] w-full items-center gap-3 px-4 text-left text-sm transition-colors',
                index === highlighted ? 'bg-surface' : 'hover:bg-surface',
              )}
            >
              {type === 'title' ? (
                <Search className="text-foreground/60 size-5 shrink-0" aria-hidden />
              ) : (
                <MapPin className="text-foreground/60 size-5 shrink-0" aria-hidden />
              )}
              <span className="text-foreground truncate">{suggestion}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
