'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The Indeed search pill — Poste | Ville | Rechercher — with live autocomplete
 * on both fields, shared between the landing page and the results header so
 * the two can never drift apart.
 *
 * Every value below was MEASURED against the live fr.indeed.com pill with
 * Playwright (getComputedStyle), not eyeballed:
 *  - field: height 60px, radius 12px, font 16px, text rgb(45,45,45)
 *  - submit button: height 44px, radius 12px, font 16px — Indeed's is
 *    rgb(0,79,203); ours is the brand magenta (--primary) instead
 *  - suggestion panel (#combobox-what-list): white, radius 12px, box-shadow
 *    `0 0 2px rgba(45,45,45,.16), 0 8px 16px rgba(45,45,45,.08), 0 16px 24px
 *    rgba(45,45,45,.04)`, absolutely positioned 4px below the field
 *  - suggestion row: 42px tall, 14px text, a 20px icon (search-with-clock for
 *    Poste, a pin for Ville), flex, icon + label with gap
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
        'border-border mx-auto flex h-auto w-full flex-col items-stretch rounded-[16px] border bg-white shadow-[0_0_2px_0_rgba(45,45,45,.16),0_4px_8px_0_rgba(45,45,45,.08),0_8px_16px_0_rgba(45,45,45,.04)] focus-within:ring-2 focus-within:ring-primary/40 sm:flex-row sm:items-center',
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
        placeholder="Ville"
        ariaLabel="Lieu"
        hero={hero}
        flexClassName="sm:flex-[0.7] sm:pl-2"
      />

      <div className="p-2">
        {/* Native button at Indeed's measured spec — 44px tall, radius 12px,
            font 16px. The shared Button component rounds to a pill (24px), which
            is not Indeed's shape; the brand magenta replaces Indeed's blue. */}
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary/40 h-11 w-full rounded-[12px] px-6 text-[16px] font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none sm:w-auto"
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
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const listboxId = `${type}-suggestions`;

  // Debounced fetch: a keystroke schedules a fetch 150ms out, and a later
  // keystroke cancels the pending one rather than letting both land — the
  // request counter below additionally guards against an in-flight fetch
  // resolving out of order and overwriting a newer, still-typed query.
  useEffect(() => {
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
  }, [value, type]);

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
        onFocus={() => suggestions.length > 0 && setOpen(true)}
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
          className="border-border/60 absolute top-full left-0 z-20 mt-1 max-h-80 w-full min-w-[280px] overflow-y-auto rounded-[12px] border bg-white py-1.5 shadow-[0_0_2px_0_rgba(45,45,45,.16),0_8px_16px_0_rgba(45,45,45,.08),0_16px_24px_0_rgba(45,45,45,.04)]"
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
