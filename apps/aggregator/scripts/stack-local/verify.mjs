/**
 * Vérifications de la stack locale : chacune produit un constat (ok / détail)
 * consigné dans `.stack-local/proofs/verify-<horodatage>.json` avec les
 * captures d'écran du navigateur. Une vérification qui ne peut pas conclure
 * le dit ; aucune n'est « verte par défaut ».
 */
import { spawn } from 'node:child_process';
import nodeHttp from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, STATE, run } from './infra.mjs';
import { backendDbUrl, catalogueDbUrl, envCli, urls } from './env.mjs';

const attendu = (condition, detail) => ({ ok: Boolean(condition), detail });
const CURSEUR = 'catwalks';

async function http(url, { headers = {}, method = 'GET', body } = {}) {
  const reponse = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  const texte = await reponse.text();
  return { status: reponse.status, headers: Object.fromEntries(reponse.headers), texte, json: (() => { try { return JSON.parse(texte); } catch { return null; } })() };
}
/** `fetch` refuse l'en-tête Host : pour les hôtes pays (`fr.catwalks.localhost`), requête brute vers 127.0.0.1 avec l'en-tête voulu. */
function httpHote(port, hote, chemin) {
  return new Promise((resolve, reject) => {
    const req = nodeHttp.request({ host: '127.0.0.1', port, path: chemin, method: 'GET', headers: { host: hote, accept: 'text/html' } }, (res) => {
      let texte = '';
      res.setEncoding('utf8'); res.on('data', (d) => { texte += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texte }));
    });
    req.setTimeout(60_000, () => req.destroy(new Error('délai dépassé')));
    req.once('error', reject); req.end();
  });
}
const postJson = (url, corps, headers = {}) => http(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corps) });

/** Lance `direct-sync` avec l'environnement de la stack et rend les statistiques de `command.result` (sous `data`). */
export async function directSync(config, args = []) {
  const { output } = await run('npx', ['--no-install', 'tsx', 'apps/aggregator/src/cli.ts', 'direct-sync', ...args], { cwd: ROOT, env: envCli(config), capture: true, allowFailure: true });
  const ligne = output.split('\n').reverse().find((l) => l.includes('"event":"command.result"'));
  const stats = ligne ? JSON.parse(ligne).data ?? null : null;
  return { stats, output };
}

/**
 * Une interruption RÉELLE et située. Le flux sert l'état COURANT de chaque
 * offre pour chaque ligne d'outbox, et l'agrégateur journalise chaque
 * événement consommé (`DirectOfferEvent`) avec le curseur dans une même
 * transaction. Le témoin fabrique donc 2n événements neufs (n offres
 * retirées puis remises en ligne), les consomme UN PAR PAGE, et tue le
 * processus quand une partie seulement est journalisée ; la reprise normale
 * doit consommer le reste sans doublon ni changement d'état. Si le rejeu
 * finit avant qu'une consommation partielle soit observée, le constat le dit.
 */
async function interruptionSurEvenementsNeufs(config, catalogue, backend, n = 40) {
  const cibles = (await backend.job.findMany({ where: { reference: { startsWith: 'STACK-TEST-' }, status: 'ONLINE' }, orderBy: { reference: 'asc' }, skip: 10, take: n, select: { id: true } })).map((j) => j.id);
  await backend.job.updateMany({ where: { id: { in: cibles } }, data: { status: 'OFFLINE', isActive: false } });
  await backend.job.updateMany({ where: { id: { in: cibles } }, data: { status: 'ONLINE', isActive: true } });
  const initial = (await catalogue.directFeedCursor.findUnique({ where: { id: CURSEUR } }))?.lastSeq ?? null;
  return new Promise((resolve) => {
    // Détaché : tuer le GROUPE, sinon seule l'enveloppe npx meurt et le vrai processus continue en orphelin.
    const child = spawn('npx', ['--no-install', 'tsx', 'apps/aggregator/src/cli.ts', 'direct-sync', '--limite=1'], { cwd: ROOT, env: envCli(config), stdio: 'ignore', detached: true });
    let tue = false, fini = false, retiresAuMoment = null, curseurAuMoment = null, enCours = false;
    const depart = Date.now(), echantillons = [];
    const sonde = setInterval(async () => {
      if (fini || tue || enCours) return;
      enCours = true;
      const consommes = Number(await catalogue.directOfferEvent.count({ where: { seq: { gt: initial ?? BigInt(0) } } }));
      if (echantillons.length < 400 && (echantillons.length === 0 || echantillons.at(-1).consommes !== consommes)) echantillons.push({ ms: Date.now() - depart, consommes });
      if (consommes >= 5 && consommes <= 2 * n - 5 && !tue && !fini) {
        tue = true; retiresAuMoment = consommes;
        curseurAuMoment = (await catalogue.directFeedCursor.findUnique({ where: { id: CURSEUR } }))?.lastSeq?.toString() ?? null;
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
      enCours = false;
    }, 5);
    child.once('exit', (code, signal) => { fini = true; clearInterval(sonde); resolve({ evenementsNeufs: 2 * cibles.length, pages: 1, curseurInitial: initial?.toString() ?? null, tueEnCours: tue, consommesAuMoment: retiresAuMoment, curseurAuMoment, signal, code, dureeMs: Date.now() - depart, echantillons: echantillons.slice(0, 8) }); });
  });
}

async function cataloguePrisma(config) {
  process.env.DATABASE_URL = catalogueDbUrl(config);
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: catalogueDbUrl(config) } } });
}
async function backendPrisma(config) {
  const { PrismaClient } = await import(pathToFileURL(path.join(config.dirs.backend, 'node_modules/@prisma/client/index.js')).href);
  return new PrismaClient({ datasources: { db: { url: backendDbUrl(config) } } });
}
const codesMarche = (html) => [...new Set([...html.matchAll(/marche=([A-Z]{2})/g)].map((m) => m[1]))].sort();

export async function verify(config, { mode = 'dev', navigateur = true } = {}) {
  const u = urls(config), cle = config.secrets.catalogueApiKey, flux = config.secrets.fluxKey;
  const constats = [];
  const note = (nom, c) => { constats.push({ nom, ...c }); console.log(`${c.ok ? 'OK ' : 'KO '} ${nom} — ${typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}`); };
  const auth = { authorization: `Bearer ${cle}` };

  // 1. API catalogue : santé (contrat de migrations) et garde de clé, sans puis avec clé.
  const sante = await http(`${u.api}/api/health`);
  note('api.health', attendu(sante.status === 200, { status: sante.status, corps: sante.json ?? sante.texte.slice(0, 120) }));
  const sansCle = await http(`${u.api}/api/jobs?marche=FR`);
  note('api.cle.absente_refusee', attendu([401, 503].includes(sansCle.status), { status: sansCle.status, mode }));
  const avecCle = await http(`${u.api}/api/jobs?marche=FR`, { headers: auth });
  note('api.cle.presente_acceptee', attendu(avecCle.status === 200 && typeof avecCle.json?.total === 'number', { status: avecCle.status, total: avecCle.json?.total }));
  const marches = await http(`${u.api}/api/marches`, { headers: auth });
  note('api.marches', attendu(marches.status === 200, { status: marches.status, codes: (marches.json?.marches ?? marches.json ?? []).map?.((m) => m.code ?? m) }));

  // 2. Flux d'outbox du backend : fermé sans clé, ouvert avec.
  const fluxSans = await http(`${u.backend}/api/catalogue/flux?depuis=0&limite=1`);
  note('backend.flux.sans_cle_refuse', attendu(fluxSans.status === 401, { status: fluxSans.status }));
  const fluxAvec = await http(`${u.backend}/api/catalogue/flux?depuis=0&limite=1`, { headers: { authorization: `Bearer ${flux}` } });
  note('backend.flux.avec_cle', attendu(fluxAvec.status === 200 && Array.isArray(fluxAvec.json?.evenements) && fluxAvec.json.evenements.length === 1, { status: fluxAvec.status, evenements: fluxAvec.json?.evenements?.length }));

  // 3. Synchronisation des offres directes au-delà de 500 : pages de 200, curseur, comptes, rejeu, retrait, interruption.
  const catalogue = await cataloguePrisma(config), backend = await backendPrisma(config);
  let eligibles = 0, attendues = 0;
  try {
    attendues = await backend.job.count({ where: { reference: { startsWith: 'STACK-TEST-' }, status: 'ONLINE', isActive: true, deletedAt: null } });
    const premiere = await directSync(config, ['--limite=200', '--depuis=0']);
    const curseur = await catalogue.directFeedCursor.findUnique({ where: { id: CURSEUR } });
    eligibles = await catalogue.directOffer.count({ where: { eligible: true } });
    note('sync.rejeu_complet_plus_de_500', attendu(premiere.stats && !premiere.stats.refus && premiere.stats.pages >= Math.ceil(attendues / 200) && eligibles >= attendues && attendues > 500 && !curseur?.lastError,
      { attendues, eligibles, pages: premiere.stats?.pages, evenements: premiere.stats?.evenements, appliques: premiere.stats?.appliques, dejaVus: premiere.stats?.dejaVus, curseur: curseur?.lastSeq?.toString(), erreur: curseur?.lastError ?? null }));

    // Rejeu depuis 0 : idempotent, aucune résurrection, aucun doublon (identifiant unique) ; rien n'est réappliqué.
    const total = await catalogue.directOffer.count();
    const rejeu = await directSync(config, ['--limite=200', '--depuis=0']);
    note('sync.rejeu_idempotent', attendu(rejeu.stats && !rejeu.stats.refus && rejeu.stats.appliques === 0 && (await catalogue.directOffer.count()) === total && (await catalogue.directOffer.count({ where: { eligible: true } })) === eligibles,
      { total, eligibles, pages: rejeu.stats?.pages, appliques: rejeu.stats?.appliques, dejaVus: rejeu.stats?.dejaVus, stales: rejeu.stats?.stales }));

    // Retrait puis remise en ligne d'une offre : le flux sert RETIRE puis PUBLIE, la copie suit, la version monte.
    const cible = await backend.job.findFirst({ where: { reference: 'STACK-TEST-0001' } });
    let retrait = attendu(false, 'offre STACK-TEST-0001 absente');
    if (cible) {
      const avant = await catalogue.directOffer.findUnique({ where: { id: cible.id } });
      await backend.job.update({ where: { id: cible.id }, data: { status: 'OFFLINE', isActive: false } });
      const r1 = await directSync(config, ['--limite=200']);
      const retiree = await catalogue.directOffer.findUnique({ where: { id: cible.id } });
      await backend.job.update({ where: { id: cible.id }, data: { status: 'ONLINE', isActive: true } });
      const r2 = await directSync(config, ['--limite=200']);
      const revenue = await catalogue.directOffer.findUnique({ where: { id: cible.id } });
      retrait = attendu(retiree?.eligible === false && revenue?.eligible === true && r1.stats?.appliques === 1 && r2.stats?.appliques === 1 && BigInt(revenue.version) > BigInt(avant?.version ?? 0),
        { versionAvant: avant?.version?.toString(), apresRetrait: retiree?.eligible, apresRemise: revenue?.eligible, versionApres: revenue?.version?.toString(), appliques: [r1.stats?.appliques, r2.stats?.appliques] });
    }
    note('sync.retrait_et_remise', retrait);

    // Interruption brutale au premier mouvement du curseur, puis reprise : même état final.
    const crash = await interruptionSurEvenementsNeufs(config, catalogue, backend);
    const reprise = await directSync(config, ['--limite=200']);
    const finale = await catalogue.directOffer.count({ where: { eligible: true } }), totalFinal = await catalogue.directOffer.count();
    const curseurFinal = await catalogue.directFeedCursor.findUnique({ where: { id: CURSEUR } });
    const consommesApres = Number(await catalogue.directOfferEvent.count({ where: { seq: { gt: BigInt(crash.curseurInitial ?? 0) } } }));
    const attenduCurseur = BigInt(crash.curseurInitial ?? 0) + BigInt(crash.evenementsNeufs);
    note('sync.interruption_et_reprise', attendu(crash.tueEnCours && crash.signal === 'SIGKILL' && reprise.stats && !reprise.stats.refus && consommesApres === crash.evenementsNeufs && finale === eligibles && totalFinal === total && !curseurFinal?.lastError && BigInt(curseurFinal?.lastSeq ?? 0) === attenduCurseur,
      { ...crash, reprise: { pages: reprise.stats?.pages, evenements: reprise.stats?.evenements, appliques: reprise.stats?.appliques, stales: reprise.stats?.stales, dejaVus: reprise.stats?.dejaVus }, consommesApresReprise: consommesApres, curseurApresReprise: curseurFinal?.lastSeq?.toString(), curseurAttendu: attenduCurseur.toString(), eligibles: finale, total: totalFinal, erreur: curseurFinal?.lastError ?? null }));

    // 4. L'API sert les deux origines sous une recherche : offres Catwalks synchronisées, en tête.
    const fr = await http(`${u.api}/api/jobs?marche=FR`, { headers: auth }), de = await http(`${u.api}/api/jobs?marche=DE`, { headers: auth });
    const seedFr = await backend.job.count({ where: { reference: { startsWith: 'STACK-TEST-' }, countryCode: 'FR', status: 'ONLINE' } });
    note('api.union_catwalks_en_tete', attendu(fr.status === 200 && fr.json?.total >= seedFr && fr.json?.jobs?.[0]?.origine === 'CATWALKS' && de.json?.total > 0,
      { totalFR: fr.json?.total, seedFR: seedFr, premiereOrigine: fr.json?.jobs?.[0]?.origine, candidature: fr.json?.jobs?.[0]?.candidature?.type, totalDE: de.json?.total }));
  } finally {
    await catalogue.$disconnect(); await backend.$disconnect();
  }

  // 5. Site : la page emplois sur le marché français porte les offres directes synchronisées.
  const emplois = await http(`${u.website}/emplois?marche=FR`);
  const maisonVisible = emplois.texte.includes('Maison Test Stack');
  note('site.emplois_fr', attendu(emplois.status === 200 && maisonVisible, { status: emplois.status, maisonSynthetiqueVisible: maisonVisible, longueur: emplois.texte.length }));

  // 6. Hôtes pays : `<pays>.catwalks.localhost` est lu comme marché (la page ne lie plus que ce marché), sans DNS public ;
  //    l'hôte neutre propose plusieurs marchés. Le cookie CW_MARCHE ne se pose qu'au sélecteur (choix délibéré).
  const h1 = (html) => /<h1[^>]*>([^<]*)/.exec(html)?.[1]?.trim() ?? null;
  const neutre = await httpHote(config.ports.website, `localhost:${config.ports.website}`, '/emplois');
  note('site.hote_neutre_invite_au_choix', attendu(neutre.status === 200 && !/\d+ offres/.test(h1(neutre.texte) ?? '') && codesMarche(neutre.texte).length >= 5, { status: neutre.status, h1: h1(neutre.texte), marchesProposes: codesMarche(neutre.texte).length }));
  for (const marche of ['FR', 'DE', 'US']) {
    const hote = `${marche.toLowerCase()}.catwalks.localhost:${config.ports.website}`;
    const r = await httpHote(config.ports.website, hote, '/emplois');
    const total = (await http(`${u.api}/api/jobs?marche=${marche}`, { headers: auth })).json?.total;
    const titre = h1(r.texte), lang = /<html[^>]*\blang="([^"]+)"/.exec(r.texte)?.[1];
    // Le h1 compte les offres du marché résolu, dans la langue du marché (« 100 offres », « 50 openings »).
    const compteH1 = Number(/^(\d+)\s/.exec(titre ?? '')?.[1] ?? NaN);
    note(`site.hote_pays.${marche}`, attendu(r.status === 200 && typeof total === 'number' && compteH1 === total, { status: r.status, hote, h1: titre, totalApiMarche: total, lang, cacheControl: r.headers['cache-control'] ?? null }));
  }

  // 7. Compte candidat de test : la connexion rend un jeton ; la réinitialisation de mot de passe atterrit dans la boîte locale, pas chez Brevo.
  const login = await postJson(`${u.backend}/api/auth/login`, { email: config.seed.candidatEmail, password: config.secrets.candidatPassword });
  note('backend.login_candidat_test', attendu(login.status === 200 && typeof login.json?.token === 'string', { status: login.status, jeton: typeof login.json?.token }));
  // Un compte jetable par exécution : le backend limite les réinitialisations à 3 par compte et par heure (10 par adresse IP).
  const jetable = `jetable.${Date.now()}@catwalks.test`;
  const backendBis = await backendPrisma(config);
  try {
    await backendBis.user.create({ data: { email: jetable, password: '$2a$12$stacklocalsyntheticpasswordhashxxxxxxxxxxxxxxxxxxxxxxx' } });
    const avantInbox = (await http(`${u.inbox}/api/messages`)).json?.length ?? 0;
    const reset = await postJson(`${u.backend}/api/auth/reset-password`, { email: jetable });
    await new Promise((r) => setTimeout(r, 1500));
    const apresInbox = (await http(`${u.inbox}/api/messages`)).json ?? [];
    const dernier = apresInbox.at(-1);
    note('inbox.reset_mot_de_passe_capture', attendu(reset.status === 200 && apresInbox.length === avantInbox + 1 && dernier?.to?.[0]?.email === jetable,
      { statusReset: reset.status, messagesAvant: avantInbox, messagesApres: apresInbox.length, destinataire: dernier?.to?.[0]?.email, template: dernier?.templateId ?? null, note: 'limite backend : 10 demandes par adresse IP et par heure' }));
    await backendBis.passwordResetToken.deleteMany({ where: { user: { email: jetable } } }).catch(() => {});
    await backendBis.user.delete({ where: { email: jetable } });
  } finally { await backendBis.$disconnect(); }

  // 8. Preuve navigateur : captures réelles (Chromium de Playwright), hôte pays compris.
  if (navigateur) {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
      const captures = [];
      for (const [nom, url] of [['emplois-fr', `${u.website}/emplois?marche=FR`], ['emplois-hote-de', `http://de.catwalks.localhost:${config.ports.website}/emplois`], ['inbox', `${u.inbox}/`]]) {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });
        const fichier = path.join(STATE, 'proofs', `${horodatage}-${nom}.png`);
        await page.screenshot({ path: fichier, fullPage: false });
        captures.push({ nom, url, fichier: path.relative(ROOT, fichier), titre: await page.title() });
      }
      await browser.close();
      note('navigateur.captures', attendu(captures.length === 3, captures));
    } catch (error) {
      note('navigateur.captures', attendu(false, `Playwright indisponible : ${error.message}`));
    }
  }

  const rapport = { horodatage: new Date().toISOString(), mode, constats };
  const fichier = path.join(STATE, 'proofs', `verify-${rapport.horodatage.replace(/[:.]/g, '-')}.json`);
  writeFileSync(fichier, JSON.stringify(rapport, null, 2) + '\n', { mode: 0o600 });
  const ko = constats.filter((c) => !c.ok).length;
  console.log(`\n${constats.length - ko} / ${constats.length} vérifications vertes — rapport ${path.relative(ROOT, fichier)}`);
  return ko === 0;
}
