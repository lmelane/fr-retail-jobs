import { lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { BlockedUrlError, isPublicIp } from './ssrf.js';
import { chainCompletingFactory } from './tlsChainCompletion.js';
import { log } from '../observability/logger.js';

/** Validate the exact DNS answer handed to the socket: no second lookup. */
export function publicLookup(resolve: LookupFunction = lookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, result, family) => {
      if (error) return callback(error, []);
      const addresses = typeof result === 'string' ? [{ address: result, family: family ?? 0 }] : result;
      if (!addresses.length || addresses.some(a => !isPublicIp(a.address))) {
        return callback(new BlockedUrlError(`DNS:${hostname}`), []);
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

const connect = { lookup: publicLookup(), timeout: 12_000 };
/**
 * D-453 §3 (30/09/2026) : un hôte nommé par la décision qui ne présente que sa feuille reçoit l'intermédiaire
 * que son certificat désigne, vérifié jusqu'à une racine de Node, puis la connexion est rejouée en
 * vérification complète (`tlsChainCompletion.ts`). Toute autre origine garde le Pool d'undici, inchangé.
 */
let dispatcher = new Agent({ connect, factory: chainCompletingFactory(connect, {
  onCompleted: event => log.info('tls.chain_completed', event),
  onRefused: event => log.warn('tls.chain_completion_refused', event),
}) });
export const publicDispatcher = () => dispatcher;
