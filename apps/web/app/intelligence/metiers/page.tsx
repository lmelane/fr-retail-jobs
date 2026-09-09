import { getOccupationPresentation, getOccupationMetrics } from '@/lib/occupations';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Block, Coverage, IntelPage, JsonLd, NA, PageHead } from '@/components/intelligence/chrome';
import { countryLabel } from '@/lib/countries';
import { getFunctionsList } from '@/lib/intelligence/queries/lists';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { fmtInt, fmtNew, fmtPct, MIN_SAMPLE, NA_FROM, NA_INSUFFICIENT, windowFrom } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, intelMetadata, webPageLd } from '@/lib/intelligence/seo';
import { UNCLASSIFIED_LABEL } from '@/lib/intelligence/taxonomy';

export const dynamic = 'force-dynamic';

const DESCRIPTION = 'Les métiers et familles professionnelles du secteur Mode, Luxe, Beauté, Horlogerie et Retail : demande (offres actives), part, nouvelles offres 30 jours, top pays, top Maisons et séniorité dominante. Classification par règles, couverture affichée.';

export async function generateMetadata(): Promise<Metadata> {
  return intelMetadata({ subject: 'Métiers du luxe : la demande par fonction', description: DESCRIPTION, path: intelPaths.functions });
}

export default async function Page() {
  const {taxonomy,JOB_FUNCTIONS,FUNCTION_BY_KEY,FAMILY_LABELS,functionLabel,seniorityLabel}=await getOccupationPresentation();
  const [data, coverage] = await Promise.all([getFunctionsList(), getCoverage()]);
  const occupations=await getOccupationMetrics();
  const occupationRows=[...taxonomy.occupations.values()].map(d=>({key:d.key,label:d.labels.fr,family:functionLabel(d.family),count:occupations.counts.get(d.key)??0})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  const byKey = new Map(data.rows.map((r) => [r.key, r]));
  const unclassified = byKey.get('');
  const rows = JOB_FUNCTIONS.map((f) => ({ def: f, row: byKey.get(f.key) })).sort((a, b) => (b.row?.count ?? 0) - (a.row?.count ?? 0));
  const crumbs = [{ name: 'Intelligence', path: intelPaths.home }, { name: 'Métiers', path: intelPaths.functions }];

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: 'Métiers du luxe', description: DESCRIPTION, path: intelPaths.functions, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead crumbs={crumbs} title="Métiers." lede={<p>Les métiers identifiés et les familles professionnelles, classés par nombre d’offres actives. Les intitulés d’origine restent consultables, y compris lorsqu’ils ne peuvent pas encore être classés.</p>} />

      <section className="container" style={{ paddingTop: 48 }}>
        <Block id="metiers" title="Métiers identifiés." level="fact">
          {!occupations.ready&&<p role="status" className="t-body soft mb-5">Le reclassement des offres est en cours. Les totaux par métier peuvent encore évoluer ; toutes les offres restent consultables.</p>}
          <p className="t-body soft mb-5">{fmtInt(occupations.classified)} offres sur {fmtInt(occupations.total)} ont un métier précis identifié. {fmtInt(occupations.unclassified)} restent à préciser ou présentent plusieurs métiers possibles. <Link href="/emplois?metier=unclassified">Consulter ces offres</Link>.</p>
          <div className="itable-wrap"><table className="itable">
            <thead><tr><th>Métier</th><th>Famille professionnelle</th><th className="num">Offres actives</th></tr></thead>
            <tbody>{occupationRows.filter(o=>o.count>0).map(o=><tr key={o.key}><td><Link href={intelPaths.fn(o.key)}>{o.label}</Link></td><td>{o.family}</td><td className="num">{fmtInt(o.count)}</td></tr>)}</tbody>
          </table></div>
          {occupations.classified===0&&<p className="t-body">Le classement détaillé est en cours. Toutes les offres restent accessibles dans la recherche.</p>}
        </Block>
        <Block id="fonctions" title="Familles professionnelles." level="fact">
          <div className="itable-wrap">
            <table className="itable">
              <thead>
                <tr>
                  <th>Métier</th>
                  <th>Famille</th>
                  <th className="num">Demande</th>
                  <th className="num">Part</th>
                  <th className="num">Nouvelles · 30 j</th>
                  <th>Top pays</th>
                  <th>Top Maisons</th>
                  <th>Séniorité dominante</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ def, row }) => (
                  <tr key={def.key}>
                    <td><Link href={intelPaths.fn(def.key)}>{def.label}</Link></td>
                    <td className="muted">{FAMILY_LABELS[def.family]}</td>
                    <td className="num">{fmtInt(row?.count ?? 0)}</td>
                    <td className="num muted">{data.total >= MIN_SAMPLE ? fmtPct((row?.count ?? 0) / data.total) : <NA na={NA_INSUFFICIENT(data.total)} />}</td>
                    <td className="num">{fmtNew(row?.new30 ?? 0) ?? <NA na={NA_FROM(windowFrom(30))} />}</td>
                    <td className="muted">{row && row.topCountries.length > 0 ? row.topCountries.map((c) => countryLabel(c.code)).join(' · ') : '—'}</td>
                    <td className="muted">{row && row.topCompanies.length > 0 ? row.topCompanies.map((c) => c.name).join(' · ') : '—'}</td>
                    <td className="muted">{row && row.seniority[0] ? seniorityLabel(row.seniority[0].key || null) : '—'}</td>
                  </tr>
                ))}
                <tr>
                  <td>{UNCLASSIFIED_LABEL}</td>
                  <td className="muted">—</td>
                  <td className="num">{fmtInt(unclassified?.count ?? 0)}</td>
                  <td className="num muted">{data.total >= MIN_SAMPLE ? fmtPct((unclassified?.count ?? 0) / data.total) : <NA na={NA_INSUFFICIENT(data.total)} />}</td>
                  <td className="num">{fmtNew(unclassified?.new30 ?? 0) ?? <NA na={NA_FROM(windowFrom(30))} />}</td>
                  <td className="muted">{unclassified && unclassified.topCountries.length > 0 ? unclassified.topCountries.map((c) => countryLabel(c.code)).join(' · ') : '—'}</td>
                  <td className="muted">{unclassified && unclassified.topCompanies.length > 0 ? unclassified.topCompanies.map((c) => c.name).join(' · ') : '—'}</td>
                  <td className="muted">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="t-caption-soft mt-4">Demande = offres actives portant la fonction. Part = demande / {fmtInt(data.total)} offres actives (dérivée).</p>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 96, paddingBottom: 96 }}>
        <Coverage coverage={coverage} />
      </section>
    </IntelPage>
  );
}
