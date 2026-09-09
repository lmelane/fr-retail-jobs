import { getOccupationPresentation } from '@/lib/occupations';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Block, Coverage, IntelPage, JsonLd, Kpi, Placeholder } from '@/components/intelligence/chrome';
import { BarList } from '@/components/intelligence/charts/bar-list';
import { LineChart } from '@/components/intelligence/charts/line-chart';
import { IndexGauge } from '@/components/intelligence/charts/index-gauge';
import { WorldMap } from '@/components/intelligence/world-map';
import { countryLabel } from '@/lib/countries';
import { getHome } from '@/lib/intelligence/queries/home';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { indexBase100, momentum } from '@/lib/intelligence/metrics';
import { addDays, fmtDate, fmtIndex, fmtInt, fmtSignedPct, MIN_SAMPLE, NA_FROM, windowAvailable, windowFrom } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { datasetLd, intelMetadata } from '@/lib/intelligence/seo';
import { mergeOtherSectors, sectorLabel, UNCLASSIFIED_LABEL } from '@/lib/intelligence/taxonomy';

export const dynamic = 'force-dynamic';

const DESCRIPTION = "Observatoire mondial du recrutement Mode, Luxe, Beauté, Horlogerie et Retail : offres actives, nouvelles offres, Maisons qui recrutent, pays et villes, indice base 100 — chaque chiffre lu dans la base, jamais inventé.";

export async function generateMetadata(): Promise<Metadata> {
  return intelMetadata({ subject: 'Le marché mondial du recrutement luxe', description: DESCRIPTION, path: intelPaths.home });
}

export default async function Page() {
  const {JOB_FUNCTIONS,FUNCTION_BY_KEY,FAMILY_LABELS,functionLabel}=await getOccupationPresentation();
  const [data, coverage] = await Promise.all([getHome(), getCoverage()]);
  const h = data.headline;
  const idx = indexBase100(data.global);
  const mom = momentum(data.global);
  const lastIdx = idx.ok ? idx.value[idx.value.length - 1].value : null;
  const total = h.active;
  const unclassified = data.functions.find((f) => f.key === '')?.count ?? 0;
  const topFn = data.functions.filter((f) => f.key !== '').slice(0, 8);

  // « Où le recrutement accélère » : variation J-7 par pays, lue dans les
  // snapshots — seulement les pays avec un point J-7 ET ≥ 30 offres.
  const accelerating = data.accelerating
    .filter((a) => a.before && a.before.activeJobs >= MIN_SAMPLE)
    .map((a) => ({ code: a.key, pct: (a.now.activeJobs - (a.before as NonNullable<typeof a.before>).activeJobs) / (a.before as NonNullable<typeof a.before>).activeJobs, now: a.now.activeJobs }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);

  return (
    <IntelPage>
      <JsonLd data={datasetLd({ description: DESCRIPTION, historyStart: coverage.historyStart, dateModified: coverage.updatedAt, jobs: coverage.jobs, countries: coverage.countries })} />

      {/* ————— Hero vert-nuit + bandeau KPI ————— */}
      <section className="intel-hero" aria-labelledby="intel-title">
        <div className="container">
          <p className="t-caption mb-4">Catwalks Intelligence</p>
          <h1 id="intel-title" className="t-hero" style={{ maxWidth: '18ch' }}>
            Le marché mondial du recrutement luxe, mesuré chaque jour.
          </h1>
          <p className="t-body lede mt-6">
            Où le secteur recrute, quels métiers, chez quelles Maisons — {fmtInt(coverage.jobs)} offres publiques de {fmtInt(coverage.companies)} Maisons dans {fmtInt(coverage.countries)} pays{coverage.updatedAt ? `, mises à jour le ${fmtDate(coverage.updatedAt)}` : ''}.
          </p>
          <div className="kpis">
            <Kpi label="Offres actives" value={fmtInt(h.active)} level="fact" />
            <Kpi label="Nouvelles · 30 j" value={windowAvailable(30) ? fmtInt(h.new30d) : undefined} na={windowAvailable(30) ? undefined : NA_FROM(windowFrom(30))} level="fact" sub={windowAvailable(7) ? `${fmtInt(h.new7d)} sur 7 j` : undefined} />
            <Kpi label="Nouvelles · 24 h" value={windowAvailable(1) ? fmtInt(h.new24h) : undefined} na={windowAvailable(1) ? undefined : NA_FROM(windowFrom(1))} level="fact" />
            <Kpi label="Maisons qui recrutent" value={fmtInt(h.companies)} level="fact" />
            <Kpi label="Pays" value={fmtInt(data.countries.length)} level="fact" />
            <Kpi label="Villes" value={fmtInt(h.cities)} level="fact" />
            <Kpi
              label="Catwalks Global Hiring Index"
              value={lastIdx !== null ? fmtIndex(lastIdx) : undefined}
              na={idx.ok ? undefined : idx.na.kind === 'none' ? NA_FROM(addDays(coverage.historyStart, 1)) : idx.na}
              sub={`base 100 le ${fmtDate(data.global[0]?.date ?? coverage.historyStart)}`}
              level="derived"
            />
            <Kpi label="Hiring momentum · 0-100" value={mom.ok ? String(mom.value.score) : undefined} na={mom.ok ? undefined : mom.na.kind === 'none' ? NA_FROM(addDays(coverage.historyStart, 7)) : mom.na} level="derived" />
          </div>
        </div>
      </section>

      <div className="container">
        <Coverage coverage={coverage} />
      </div>

      {/* ————— Carte du monde ————— */}
      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="carte" title="Où le monde recrute." level="fact" more={{ href: intelPaths.geographies, label: 'Classement des pays' }}>
          <WorldMap data={data.countries} />
          <p className="t-caption-soft mt-4">
            {fmtInt(data.countries.length)} pays avec au moins une offre · cliquer un pays ouvre sa page
            {data.countriesUnknown > 0 && <> · {fmtInt(data.countriesUnknown)} offres sans pays identifié</>}
          </p>
        </Block>
      </section>

      {/* ————— Où le recrutement accélère ————— */}
      <section className="container" style={{ paddingTop: 64 }}>
        <div className="igrid">
          <div className="i6">
            <Block id="accelere" title="Où le recrutement accélère." level="derived">
              {accelerating.length > 0 ? (
                <BarList rows={accelerating.map((a) => ({ label: countryLabel(a.code), value: a.pct * 100, href: intelPaths.country(a.code), sub: `${fmtInt(a.now)} offres` }))} format={(v) => fmtSignedPct(v / 100)} />
              ) : (
                <Placeholder text={`Variation à 7 jours par pays, lue dans les snapshots quotidiens — disponible à partir du ${fmtDate(addDays(coverage.historyStart, 7))}.`} />
              )}
            </Block>
          </div>
          <div className="i6">
            <Block id="indice" title="Catwalks Global Hiring Index." level="derived" more={{ href: intelPaths.market, label: 'Global Hiring Pulse' }}>
              {idx.ok ? (
                <>
                  <LineChart points={idx.value} baseline={100} format={fmtIndex} ariaLabel="Indice base 100 des offres actives, monde" />
                  <div className="mt-4">
                    <IndexGauge value={lastIdx} baseDate={data.global[0].date} ariaLabel="Jauge de l'indice base 100" />
                  </div>
                </>
              ) : (
                <IndexGauge value={null} na={idx.na.kind === 'none' ? NA_FROM(addDays(coverage.historyStart, 1)) : idx.na} baseDate={coverage.historyStart} ariaLabel="Jauge de l'indice base 100" />
              )}
            </Block>
          </div>
        </div>
      </section>

      {/* ————— Tops ————— */}
      <section className="container" style={{ paddingTop: 64 }}>
        <div className="igrid">
          <div className="i6">
            <Block id="pays" title="Top pays." level="fact-shares" more={{ href: intelPaths.geographies, label: 'Tous les pays' }}>
              <BarList total={total} rows={data.countries.slice(0, 10).map((c) => ({ label: countryLabel(c.code), value: c.active, href: intelPaths.country(c.code), sub: `${fmtInt(c.companies)} Maisons` }))} />
            </Block>
          </div>
          <div className="i6">
            <Block id="villes" title="Top villes." level="fact-shares">
              <BarList total={total} rows={data.cities.map((c) => ({ label: `${c.city}, ${countryLabel(c.code)}`, value: c.active, href: intelPaths.city(c.code, c.city) }))} />
            </Block>
          </div>
          <div className="i6">
            <Block id="metiers" title="Top métiers." level="fact-shares" more={{ href: intelPaths.functions, label: 'Les 25 métiers' }}>
              {topFn.length > 0 ? (
                <BarList total={total} rows={topFn.map((f) => ({ label: functionLabel(f.key), value: f.count, href: intelPaths.fn(f.key) }))} />
              ) : (
                <p className="na">Aucune offre classée par métier pour l'instant.</p>
              )}
              <p className="t-caption-soft mt-3">{UNCLASSIFIED_LABEL} : {fmtInt(unclassified)} offres — couverture de la classification.</p>
            </Block>
          </div>
          <div className="i6">
            <Block id="secteurs" title="Top secteurs." level="fact-shares" more={{ href: intelPaths.sectors, label: 'Tous les secteurs' }}>
              <BarList total={total} rows={mergeOtherSectors(data.sectors).map((s) => ({ label: sectorLabel(s.key), value: s.count, href: s.key === 'OTHER' ? undefined : intelPaths.sector(s.key), sub: `${fmtInt(s.companies)} Maisons` }))} />
            </Block>
          </div>
          <div className="i6">
            <Block id="groupes" title="Top groupes." level="fact-shares">
              {data.groups.length > 0 ? (
                <BarList total={total} rows={data.groups.map((g) => ({ label: g.key, value: g.count, href: intelPaths.group(g.key), sub: `${fmtInt(g.companies)} Maisons` }))} />
              ) : (
                <p className="na">Aucun groupe rattaché dans la base.</p>
              )}
            </Block>
          </div>
          <div className="i6">
            <Block id="maisons" title="Top Maisons." level="fact-shares">
              <BarList total={total} rows={data.companies.map((c) => ({ label: c.name, value: c.active, href: intelPaths.company(c.name), sub: c.group ?? sectorLabel(c.sector) }))} />
            </Block>
          </div>
        </div>
      </section>

      {/* ————— Ce qui a changé cette semaine (lot W2) ————— */}
      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="semaine" title="Ce qui a changé cette semaine." level="insight">
          <Placeholder text={`Disponible dès la première semaine d'historique, à partir du ${fmtDate(addDays(coverage.historyStart, 7))}.`} />
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 96, paddingBottom: 96 }}>
        <Coverage coverage={coverage} />
        <p className="t-body2 muted mt-4 max-w-[66ch]">
          Un fait est un compte observé. Une métrique dérivée est un calcul (part, variation, médiane, indice). Une lecture Catwalks est une phrase construite sur ces chiffres. Sous 30 offres ou 2 jours de snapshot, une métrique dérivée s'affiche n/d. <Link href={intelPaths.methodology} className="u-line text-ink">Lire la méthodologie</Link>.
        </p>
      </section>
    </IntelPage>
  );
}
