import {getSectorPresentation} from '@/lib/sectors';
import { getOccupationPresentation } from '@/lib/occupations';
import type { Metadata } from 'next';
import { Block, Coverage, IntelPage, JsonLd, Kpi, Mix, PageHead } from '@/components/intelligence/chrome';
import { BarList } from '@/components/intelligence/charts/bar-list';
import { countryLabel } from '@/lib/countries';
import { getSectorsList } from '@/lib/intelligence/queries/lists';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { share } from '@/lib/intelligence/metrics';
import { fmtInt, fmtNew, fmtPct } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, intelMetadata, webPageLd } from '@/lib/intelligence/seo';
import { OTHER_SECTOR_LABEL, UNCLASSIFIED_LABEL } from '@/lib/intelligence/taxonomy';

export const dynamic = 'force-dynamic';

const DESCRIPTION = 'Mode, Luxe, Beauté, Horlogerie & Joaillerie, Retail : volumes d’offres actives, parts, nouvelles offres 30 jours, top pays, top Maisons et mix métiers par secteur.';

export async function generateMetadata(): Promise<Metadata> {
  return intelMetadata({ subject: 'Secteurs : Mode, Luxe, Beauté, Horlogerie, Retail', description: DESCRIPTION, path: intelPaths.sectors });
}

export default async function Page() {
  const presentation=await getSectorPresentation();
  const SECTORS=presentation.sectors.map(s=>s.code),SECTOR_LABELS=presentation.labels,SECTOR_SLUGS=Object.fromEntries(presentation.sectors.map(s=>[s.code,s.code.toLowerCase().replace(/_/g,'-')]));
  const {JOB_FUNCTIONS,FUNCTION_BY_KEY,FAMILY_LABELS,functionLabel}=await getOccupationPresentation();
  const [data, coverage] = await Promise.all([getSectorsList(), getCoverage()]);
  const byKey = new Map(data.rows.map((r) => [r.key, r]));
  const others = data.rows.filter((r) => !(SECTORS as ReadonlyArray<string>).includes(r.key));
  const othersCount = others.reduce((s, r) => s + r.count, 0);
  const crumbs = [{ name: 'Intelligence', path: intelPaths.home }, { name: 'Secteurs', path: intelPaths.sectors }];

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: 'Secteurs du recrutement luxe', description: DESCRIPTION, path: intelPaths.sectors, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead crumbs={crumbs} title="Secteurs." lede={<p>Le secteur est celui de la Maison qui publie l'offre. Une Maison peut appartenir à plusieurs secteurs : les volumes se recouvrent et ne doivent pas être additionnés. « Secteur à vérifier » conserve les offres dont le classement attend une preuve.</p>} />

      <section className="container" style={{ paddingTop: 48 }}>
        <div className="kpis">
          {SECTORS.map((s) => {
            const row = byKey.get(s);
            const sh = share(row?.count ?? 0, data.total);
            // Le « +N sur 30 j » ne s'affiche que si l'observation couvre la
            // fenêtre : sinon il recopierait le total (cf. `fmtNew`).
            const new30 = fmtNew(row?.new30 ?? 0);
            const part = sh.ok ? `${fmtPct(sh.value)} des offres` : null;
            const sub = [part, new30 ? `+${new30} sur 30 j` : null].filter(Boolean).join(' · ') || undefined;
            return <Kpi key={s} label={SECTOR_LABELS[s]} value={fmtInt(row?.count ?? 0)} level="fact" sub={sub} />;
          })}
        </div>
      </section>

      {SECTORS.map((s) => {
        const row = byKey.get(s);
        const fns = (data.functionsBySector[s] ?? []).filter((f) => f.key !== '').slice(0, 8);
        const unclassified = (data.functionsBySector[s] ?? []).find((f) => f.key === '')?.count ?? 0;
        return (
          <section key={s} className="container" style={{ paddingTop: 64 }} id={SECTOR_SLUGS[s]}>
            <Block id={`s-${SECTOR_SLUGS[s]}`} title={`${SECTOR_LABELS[s]}.`} level="fact" more={{ href: intelPaths.jobs({ secteur: s }), label: `Voir les ${fmtInt(row?.count ?? 0)} offres` }}>
              {row && row.count > 0 ? (
                <div className="igrid">
                  <div className="i4">
                    <p className="t-caption mb-3">Top pays</p>
                    <BarList compact total={row.count} rows={row.topCountries.map((c) => ({ label: countryLabel(c.code), value: c.count, href: intelPaths.country(c.code) }))} />
                  </div>
                  <div className="i4">
                    <p className="t-caption mb-3">Top Maisons</p>
                    <BarList compact total={row.count} rows={row.topCompanies.map((c) => ({ label: c.name, value: c.count, href: intelPaths.company(c.name) }))} />
                  </div>
                  <div className="i4">
                    <p className="t-caption mb-3">Mix métiers</p>
                    {fns.length > 0 ? (
                      <Mix total={row.count} rows={fns.map((f) => ({ label: functionLabel(f.key), count: f.count, href: intelPaths.fn(f.key) }))} />
                    ) : (
                      <p className="na">Aucune offre classée par métier.</p>
                    )}
                    <p className="t-caption-soft mt-3">{UNCLASSIFIED_LABEL} : {fmtInt(unclassified)}</p>
                  </div>
                </div>
              ) : (
                <p className="na">Aucune offre active dans ce secteur pour l'instant.</p>
              )}
            </Block>
          </section>
        );
      })}

      <section className="container" style={{ paddingTop: 64 }} id="autres">
        <Block id="s-autres" title={`${OTHER_SECTOR_LABEL}.`} level="fact">
          {othersCount > 0 ? (
            <BarList total={data.total} rows={others.map((r) => ({ label: presentation.label(r.key), value: r.count }))} />
          ) : (
            <p className="na">Toutes les offres ont au moins un secteur renseigné.</p>
          )}
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 96, paddingBottom: 96 }}>
        <Coverage coverage={coverage} />
      </section>
    </IntelPage>
  );
}
