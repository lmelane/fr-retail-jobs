import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Block, IntelPage, JsonLd, NA, PageHead } from '@/components/intelligence/chrome';
import { ProfileBlocks, ProfileFooter, ProfileKpis, ProfileSeries } from '@/components/intelligence/profile-view';
import { getProfile } from '@/lib/intelligence/queries/profile';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { resolveGroup } from '@/lib/intelligence/queries/resolve';
import { addDays, fmtInt, fmtPct, MIN_SAMPLE, NA_FROM } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, intelMetadata, webPageLd } from '@/lib/intelligence/seo';
import { sectorLabel } from '@/lib/intelligence/taxonomy';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const group = await resolveGroup((await params).slug);
  if (!group) return { title: 'Groupe introuvable' };
  const profile = await getProfile({ group }, { snapshot: { scope: 'group', key: group }, limits: { companies: 100 } });
  const n = profile.headline.active;
  return intelMetadata({
    subject: `Groupe ${group} : intelligence recrutement`,
    description: `${group} : ${fmtInt(n)} offres actives, ${fmtInt(profile.headline.companies)} Maisons, ${fmtInt(profile.countriesTotal)} pays. Tableau des Maisons du groupe (actives, 30 jours, momentum), métiers, séniorité, contrats.`,
    path: intelPaths.group(group),
    noindex: n < MIN_SAMPLE,
  });
}

export default async function Page({ params }: Params) {
  const group = await resolveGroup((await params).slug);
  if (!group) notFound();
  const [profile, coverage] = await Promise.all([getProfile({ group }, { snapshot: { scope: 'group', key: group }, limits: { companies: 100 } }), getCoverage()]);
  const h = profile.headline;
  const path = intelPaths.group(group);
  const crumbs = [{ name: 'Intelligence', path: intelPaths.home }, { name: group, path }];
  const ctx = { kind: 'group' as const, name: group, jobsParams: { groupe: group } };

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: `Groupe ${group} — intelligence recrutement`, description: `${fmtInt(h.active)} offres actives dans les Maisons du groupe ${group}.`, path, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead crumbs={crumbs} eyebrow="Groupe" title={group} lede={<p>{fmtInt(h.active)} offres actives dans {fmtInt(h.companies)} Maisons, {fmtInt(profile.countriesTotal)} pays. Une offre est créditée à la Maison qui la publie ; le groupe est la somme de ses Maisons.</p>} />

      <section className="container" style={{ paddingTop: 48 }}>
        <ProfileKpis profile={profile} coverage={coverage} ctx={ctx} />
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="maisons-du-groupe" title={`Les Maisons de ${group}.`} level="fact">
          <div className="itable-wrap">
            <table className="itable">
              <thead>
                <tr>
                  <th>Maison</th>
                  <th>Secteur</th>
                  <th className="num">Actives</th>
                  <th className="num">Part du groupe</th>
                  <th className="num">Nouvelles · 30 j</th>
                  <th className="num">Momentum</th>
                </tr>
              </thead>
              <tbody>
                {profile.companies.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={intelPaths.company(c.name)}>{c.name}</Link></td>
                    <td className="muted">{sectorLabel(c.sector)}</td>
                    <td className="num">{fmtInt(c.active)}</td>
                    <td className="num muted">{h.active >= MIN_SAMPLE ? fmtPct(c.active / h.active) : <NA na={{ kind: 'insufficient', n: h.active }} />}</td>
                    <td className="num">{fmtInt(c.new30)}</td>
                    <td className="num muted"><NA na={profile.series.length >= 2 ? { kind: 'none' } : NA_FROM(addDays(coverage.historyStart, 7))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="t-caption-soft mt-4">Le momentum par Maison lit les snapshots `company` : il s'affiche dès qu'un point J−7 existe pour la Maison.</p>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <ProfileSeries profile={profile} coverage={coverage} title={`Offres actives du groupe ${group}, jour par jour.`} />
      </section>
      <section className="container" style={{ paddingTop: 64 }}>
        <ProfileBlocks profile={profile} ctx={ctx} />
      </section>
      <ProfileFooter coverage={coverage} jobs={h.active} />
    </IntelPage>
  );
}
