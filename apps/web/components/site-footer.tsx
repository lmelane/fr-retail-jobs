import Link from 'next/link';
import { landingStats } from '@/lib/jobs';

/**
 * Footer (design_2.md §4.14), identical on every route.
 *
 * Filet pointillé haut, 3 colonnes 4/4/4 : marque · RECHERCHER · CANDIDATS (en
 * vert — le seul vert du footer, comme « FOLLOW US » de la référence) +
 * INFORMATIONS. Ligne finale sous un second filet avec l'horodatage de l'ingest
 * (signal de fraîcheur propre au digest). Le compteur d'offres est lu à la
 * source (mêmes valeurs que les stats de la home), 0 si la base est indisponible.
 */

const ArrowUpRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="12" height="12" className="ml-1 inline-block align-[-1px]"><path d="M7 17 17 7M8 7h9v9" /></svg>
);

export async function SiteFooter() {
  const stats = await landingStats().catch(() => ({ offers: 0, companies: 0, countries: 0 }));
  const nf = new Intl.NumberFormat('fr-FR');

  return (
    <footer className="rule bg-paper">
      <div className="mx-auto grid max-w-[var(--fa-container)] grid-cols-1 gap-x-10 gap-y-12 px-6 pt-16 pb-10 md:grid-cols-3">
        {/* Marque */}
        <div>
          <span className="wordmark text-ink">
            Fashion Atlas
          </span>
          <p className="t-body2 muted mt-4 max-w-[34ch]">
            Le moteur de recherche des offres Mode, Luxe, Beauté &amp; Retail.
          </p>
          <a href="https://catwalks.io" target="_blank" rel="noopener noreferrer" className="t-body2 mt-3 inline-block text-ink hover:underline hover:underline-offset-4">
            Une marque Catwalks <ArrowUpRight />
          </a>
        </div>

        {/* Rechercher */}
        <nav aria-label="Rechercher">
          <p className="t-caption mb-5 text-ink">Rechercher</p>
          <ul className="space-y-[14px]">
            <FooterLink href="/emplois">Toutes les offres</FooterLink>
            <FooterLink href="/entreprises">Les Maisons</FooterLink>
            <FooterLink href="/emplois?secteur=FASHION">Par secteur</FooterLink>
            <FooterLink href="/emplois?pays=FR">Par pays</FooterLink>
          </ul>
        </nav>

        {/* Candidats (vert) + Informations */}
        <div className="space-y-10">
          <nav aria-label="Candidats">
            <p className="t-caption mb-5 text-green">Candidats</p>
            <ul className="space-y-[14px]">
              <FooterExternal href="https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator&utm_campaign=footer">Créer mon profil</FooterExternal>
              <FooterExternal href="https://catwalks.io">Matching Catwalks</FooterExternal>
              {/* L'alerte vit sur Catwalks (D18) : lien externe, jamais une page
                  /matching interne qui promettrait un service qu'on ne rend pas. */}
              <FooterExternal href="https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator&utm_campaign=footer-alerte">Créer une alerte</FooterExternal>
            </ul>
          </nav>
          <nav aria-label="Informations">
            <p className="t-caption mb-5 text-ink">Informations</p>
            <ul className="space-y-[14px]">
              <FooterExternal href="https://catwalks.io/cgu">Conditions d’utilisation</FooterExternal>
              <FooterExternal href="https://catwalks.io/confidentialite">Confidentialité</FooterExternal>
              <FooterExternal href="https://catwalks.io/mentions-legales">Mentions légales</FooterExternal>
            </ul>
          </nav>
        </div>
      </div>

      <div className="rule mx-auto max-w-[var(--fa-container)] px-6">
        <p className="t-caption-soft py-6">
          Catwalks {new Date().getFullYear()} © — Tous droits réservés
          {stats.offers > 0 && <> · {nf.format(stats.offers)} offres indexées</>}
          {' · '}Mise à jour quotidienne
        </p>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="t-ui text-ink hover:underline hover:underline-offset-4">
        {children}
      </Link>
    </li>
  );
}

function FooterExternal({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <a href={href} target="_blank" rel="noopener noreferrer" className="t-ui text-ink hover:underline hover:underline-offset-4">
        {children}
        <ArrowUpRight />
      </a>
    </li>
  );
}
