'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The Fashion Atlas search bar — Poste | Ville | Rechercher — with live
 * autocomplete on both fields, shared between the landing page and the results
 * header so the two can never drift apart.
 *
 * The skin is the Catwalks DA (design_2.md §4.2, réf emplois.html) : a single
 * rectangle (radius 5px), an ink hairline that turns green on focus, a green
 * submit button, and a dotted vertical rule between the two fields — never a
 * rounded Indeed-style pill. The DA `.search` class (globals.css) supplies the
 * grid, the fields and the responsive stacking; this component supplies only
 * the autocomplete behaviour on top.
 *
 * `size="hero"` is the landing page's own big centered bar; `size="compact"`
 * (default) is the sticky bar in the results header. Both share the exact same
 * autocomplete behavior — only the outer max-width differs.
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

const SearchGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
const PinGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
const ArrowGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

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
      role="search"
      className={cn('search mx-auto w-full', hero ? 'max-w-[760px]' : 'max-w-none', className)}
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
        icon={<SearchGlyph />}
        placeholder="Poste, Maison, mot-clé…"
        ariaLabel="Poste ou mot-clé"
      />

      <AutocompleteField
        type="city"
        value={city}
        onChange={onCityChange}
        onCommit={(value) => onCityChange(value)}
        icon={<PinGlyph />}
        placeholder="Ville, région ou pays"
        ariaLabel="Lieu"
      />

      {/* DA primary button (§4.4) : vert plein, weight 400, radius hérité 0
          dans la barre — la flèche renforce l'action. */}
      <button type="submit" className="btn btn--primary">
        Rechercher <ArrowGlyph />
      </button>
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
  className,
}: {
  type: 'title' | 'city' | 'company';
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  icon: React.ReactNode;
  placeholder: string;
  ariaLabel: string;
  /** Extra classes on the `.field` root — used by the Maison directory to add
      the bordered 34px box the search bar's own fields don't need. */
  className?: string;
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
    <div ref={containerRef} className={cn('field relative', className)}>
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
      />

      {/* Suggestion panel — DA dropdown (§4.3) : fond paper, filet 1px, radius
          5px, shadow-menu, ancré sous le champ. Rendu inline : la barre n'est
          pas dans un conteneur à scroll clippé comme la rangée de filtres. */}
      {open && suggestions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Suggestions de recherche"
          className="dd absolute top-[calc(100%+8px)] left-0 max-h-80 w-full min-w-[280px] overflow-y-auto"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => pick(suggestion)}
              className={cn(index === highlighted && 'bg-paper-alt')}
            >
              <span className="flex min-w-0 items-center gap-2 truncate">
                {type === 'title' ? (
                  <Search className="size-4 shrink-0 text-ink-muted" aria-hidden />
                ) : (
                  <MapPin className="size-4 shrink-0 text-ink-muted" aria-hidden />
                )}
                <span className="truncate">{suggestion}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
