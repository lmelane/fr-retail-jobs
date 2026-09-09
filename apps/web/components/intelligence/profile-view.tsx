import {getSectorPresentation} from '@/lib/sectors';
import { getOccupationPresentation } from '@/lib/occupations';
import Link from 'next/link';
import { Block, Coverage, Insight, Kpi, Mix, NA } from './chrome';
import { BarList } from './charts/bar-list';
import { LineChart } from './charts/line-chart';
import { IndexGauge } from './charts/index-gauge';
import { countryLabel } from '@/lib/countries';
import { employmentTermLabel } from '@/lib/format';
import type { Profile } from '@/lib/intelligence/queries/profile';
import type { Coverage as CoverageData } from '@/lib/intelligence/queries/coverage';
import { concentration, indexBase100, median, momentum, repostRate, share, variation } from '@/lib/intelligence/metrics';
import { fmtDate, fmtDays, fmtIndex, fmtInt, fmtNew, fmtPct, fmtSignedPct, MIN_SAMPLE, NA_FROM, NA_INSUFFICIENT, addDays, windowAvailable, windowFrom } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { mergeOtherSectors, UNCLASSIFIED_LABEL, type JobFamily } from '@/lib/intelligence/taxonomy';

/**
 * Les blocs standard d'un périmètre (pays, ville, métier, Maison, groupe,
 * secteur) : tuiles KPI (faits + dérivées seuillées), courbe des snapshots
 * quand elle existe, tops et répartitions, liens croisés vers les autres
 * pages Intelligence et vers le moteur d'offres filtré.
 */
export type ProfileContext = {
  kind: 'country' | 'city' | 'function' | 'company' | 'group' | 'sector';
  /** Nom affiché (France, Paris, Cartier…). */
  name: string;
  /** Paramètres réels de /emplois pour ce périmètre (pays, ville, maison, groupe, secteur, q). */
  jobsParams: Record<string, string | undefined>;
};

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="16" height="16"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

/**
 * « +N · 30 j » sous une ligne de liste, ou rien tant que l'observation ne
 * couvre pas la fenêtre — sinon le compte égale le total (cf. `fmtNew`).
 */
function newSub(n: number): string | undefined {
  const v = fmtNew(n);
  return v && n > 0 ? `+${v} · 30 j` : undefined;
}

export function ProfileKpis({ profile, coverage, ctx }: { profile: Profile; coverage: CoverageData; ctx: ProfileContext }) {
  const h = profile.headline;
  const sh = share(h.active, coverage.jobs);
  const conc = concentration(profile.companies.map((c) => c.active), h.active);
  const med = profile.closed.closedSample30 >= MIN_SAMPLE && profile.closed.medianLifespanDays30 !== null
    ? { ok: true as const, value: profile.closed.medianLifespanDays30 }
    : { ok: false as const, na: NA_INSUFFICIENT(profile.closed.closedSample30) };
  const repost = repostRate(h.reopened, h.active);
  const mom = momentum(profile.series);
  const idx = indexBase100(profile.series);
  const lastIdx = idx.ok ? idx.value[idx.value.length - 1].value : null;

  return (
    <div className="kpis">
      <Kpi label="Offres actives" value={fmtInt(h.active)} level="fact" green />
      {/* Les fenêtres ne s'affichent que couvertes par l'observation fiable (OBSERVATION_START) : avant, « nouvelles 30 j » = toute la base. */}
      <Kpi label="Nouvelles · 30 j" value={windowAvailable(30) ? fmtInt(h.new30d) : undefined} na={windowAvailable(30) ? undefined : NA_FROM(windowFrom(30))} level="fact" sub={[windowAvailable(7) ? `${fmtInt(h.new7d)} sur 7 j` : null, windowAvailable(1) ? `${fmtInt(h.new24h)} sur 24 h` : null].filter(Boolean).join(' · ') || undefined} />
      <Kpi label="Fermées · 30 j" value={windowAvailable(30) ? fmtInt(profile.closed.closed30d) : undefined} na={windowAvailable(30) ? undefined : NA_FROM(windowFrom(30))} level="fact" sub={windowAvailable(7) ? `${fmtInt(profile.closed.closed7d)} sur 7 j` : undefined} />
      {ctx.kind === 'company' ? (
        <Kpi label="Pays" value={fmtInt(profile.countriesTotal)} level="fact" sub={`${fmtInt(h.cities)} villes`} />
      ) : (
        <Kpi label="Maisons qui recrutent" value={fmtInt(h.companies)} level="fact" sub={ctx.kind === 'city' ? undefined : `${fmtInt(h.cities)} villes`} />
      )}
      <Kpi label="Part du marché mondial" value={sh.ok ? fmtPct(sh.value) : undefined} na={sh.ok ? undefined : sh.na} level="derived" sub={`sur ${fmtInt(coverage.jobs)} offres monde`} />
      {ctx.kind !== 'company' && (
        <Kpi label="Concentration · top 10" value={conc.ok ? fmtPct(conc.value.share) : undefined} na={conc.ok ? undefined : conc.na} level="derived" sub={conc.ok ? (conc.value.top < 10 ? `${conc.value.top} employeurs au total` : '10 premiers employeurs') : undefined} />
      )}
      <Kpi label="Durée médiane de publication" value={med.ok ? fmtDays(med.value) : undefined} na={med.ok ? undefined : med.na} level="derived" sub="fermées des 30 derniers jours · ≠ time-to-fill" />
      <Kpi label="Taux de repost" value={repost.ok ? fmtPct(repost.value) : undefined} na={repost.ok ? undefined : repost.na} level="derived" sub={`${fmtInt(h.reopened)} offres ré-ouvertes`} />
      <Kpi label="Indice base 100" value={lastIdx !== null ? fmtIndex(lastIdx) : undefined} na={idx.ok ? undefined : idx.na} level="derived" sub={profile.series[0] ? `base 100 le ${fmtDate(profile.series[0].date)}` : undefined} />
      <Kpi label="Momentum · 0-100" value={mom.ok ? String(mom.value.score) : undefined} na={mom.ok ? undefined : mom.na} level="derived" />
    </div>
  );
}

export function ProfileSeries({ profile, coverage, title }: { profile: Profile; coverage: CoverageData; title: string }) {
  const idx = indexBase100(profile.series);
  const v7 = variation(profile.series, 7);
  const v30 = variation(profile.series, 30);
  return (
    <Block id="serie" title={title} level="derived">
      {idx.ok ? (
        <div className="igrid">
          <div className="i8">
            <LineChart points={profile.series.map((p) => ({ date: p.date, value: p.activeJobs }))} ariaLabel={`Offres actives par jour — ${title}`} format={fmtInt} />
          </div>
          <div className="i4">
            <IndexGauge value={idx.value[idx.value.length - 1].value} baseDate={profile.series[0].date} ariaLabel="Indice base 100" />
            <p className="t-body2 muted mt-4">
              7 j : {v7.ok ? fmtSignedPct(v7.value.pct) : <NA na={v7.na} />} · 30 j : {v30.ok ? fmtSignedPct(v30.value.pct) : <NA na={v30.na} />}
            </p>
          </div>
        </div>
      ) : (
        <p className="na">
          {idx.na.kind === 'none'
            ? 'Aucun historique comparable pour ce périmètre. La courbe apparaîtra après les premiers relevés quotidiens.'
            : idx.na.kind === 'from'
              ? `Courbe disponible à partir du ${fmtDate(idx.na.date)}.`
              : 'n/d — échantillon insuffisant.'}
        </p>
      )}
    </Block>
  );
}

export async function ProfileBlocks({ profile, ctx }: { profile: Profile; ctx: ProfileContext }) {
  const {label:sectorLabel}=await getSectorPresentation();
  const {functionLabel,FAMILY_LABELS,seniorityLabel}=await getOccupationPresentation();
  const h = profile.headline;
  const total = h.active;
  const jobs = (extra: Record<string, string | undefined>) => intelPaths.jobs({ ...ctx.jobsParams, ...extra });
  const showCountries = ctx.kind !== 'country' && ctx.kind !== 'city';
  const showCities = ctx.kind !== 'city';
  const showCompanies = ctx.kind !== 'company';
  const showFunctions = ctx.kind !== 'function';
  const showSectors = ctx.kind !== 'sector' && ctx.kind !== 'company';
  const showGroups = ctx.kind !== 'group' && ctx.kind !== 'company' && profile.groups.length > 0;
  const unclassified = profile.functions.find((f) => f.key === '')?.count ?? 0;
  const topFn = profile.functions.filter((f) => f.key !== '').slice(0, 10);
  const topCity = profile.cities[0];
  const topCompany = profile.companies[0];

  return (
    <div className="igrid">
      {showCountries && (
        <div className="i6">
          <Block id="pays" title="Top pays" level="fact-shares" more={{ href: intelPaths.geographies, label: 'Toutes les géographies' }}>
            <BarList
              total={total}
              rows={profile.countries.slice(0, 10).map((c) => ({ label: countryLabel(c.code), value: c.active, href: intelPaths.country(c.code), sub: newSub(c.new30) }))}
            />
            {profile.countriesUnknown > 0 && <p className="t-caption-soft mt-3">{fmtInt(profile.countriesUnknown)} offres sans pays identifié.</p>}
          </Block>
        </div>
      )}
      {showCities && (
        <div className="i6">
          <Block id="villes" title="Top villes" level="fact-shares">
            <BarList
              total={total}
              rows={profile.cities.slice(0, 10).map((c) => ({ label: `${c.city}${ctx.kind === 'country' ? '' : `, ${countryLabel(c.code)}`}`, value: c.active, href: intelPaths.city(c.code, c.city), sub: c.companies > 1 ? `${fmtInt(c.companies)} Maisons` : undefined }))}
            />
            {topCity && total >= MIN_SAMPLE && ctx.kind !== 'company' && (
              <div className="mt-6">
                <Insight>
                  {topCity.city} concentre {fmtPct(topCity.active / total, 0)} des offres {ctx.kind === 'country' ? `en ${ctx.name}` : `de ce périmètre`} ({fmtInt(topCity.active)} sur {fmtInt(total)}).
                </Insight>
              </div>
            )}
          </Block>
        </div>
      )}
      {showCompanies && (
        <div className="i6">
          <Block id="maisons" title="Top Maisons" level="fact-shares">
            <BarList
              total={total}
              rows={profile.companies.slice(0, 10).map((c) => ({ label: c.name, value: c.active, href: intelPaths.company(c.name), sub: c.group ? c.group : sectorLabel(c.sector) }))}
            />
            {topCompany && total >= MIN_SAMPLE && (
              <div className="mt-6">
                <Insight>
                  {topCompany.name} porte {fmtPct(topCompany.active / total, 0)} des offres de ce périmètre — {profile.companies.length >= 10 ? `les dix premiers employeurs en portent ${fmtPct(profile.companies.slice(0, 10).reduce((s, c) => s + c.active, 0) / total, 0)}` : `${fmtInt(h.companies)} Maisons recrutent ici`}.
                </Insight>
              </div>
            )}
          </Block>
        </div>
      )}
      {showGroups && (
        <div className="i6">
          <Block id="groupes" title="Top groupes" level="fact-shares">
            <BarList total={total} rows={profile.groups.slice(0, 10).map((g) => ({ label: g.key, value: g.count, href: intelPaths.group(g.key), sub: `${fmtInt(g.companies)} Maisons` }))} />
          </Block>
        </div>
      )}
      {showFunctions && (
        <div className="i6">
          <Block id="metiers" title="Top métiers" level="fact-shares" more={{ href: intelPaths.functions, label: 'Tous les métiers' }}>
            {topFn.length > 0 ? (
              <BarList total={total} rows={topFn.map((f) => ({ label: functionLabel(f.key), value: f.count, href: intelPaths.fn(f.key) }))} />
            ) : (
              <p className="na">Aucune offre classée par métier dans ce périmètre.</p>
            )}
            <p className="t-caption-soft mt-3">
              {UNCLASSIFIED_LABEL} : {fmtInt(unclassified)} offres{total > 0 ? ` (${fmtPct(unclassified / total, 0)})` : ''} — couverture de la classification.
            </p>
          </Block>
        </div>
      )}
      {showSectors && (
        <div className="i6">
          <Block id="secteurs" title="Secteurs" level="fact-shares" more={{ href: intelPaths.sectors, label: 'Tous les secteurs' }}>
            <Mix total={total} rows={mergeOtherSectors(profile.sectors).map((s) => ({ label: sectorLabel(s.key), count: s.count, href: s.key === 'OTHER' ? undefined : intelPaths.sector(s.key) }))} />
          </Block>
        </div>
      )}
      <div className="i4">
        <Block id="seniorite" title="Séniorité" level="fact-shares">
          <Mix total={total} rows={profile.seniority.map((s) => ({ label: seniorityLabel(s.key || null), count: s.count }))} />
        </Block>
      </div>
      <div className="i4">
        <Block id="contrat" title="Contrat" level="fact-shares">
          <Mix
            total={total}
            rows={profile.contracts.map((c) => ({ label: c.key ? employmentTermLabel(c.key) ?? c.key : 'Non précisé', count: c.count, href: c.key ? jobs({ employmentTerm: c.key }) : undefined }))}
          />
        </Block>
      </div>
      <div className="i4">
        <Block id="famille" title="Retail · corporate · atelier" level="fact-shares">
          <Mix total={total} rows={profile.families.map((f) => ({ label: f.key ? FAMILY_LABELS[f.key as JobFamily] : UNCLASSIFIED_LABEL, count: f.count }))} />
        </Block>
      </div>
      {profile.skills.length > 0 && (
        <div className="i6">
          <Block id="competences" title="Compétences associées" level="fact">
            <BarList compact rows={profile.skills.slice(0, 12).map((s) => ({ label: s.key, value: s.count, href: jobs({ q: s.key }) }))} />
          </Block>
        </div>
      )}
      <div className="i12">
        <Link href={jobs({})} className="btn btn--green">
          Voir les {fmtInt(total)} offres {ctx.kind === 'company' || ctx.kind === 'group' ? `chez ${ctx.name}` : ctx.kind === 'function' ? `« ${ctx.name} »` : `· ${ctx.name}`} <Arrow />
        </Link>
      </div>
    </div>
  );
}

export function ProfileFooter({ coverage, jobs }: { coverage: CoverageData; jobs: number }) {
  return (
    <div className="container" style={{ paddingTop: 96, paddingBottom: 96 }}>
      <Coverage coverage={coverage} jobs={jobs} />
    </div>
  );
}

export { median };
