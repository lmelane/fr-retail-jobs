import {getSectorPresentation} from '@/lib/sectors';
import { getOccupationPresentation } from '@/lib/occupations';
import type { Metadata } from 'next';
import { Block, Coverage, IntelPage, JsonLd, Kpi, Mix, NA, PageHead } from '@/components/intelligence/chrome';
import { LineChart } from '@/components/intelligence/charts/line-chart';
import { IndexGauge } from '@/components/intelligence/charts/index-gauge';
import { SmallMultiples } from '@/components/intelligence/charts/small-multiples';
import { StackedArea } from '@/components/intelligence/charts/stacked-area';
import { employmentTermLabel } from '@/lib/format';
import { getMarket } from '@/lib/intelligence/queries/market';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { indexBase100, momentum, repostRate, variation } from '@/lib/intelligence/metrics';
import { addDays, fmtDate, fmtDays, fmtIndex, fmtInt, fmtPct, fmtSigned, fmtSignedPct, MIN_SAMPLE, NA_FROM, NA_INSUFFICIENT, OBSERVATION_START, windowAvailable, windowFrom } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, intelMetadata, webPageLd } from '@/lib/intelligence/seo';
import { UNCLASSIFIED_LABEL, type JobFamily } from '@/lib/intelligence/taxonomy';

export const dynamic = 'force-dynamic';

const DESCRIPTION = 'Global Hiring Pulse : offres actives, nouvelles et fermées par fenêtre (7 jours à 12 mois), Catwalks Global Hiring Index base 100, sous-indices par secteur, répartition contrat, séniorité et famille, durée médiane de publication, taux de repost.';

export async function generateMetadata(): Promise<Metadata> {
  return intelMetadata({ subject: 'Global Hiring Pulse — le marché en chiffres', description: DESCRIPTION, path: intelPaths.market });
}

export default async function Page() {
  const {label:sectorLabel}=await getSectorPresentation();
  const {FAMILY_LABELS,seniorityLabel}=await getOccupationPresentation();
  const [data, coverage] = await Promise.all([getMarket(), getCoverage()]);
  const h = data.headline;
  const idx = indexBase100(data.global);
  const mom = momentum(data.global);
  const repost = repostRate(h.reopened, h.active);
  const med = data.closed.closedSample30 >= MIN_SAMPLE && data.closed.medianLifespanDays30 !== null ? data.closed.medianLifespanDays30 : null;
  const families = data.families.map((f) => ({ label: f.key ? FAMILY_LABELS[f.key as JobFamily] : UNCLASSIFIED_LABEL, count: f.count }));
  // Aire empilée retail · corporate · atelier dans le temps : trois séries de
  // snapshots `family`, alignées sur les dates communes. Vide → n/d daté.
  const familyKeys: JobFamily[] = Object.keys(FAMILY_LABELS);
  const familyDates = data.familySeries.length > 0 ? data.familySeries[0].series.map((p) => p.date) : [];
  const familyPoints = familyDates
    .map((date) => ({ date, values: data.familySeries.map((s) => s.series.find((p) => p.date === date)?.activeJobs ?? NaN) }))
    .filter((p) => p.values.every((v) => Number.isFinite(v)));
  const crumbs = [{ name: 'Intelligence', path: intelPaths.home }, { name: 'Marché', path: intelPaths.market }];

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: 'Global Hiring Pulse', description: DESCRIPTION, path: intelPaths.market, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead
        crumbs={crumbs}
        title="Global Hiring Pulse."
        lede={<p>Le marché par fenêtre de temps. Les nouvelles et les fermetures sont lues dans les offres ; les variations d'actives et l'indice sont lus dans les snapshots quotidiens, qui commencent le {fmtDate(coverage.historyStart)}.</p>}
      />

      <section className="container" style={{ paddingTop: 48 }}>
        <div className="kpis">
          <Kpi label="Offres actives" value={fmtInt(h.active)} level="fact" green />
          {/* Même définition que le tableau (toutes offres vues pour la première fois dans la fenêtre) ; n/d tant que l'observation fiable ne couvre pas la fenêtre. */}
          <Kpi label="Nouvelles · 7 j" value={windowAvailable(7) ? fmtInt(data.windows.find((w) => w.days === 7)?.opened ?? 0) : undefined} na={windowAvailable(7) ? undefined : NA_FROM(windowFrom(7))} level="fact" />
          <Kpi label="Nouvelles · 30 j" value={windowAvailable(30) ? fmtInt(data.windows.find((w) => w.days === 30)?.opened ?? 0) : undefined} na={windowAvailable(30) ? undefined : NA_FROM(windowFrom(30))} level="fact" />
          <Kpi label="Fermées · 30 j" value={windowAvailable(30) ? fmtInt(data.closed.closed30d) : undefined} na={windowAvailable(30) ? undefined : NA_FROM(windowFrom(30))} level="fact" sub={windowAvailable(7) ? `${fmtInt(data.closed.closed7d)} sur 7 j` : undefined} />
          <Kpi label="Maisons qui recrutent" value={fmtInt(h.companies)} level="fact" />
          <Kpi label="Durée médiane de publication" value={med !== null ? fmtDays(med) : undefined} na={med === null ? NA_INSUFFICIENT(data.closed.closedSample30) : undefined} level="derived" sub="fermées des 30 derniers jours · ≠ time-to-fill" />
          <Kpi label="Taux de repost" value={repost.ok ? fmtPct(repost.value) : undefined} na={repost.ok ? undefined : repost.na} level="derived" sub={`${fmtInt(h.reopened)} offres ré-ouvertes`} />
          <Kpi label="Hiring momentum · 0-100" value={mom.ok ? String(mom.value.score) : undefined} na={mom.ok ? undefined : mom.na.kind === 'none' ? NA_FROM(addDays(coverage.historyStart, 7)) : mom.na} level="derived" />
        </div>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="fenetres" title="Le marché par fenêtre." level="fact">
          <div className="itable-wrap">
            <table className="itable">
              <thead>
                <tr>
                  <th>Fenêtre</th>
                  <th className="num">Nouvelles</th>
                  <th className="num">Fermées</th>
                  <th className="num">Solde net</th>
                  <th className="num">Δ actives</th>
                  <th className="num">Δ Maisons</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Aujourd'hui{!windowAvailable(1) && <span className="t-caption-soft"> · observation depuis le {fmtDate(OBSERVATION_START)}</span>}</td>
                  <td className="num">{windowAvailable(1) ? fmtInt(h.new24h) : <NA na={NA_FROM(windowFrom(1))} />}</td>
                  <td className="num muted">—</td>
                  <td className="num muted">—</td>
                  <td className="num muted">—</td>
                  <td className="num muted">—</td>
                </tr>
                {data.windows.map((w) => {
                  const v = variation(data.global, w.days);
                  const truncated = !windowAvailable(w.days);
                  const compBefore = data.global.length ? data.global.find((p) => p.date === addDays(data.global[data.global.length - 1].date, -w.days)) : undefined;
                  const companiesDelta = compBefore ? data.global[data.global.length - 1].hiringCompanies - compBefore.hiringCompanies : null;
                  return (
                    <tr key={w.key}>
                      <td>
                        {w.days === 7 ? '7 jours' : w.days === 30 ? '30 jours' : w.days === 90 ? '3 mois' : w.days === 180 ? '6 mois' : '12 mois'}
                        {truncated && <span className="t-caption-soft"> · observation depuis le {fmtDate(OBSERVATION_START)}</span>}
                      </td>
                      <td className="num">{truncated ? <NA na={NA_FROM(windowFrom(w.days))} /> : fmtInt(w.opened)}</td>
                      <td className="num">{truncated ? <NA na={NA_FROM(windowFrom(w.days))} /> : fmtInt(w.closed)}</td>
                      <td className="num">{truncated ? <NA na={NA_FROM(windowFrom(w.days))} /> : fmtSigned(w.opened - w.closed)}</td>
                      <td className="num muted">{v.ok ? fmtSignedPct(v.value.pct) : <NA na={v.na} />}</td>
                      <td className="num muted">{companiesDelta !== null ? fmtSigned(companiesDelta) : <NA na={v.ok ? { kind: 'none' } : v.na} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="t-caption-soft mt-4">Nouvelles = offres vues pour la première fois dans la fenêtre (vivantes ou fermées depuis). Fermées = offres closes dans la fenêtre. Solde net = nouvelles − fermées (dérivé). Δ = comparaison au snapshot daté exactement J−n. Une fenêtre plus longue que l'observation fiable (depuis le {fmtDate(OBSERVATION_START)}) reste n/d.</p>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <div className="igrid">
          <div className="i8">
            <Block id="cghi" title="Catwalks Global Hiring Index." level="derived">
              {idx.ok ? (
                <LineChart points={idx.value} baseline={100} format={fmtIndex} ariaLabel="Catwalks Global Hiring Index, base 100" />
              ) : (
                <IndexGauge value={null} na={idx.na.kind === 'none' ? NA_FROM(addDays(coverage.historyStart, 1)) : idx.na} baseDate={coverage.historyStart} ariaLabel="Indice base 100" />
              )}
              <p className="t-body2 muted mt-4 max-w-[66ch]">Base 100 au premier snapshot global ; valeur du jour = offres actives du jour / offres actives de la base × 100.</p>
            </Block>
          </div>
          <div className="i4">
            <Block id="sous-indices" title="Sous-indices sectoriels." level="derived">
              <SmallMultiples
                format={fmtIndex}
                items={data.sectorSeries.map((s) => {
                  const r = indexBase100(s.series);
                  return { label: sectorLabel(s.key), href: intelPaths.sector(s.key), points: r.ok ? r.value : undefined, na: r.ok ? undefined : r.na.kind === 'none' ? NA_FROM(addDays(coverage.historyStart, 1)) : r.na };
                })}
              />
            </Block>
          </div>
        </div>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <div className="igrid">
          <div className="i4">
            <Block id="contrat" title="Contrats." level="fact-shares">
              <Mix total={h.active} rows={data.contracts.map((c) => ({ label: c.key ? employmentTermLabel(c.key) ?? c.key : 'Non précisé', count: c.count, href: c.key ? intelPaths.jobs({ employmentTerm: c.key }) : undefined }))} />
            </Block>
          </div>
          <div className="i4">
            <Block id="seniorite" title="Séniorité." level="fact-shares">
              <Mix total={h.active} rows={data.seniority.map((s) => ({ label: seniorityLabel(s.key || null), count: s.count }))} />
            </Block>
          </div>
          <div className="i4">
            <Block id="famille" title="Domaines professionnels." level="fact-shares">
              <Mix total={h.active} rows={families} />
            </Block>
          </div>
          <div className="i12">
            <Block id="famille-serie" title="Familles dans le temps." level="derived">
              {familyPoints.length >= 2 ? (
                <StackedArea points={familyPoints} labels={familyKeys.map((k) => FAMILY_LABELS[k])} ariaLabel="Offres actives par famille, jour par jour" />
              ) : (
                <p className="na">Les comparaisons par domaine seront disponibles après deux journées complètes mesurées avec le même référentiel.</p>
              )}
            </Block>
          </div>
        </div>
      </section>

      <section className="container" style={{ paddingTop: 96, paddingBottom: 96 }}>
        <Coverage coverage={coverage} />
      </section>
    </IntelPage>
  );
}
