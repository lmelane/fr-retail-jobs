/**
 * OÙ LE REJEU DIVERGE — la première différence factuelle, capture vs replay.
 *
 * `compareExtractionResult` combine DEUX critères : la sortie (offre par offre) et les
 * métadonnées du résultat. Le rapport de validation ne dit que « REPLAY_RESULT_CHANGED », ce qui
 * les confond. On les sépare ici, et on nomme le premier écart.
 */
import { PrismaClient } from '@prisma/client';
import { readExtractionManifest, compareExtractionResult } from '../../../src/capture/manifest.js';
import { replayExtraction } from '../../../src/capture/batch.js';
import { fetchAtsJobs } from '../../../src/ats/index.js';
import { KIND_TO_ATS } from '../../../src/pipeline/ingest.js';
import { captureConfig } from '../../../src/capture/config.js';
import { effectiveSourceConfig } from '../../../src/connectors/sourceConfig.js';
import { digestBytes } from '../../../src/capture/context.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
for (const cle of process.argv.slice(2)) {
  const [b] = await p.$queryRawUnsafe<Array<any>>(`
    SELECT b.id, b."sourceKind", r.payload::text AS payload
      FROM "CaptureBatch" b JOIN "SourceRevision" r ON r.id = b."sourceRevisionId"
      JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
     WHERE b."sourceKey" = $1 AND b.purpose = 'JOBS' ORDER BY b."startedAt" DESC LIMIT 1`, cle);
  if (!b) { console.log(`\n${cle} : aucun lot EXTRACTED`); continue; }
  const rev = JSON.parse(b.payload);
  const config = captureConfig(effectiveSourceConfig(rev.config));
  const kind = KIND_TO_ATS[rev.kind];
  console.log(`\n── ${cle} (${rev.kind})`);
  try {
    const manifest = await readExtractionManifest(p, b.id);
    const replayed = await replayExtraction(p, b.id, () => fetchAtsJobs(kind as never, config));
    const c = await compareExtractionResult(p, b.id, replayed);
    console.log(`   sortie identique     : ${c.matchesRecordedOutput}`);
    console.log(`   métadonnées idem     : ${c.matchesRecordedMetadata}`);
    /* `exact` est le critère que la validation native applique réellement : c'est LUI qui décide
     * du verdict `REPLAY_RESULT_CHANGED`, pas les deux booléens qui le composent. */
    console.log(`   REJEU EXACT          : ${c.exact}`);
    console.log(`   offres : manifeste ${manifest.outputs.length} · rejeu ${replayed.jobs.length}`);
    if (!c.matchesRecordedMetadata) {
      const { jobs: _j, captureBatchId: _b, ...meta } = replayed as never as Record<string, unknown>;
      /* On compare CLÉ PAR CLÉ : un extrait tronqué cache la divergence au lieu de la montrer. */
      const a = meta as Record<string, unknown>, b = manifest.metadata as Record<string, unknown>;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const va = JSON.stringify(a[k]), vb = JSON.stringify(b[k]);
        if (va !== vb) {
          console.log(`   CLÉ EN ÉCART : ${k}`);
          /* Descendre d'un niveau : `enumeration` est un objet, et la divergence peut tenir à
           * un seul de ses champs — un extrait tronqué ne la montrerait jamais. */
          const oa = a[k], ob = b[k];
          if (oa && ob && typeof oa === 'object' && typeof ob === 'object' && !Array.isArray(oa)) {
            for (const s of new Set([...Object.keys(oa), ...Object.keys(ob as object)])) {
              const sa = JSON.stringify((oa as Record<string, unknown>)[s]);
              const sb = JSON.stringify((ob as Record<string, unknown>)[s]);
              if (sa === sb) continue;
              /* DERNIER NIVEAU. `pageEvidence` est un TABLEAU de preuves, chacune à plusieurs
               * champs (url, checkedAt, sha256, ids…). Un extrait tronqué laisse croire que
               * l'écart porte sur tout l'objet alors qu'il ne tient souvent qu'à UN champ — et
               * la distinction change le diagnostic : un `sha256` qui diverge est un contenu qui
               * a bougé à la source, un `checkedAt` seul est un défaut de notre rejeu. */
              const ta = (oa as Record<string, unknown>)[s], tb = (ob as Record<string, unknown>)[s];
              if (Array.isArray(ta) && Array.isArray(tb) && ta.length === tb.length) {
                console.log(`     ${k}.${s} : ${ta.length} preuve(s), champs en écart —`);
                for (const [i, pa] of ta.entries()) {
                  const pb = tb[i] as Record<string, unknown>;
                  for (const champ of new Set([...Object.keys(pa as object), ...Object.keys(pb)])) {
                    const ca = JSON.stringify((pa as Record<string, unknown>)[champ]);
                    const cb = JSON.stringify(pb[champ]);
                    if (ca !== cb) console.log(`       [${i}] ${champ} : rejeu=${ca} | manifeste=${cb}`);
                  }
                }
                continue;
              }
              console.log(`     ${k}.${s} : rejeu=${String(sa).slice(0,110)} | manifeste=${String(sb).slice(0,110)}`);
            }
          } else if (Array.isArray(oa) && Array.isArray(ob)) {
            /* UN TABLEAU : dire lequel des éléments diverge, pas afficher les deux débuts — qui
             * sont souvent identiques et ne montrent donc rien. L'ORDRE compte aussi : deux
             * ensembles égaux servis dans un ordre différent ne sont pas le même résultat. */
            console.log(`     longueurs : rejeu=${oa.length} · manifeste=${ob.length}`);
            const n = Math.min(oa.length, ob.length);
            let premier = -1;
            for (let i = 0; i < n; i++) if (JSON.stringify(oa[i]) !== JSON.stringify(ob[i])) { premier = i; break; }
            if (premier === -1) console.log(`     les ${n} premiers éléments sont identiques : l'écart est une LONGUEUR`);
            else {
              console.log(`     premier élément en écart : index ${premier}`);
              console.log(`       rejeu     : ${JSON.stringify(oa[premier]).slice(0, 180)}`);
              console.log(`       manifeste : ${JSON.stringify(ob[premier]).slice(0, 180)}`);
              /* Même CONTENU dans un autre ORDRE : le diagnostic est alors un tri instable,
               * pas une donnée qui a bougé. La distinction change complètement le correctif. */
              const memeEnsemble = JSON.stringify([...oa].map(x => JSON.stringify(x)).sort())
                === JSON.stringify([...ob].map(x => JSON.stringify(x)).sort());
              console.log(`       même ensemble, ordre différent : ${memeEnsemble}`);
            }
          } else {
            console.log(`     rejeu     : ${String(va).slice(0, 200)}`);
            console.log(`     manifeste : ${String(vb).slice(0, 200)}`);
          }
        }
      }
    }
    if (!c.matchesRecordedOutput && replayed.jobs.length === manifest.outputs.length) {
      /* Même nombre : la divergence est dans le CONTENU. On nomme la première offre en écart. */
      for (const [i, job] of replayed.jobs.entries()) {
        const { captureBatchId: _a, captureOutputId: _c, ...content } = job as never as Record<string, unknown>;
        const h = digestBytes(JSON.stringify(content));
        if (manifest.outputs[i].outputHash !== h) {
          console.log(`   première offre en écart : index ${i}, externalId ${manifest.outputs[i].externalId}`);
          /*
           * NOMMER LE CHAMP, pas seulement l'offre. Le manifeste ne garde qu'une EMPREINTE par
           * sortie (jamais le corps : il ne doit pas dupliquer les offres). On ne peut donc pas
           * comparer champ à champ avec le manifeste — mais on peut isoler le champ instable en
           * rejouant une SECONDE fois : ce qui diffère entre deux rejeux du MÊME archivé est
           * nécessairement non déterministe, et c'est exactement ce qu'on cherche.
           */
          const second = await replayExtraction(p, b.id, () => fetchAtsJobs(kind as never, config));
          const jobA = content as Record<string, unknown>;
          const { captureBatchId: _x, captureOutputId: _y, ...jobB } = (second as { jobs: unknown[] }).jobs[i] as Record<string, unknown>;
          const champs = new Set([...Object.keys(jobA), ...Object.keys(jobB)]);
          let instable = false;
          for (const champ of champs) {
            const a = JSON.stringify(jobA[champ]), bb = JSON.stringify((jobB as Record<string, unknown>)[champ]);
            if (a !== bb) {
              instable = true;
              console.log(`     CHAMP NON DÉTERMINISTE : ${champ}`);
              console.log(`       rejeu 1 : ${String(a).slice(0, 150)}`);
              console.log(`       rejeu 2 : ${String(bb).slice(0, 150)}`);
            }
          }
          if (!instable) console.log(`     deux rejeux IDENTIQUES entre eux : l'écart porte sur la capture d'origine, pas sur un champ instable`);
          break;
        }
      }
    }
  } catch (e) { console.log(`   ÉCHEC : ${String(e).slice(0, 160)}`); }
}
await p.$disconnect();
