import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  S3ObjectStore, objectStoreFromEnv, objectStoreConfigured, archiveKey, STORAGE_ENV,
} from './objectStore.js';

/**
 * CE QUE CES TESTS PROTÈGENT, ET POURQUOI ILS COMPTENT PLUS QUE LA MOYENNE.
 *
 * Ce module est dans le chemin d'une PURGE : la chaîne de rétention ne supprime des lignes chaudes que si
 * l'archive distante a été écrite, relue et vérifiée. Un défaut ici ne produit donc pas un mauvais affichage,
 * il produit une suppression contre une copie qui n'existe pas.
 *
 * Trois propriétés sont donc verrouillées :
 *   · une configuration ABSENTE bloque — jamais de repli silencieux sur le disque local ;
 *   · le préfixe d'environnement est appliqué en un seul endroit, donc impossible à oublier ;
 *   · `list` pagine jusqu'au bout — s'arrêter tôt ferait lire « absente » une clé simplement plus loin,
 *     exactement le défaut corrigé en P9, mais avec une purge au bout.
 */
const CFG = {
  endpoint: 'https://s3.eu-west-3.amazonaws.com', region: 'eu-west-3', bucket: 'catwalks-observations',
  accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secretexample', prefix: 'production/observations',
};

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init: any) => Response) {
  const calls: { url: string; init: any }[] = [];
  vi.stubGlobal('fetch', async (url: any, init: any) => { calls.push({ url: String(url), init }); return handler(String(url), init); });
  return calls;
}

describe('stockage objet — configuration', () => {
  it('BLOQUE quand la configuration manque, et nomme les variables absentes', () => {
    // Un repli silencieux sur un disque local est le scénario à exclure : la purge croirait ses archives
    // distantes alors qu'elles vivraient dans un conteneur éphémère.
    expect(() => objectStoreFromEnv({})).toThrow(/stockage objet non configuré/);
    expect(() => objectStoreFromEnv({})).toThrow(new RegExp(STORAGE_ENV.bucket));
  });

  it('nomme précisément la SEULE variable manquante', () => {
    const env: any = {
      [STORAGE_ENV.endpoint]: CFG.endpoint, [STORAGE_ENV.region]: CFG.region,
      [STORAGE_ENV.accessKeyId]: 'x', [STORAGE_ENV.secretAccessKey]: 'y',
    };
    expect(() => objectStoreFromEnv(env)).toThrow(new RegExp(STORAGE_ENV.bucket));
    expect(objectStoreConfigured(env)).toBe(false);
  });

  it('se construit dès que les cinq variables obligatoires sont posées', () => {
    const env: any = {
      [STORAGE_ENV.endpoint]: CFG.endpoint, [STORAGE_ENV.region]: CFG.region,
      [STORAGE_ENV.bucket]: CFG.bucket, [STORAGE_ENV.accessKeyId]: 'x', [STORAGE_ENV.secretAccessKey]: 'y',
    };
    expect(objectStoreConfigured(env)).toBe(true);
    expect(objectStoreFromEnv(env).describe().bucket).toBe(CFG.bucket);
  });
});

describe('stockage objet — préfixe et clés', () => {
  it('applique le préfixe d\'environnement à TOUTES les clés', () => {
    // Un préfixe oublié ferait écrire une recette dans l'espace de production.
    const s = new S3ObjectStore(CFG);
    expect(s.uri('2026-09-14/run/src.jsonl.gz'))
      .toBe('s3://catwalks-observations/production/observations/2026-09-14/run/src.jsonl.gz');
  });

  it('la clé range par DATE en tête : la rétention devient un préfixe, pas un balayage', () => {
    expect(archiveKey('2026-09-14', 'run-1', 'hugo-boss-phenom', 'archive'))
      .toBe('2026-09-14/run-1/hugo-boss-phenom.jsonl.gz');
    expect(archiveKey('2026-09-14', 'run-1', 'hugo-boss-phenom', 'manifest'))
      .toBe('2026-09-14/run-1/hugo-boss-phenom.manifest.json');
  });
});

describe('stockage objet — requêtes signées', () => {
  it('signe sans JAMAIS exposer la clé secrète dans l\'en-tête', async () => {
    const calls = stubFetch(() => new Response('', { status: 200, headers: { etag: '"abc"' } }));
    await new S3ObjectStore(CFG).put('k.gz', new Uint8Array([1, 2, 3]));
    const auth = String(calls[0].init.headers.Authorization);
    expect(auth).toContain('AWS4-HMAC-SHA256');
    expect(auth).toContain(CFG.accessKeyId);       // l'identifiant est public par construction
    expect(auth).not.toContain(CFG.secretAccessKey); // le secret ne sort jamais
    expect(JSON.stringify(calls[0].init.headers)).not.toContain(CFG.secretAccessKey);
  });

  it('un PUT en échec LÈVE — un upload raté en silence autoriserait une purge', async () => {
    stubFetch(() => new Response('AccessDenied', { status: 403 }));
    await expect(new S3ObjectStore(CFG).put('k.gz', new Uint8Array([1])))
      .rejects.toThrow(/HTTP 403/);
  });

  it('head rend null sur 404 et lève sur une vraie erreur', async () => {
    stubFetch(() => new Response('', { status: 404 }));
    expect(await new S3ObjectStore(CFG).head('absent')).toBeNull();
    stubFetch(() => new Response('', { status: 500 }));
    await expect(new S3ObjectStore(CFG).head('k')).rejects.toThrow(/HTTP 500/);
  });

  it('get rend les octets tels quels', async () => {
    stubFetch(() => new Response(new Uint8Array([7, 8, 9])));
    expect([...(await new S3ObjectStore(CFG).get('k'))]).toEqual([7, 8, 9]);
  });
});

describe('stockage objet — list pagine jusqu\'au bout', () => {
  it('suit le jeton de continuation et rend TOUTES les clés', async () => {
    let n = 0;
    stubFetch(() => {
      n += 1;
      if (n === 1) {
        return new Response(
          '<Key>production/observations/a</Key><IsTruncated>true</IsTruncated>' +
          '<NextContinuationToken>t2</NextContinuationToken>');
      }
      return new Response('<Key>production/observations/b</Key><IsTruncated>false</IsTruncated>');
    });
    const keys = await new S3ObjectStore(CFG).list('2026-09-14/');
    expect(keys).toEqual(['production/observations/a', 'production/observations/b']);
    expect(n).toBe(2); // la seconde page a bien été demandée
  });

  it('une pagination sans fin LÈVE au lieu de rendre un ensemble partiel', async () => {
    stubFetch(() => new Response('<Key>k</Key><IsTruncated>true</IsTruncated><NextContinuationToken>t</NextContinuationToken>'));
    await expect(new S3ObjectStore(CFG).list('x/')).rejects.toThrow(/pagination non terminée/);
  });
});
