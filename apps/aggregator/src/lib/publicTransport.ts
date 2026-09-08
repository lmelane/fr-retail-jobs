import { lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { BlockedUrlError, isPublicIp } from './ssrf.js';

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

let dispatcher = new Agent({ connect: { lookup: publicLookup(), timeout: 12_000 } });
export const publicDispatcher = () => dispatcher;

/** Preserve the optional external resolver without bypassing socket validation. */
export function usePublicResolver(resolve: LookupFunction): Agent {
  const previous = dispatcher;
  dispatcher = new Agent({ connect: { lookup: publicLookup(resolve), timeout: 12_000 } });
  void previous.close();
  return dispatcher;
}
