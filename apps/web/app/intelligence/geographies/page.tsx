import type { Metadata } from 'next';
import Link from 'next/link';
import { Block, Coverage, IntelPage, JsonLd, NA, PageHead } from '@/components/intelligence/chrome';
import { BarList } from '@/components/intelligence/charts/bar-list';
import { WorldMap } from '@/components/intelligence/world-map';
import { countryLabel } from '@/lib/countries';
import { getGeographies } from '@/lib/intelligence/queries/lists';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { addDays, fmtDate, fmtInt, fmtPct, fmtSignedPct, MIN_SAMPLE, NA_FROM, NA_INSUFFICIENT } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, intelMetadata, webPageLd } from '@/lib/intelligence/seo';

export const dynamic = 'force-dynamic';

const DESCRIPTION = 'Classement des pays du recrutement Mode, Luxe, Beauté, Horlogerie et Retail : offres actives, nouvelles offres 30 jours, part de marché, Maisons, croissance ; carte du monde et top villes.';

export async function generateMetadata(): Promise<Metadata> {
  return intelMetadata({ subject: 'Géographies du recrutement luxe', description: DESCRIPTION, path: intelPaths.geographies });
}

export default async function Page() {
  const [data, coverage] = await Promise.all([getGeographies(), getCoverage()]);
  const growth = new Map(data.growth.map((g) => [g.key, g]));
  const crumbs = [{ name: 'Intelligence', path: intelPaths.home }, { name: 'Géographies', path: intelPaths.geographies }];

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: 'Géographies du recrutement', description: DESCRIPTION, path: intelPaths.geographies, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead crumbs={crumbs} title="Géographies." lede={<p>{fmtInt(data.countries.length)} pays avec au moins une offre active, classés par volume. La croissance à 30 jours est lue dans les snapshots quotidiens : elle s'affiche dès que le point J−30 existe.</p>} />

      <section className="container" style={{ paddingTop: 48 }}>
        <Block id="carte" title="Carte du monde." level="fact">
          <WorldMap data={data.countries} />
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="pays" title="Classement des pays." level="fact">
          <div className="itable-wrap">
            <table className="itable">
              <thead>
                <tr>
                  <th>Pays</th>
                  <th className="num">Actives</th>
                  <th className="num">Nouvelles · 30 j</th>
                  <th className="num">Part</th>
                  <th className="num">Maisons</th>
                  <th className="num">Croissance · 30 j</th>
                </tr>
              </thead>
              <tbody>
                {data.countries.map((c) => {
                  const g = growth.get(c.code);
                  const pct = g?.before && g.before.activeJobs >= MIN_SAMPLE ? (g.now.activeJobs - g.before.activeJobs) / g.before.activeJobs : null;
                  return (
                    <tr key={c.code}>
                      <td><Link href={intelPaths.country(c.code)}>{countryLabel(c.code)}</Link></td>
                      <td className="num">{fmtInt(c.active)}</td>
                      <td className="num">{fmtInt(c.new30)}</td>
                      <td className="num muted">{data.total >= MIN_SAMPLE ? fmtPct(c.active / data.total) : <NA na={NA_INSUFFICIENT(data.total)} />}</td>
                      <td className="num">{fmtInt(c.companies)}</td>
                      <td className="num muted">{pct !== null ? fmtSignedPct(pct) : <NA na={g?.before ? NA_INSUFFICIENT(g.before.activeJobs) : NA_FROM(addDays(coverage.historyStart, 30))} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.unknown > 0 && <p className="t-caption-soft mt-4">{fmtInt(data.unknown)} offres sans pays identifié ne sont pas classées.</p>}
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="villes" title="Top villes, monde." level="fact">
          <div className="igrid">
            <div className="i6">
              <BarList total={data.total} rows={data.cities.slice(0, 15).map((c) => ({ label: `${c.city}, ${countryLabel(c.code)}`, value: c.active, href: intelPaths.city(c.code, c.city), sub: `${fmtInt(c.companies)} Maisons` }))} />
            </div>
            <div className="i6">
              <BarList total={data.total} rows={data.cities.slice(15, 30).map((c) => ({ label: `${c.city}, ${countryLabel(c.code)}`, value: c.active, href: intelPaths.city(c.code, c.city), sub: `${fmtInt(c.companies)} Maisons` }))} />
            </div>
          </div>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 96, paddingBottom: 96 }}>
        <Coverage coverage={coverage} />
        <p className="t-caption-soft mt-3">Historique des snapshots dès le {fmtDate(coverage.historyStart)}.</p>
      </section>
    </IntelPage>
  );
}
