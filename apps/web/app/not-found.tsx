import Link from 'next/link';

/**
 * 404 (design_2.md §4.13, réf etats.html). Colonne gauche vide (6 col), à
 * droite titre FA Display uppercase VERT + bouton outline vert « Accueil ».
 * Le header (blanc hors hero) et le footer viennent du layout global.
 */
export default function NotFound() {
  return (
    <main className="page bg-paper">
      <section className="container notfound rule-b" aria-labelledby="nf-title">
        <div className="g12 items-center">
          <div className="c6" aria-hidden />
          <div className="c6">
            <h1 className="t-hero" id="nf-title">
              Oups, cette page n’existe pas ou a été déplacée.
            </h1>
            <div className="mt-6">
              <Link className="btn btn--green" href="/">
                Accueil
                <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
