/**
 * UNE PANNE DE TRANSPORT N'EST PAS UN DÉFAUT DE NOTRE CODE.
 *
 * `fetch` (undici) rejette toute panne réseau ou TLS par `TypeError('fetch failed', { cause })` : la
 * classe dit « TypeError », la cause dit ce qui s'est réellement passé. Mesuré au RUN du 24/09/2026
 * (D-453) : Rolex, `UND_ERR_CONNECT_TIMEOUT` sur robots.txt après 226 réponses 200 du même hôte ;
 * Ralph Lauren, `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (le serveur ne présente que son certificat feuille).
 * Classés INTERNAL sur la seule classe, ils envoyaient chercher un bug de code qui n'existait pas, et
 * la capture comme la note du SourceRun ne gardaient que « TypeError » / « fetch failed ».
 *
 * Le code de cause est lu, jamais le message : il est borné et stable. Trois refus explicites :
 *  · une cause qui est elle-même une erreur de programmation (TypeError, ReferenceError, RangeError,
 *    SyntaxError sans code de transport — un défaut dans notre `lookup` ou notre dispatcher) reste INTERNAL ;
 *  · une adresse refusée par notre garde SSRF (`BlockedUrlError`) n'est pas une panne de transport ;
 *  · les codes undici qui signalent un mauvais usage de l'API par nous restent INTERNAL.
 * Ce module ne rend jamais SOURCE : une panne de transport reste UNKNOWN, à instruire.
 */

/** Node/undici codes that a remote host, the network or the peer's TLS configuration can produce. */
const TRANSPORT_CODE = new RegExp('^(?:' + [
  'UND_ERR_[A-Z0-9_]+',
  'E(?:CONNRESET|CONNREFUSED|CONNABORTED|NOTFOUND|AI_AGAIN|AI_FAIL|AI_NODATA|AI_NONAME|TIMEDOUT|HOSTUNREACH|NETUNREACH|NETDOWN|HOSTDOWN|PIPE|PROTO|SOCKETTIMEDOUT)',
  'CERT_[A-Z0-9_]+',
  'UNABLE_TO_[A-Z0-9_]+',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_[A-Z0-9_]+',
].join('|') + ')$');

/** undici codes raised when WE misuse the client: a code defect, never a transport failure. */
const CLIENT_MISUSE = new Set(['UND_ERR_INVALID_ARG', 'UND_ERR_INVALID_RETURN_VALUE', 'UND_ERR_NOT_SUPPORTED', 'UND_ERR_DESTROYED']);

const CODE_SHAPE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PROGRAMMING_ERRORS = ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'];
/** Separator of a recorded capture failure: `<error name>__<cause code>`. No error name of this code base contains it. */
export const FAILURE_CAUSE_SEPARATOR = '__';
/** The grammar of a hop failure inside the sealed request envelope (`capture/requestData.ts`). */
const RECORDED_LABEL = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

type Coded = { code?: unknown; errors?: unknown; name?: unknown };
const record = (value: unknown): value is Coded => !!value && typeof value === 'object';

/** The bounded code of a cause, including the first coded member of an AggregateError. */
function causeCode(cause: unknown): string | undefined {
  if (!record(cause)) return undefined;
  if (typeof cause.code === 'string' && CODE_SHAPE.test(cause.code)) return cause.code;
  if (Array.isArray(cause.errors)) {
    for (const member of cause.errors) {
      const code = record(member) && typeof member.code === 'string' && CODE_SHAPE.test(member.code) ? member.code : undefined;
      if (code) return code;
    }
  }
  return undefined;
}

function fetchTransportCode(error: TypeError): string | null {
  const cause = (error as { cause?: unknown }).cause;
  const code = causeCode(cause);
  if (code && CLIENT_MISUSE.has(code)) return null;
  if (code && TRANSPORT_CODE.test(code)) return code;
  if (error.message !== 'fetch failed') return null;
  // `fetch failed` wraps whatever the dispatcher threw, including our own defects and refusals.
  if (record(cause) && typeof cause.name === 'string' && (cause.name === 'BlockedUrlError' || PROGRAMMING_ERRORS.includes(cause.name))) return null;
  return code ?? 'UNIDENTIFIED';
}

/**
 * The transport cause code of a failed request, or null when the error is not a transport failure.
 * Also reads a body read cut by the network (`IncompleteBodyError` wrapping undici's `TypeError('terminated')`).
 */
export function transportFailureCode(error: unknown): string | null {
  if (error instanceof TypeError) return fetchTransportCode(error);
  if (error instanceof Error && error.name === 'IncompleteBodyError' && error.cause instanceof TypeError) {
    const code = causeCode((error.cause as { cause?: unknown }).cause);
    return code && !CLIENT_MISUSE.has(code) && TRANSPORT_CODE.test(code) ? code : null;
  }
  return null;
}

/** The blocking issue of a transport failure: UNKNOWN, named by its cause. Never SOURCE without a native receipt. */
export function transportIssueCode(error: unknown): string | null {
  const code = transportFailureCode(error);
  return code ? `TRANSPORT_${code}` : null;
}

/**
 * The failure recorded on a capture row. The live error NAME always comes first, because an offline
 * replay rethrows a recorded failure under that name (`RecordedTransportError`) and adapters may keep
 * it in their output: the name must replay unchanged. The transport cause follows the separator.
 */
export function captureFailureLabel(error: unknown, fallback: string): string {
  // Unchanged for every non-transport failure: exactly the name recorded before D-453.
  if (!(error instanceof Error)) return fallback;
  const code = transportFailureCode(error);
  if (!code) return error.name;
  const label = `${error.name}${FAILURE_CAUSE_SEPARATOR}${code}`;
  // The sealed request envelope bounds a hop failure; a label it would refuse keeps the bare name.
  return RECORDED_LABEL.test(label) && !error.name.includes(FAILURE_CAUSE_SEPARATOR) ? label : error.name;
}

/** Splits a recorded label back into the live error name and its optional transport cause. */
export function parseCaptureFailure(label: string): { name: string; transportCode?: string } {
  const index = label.indexOf(FAILURE_CAUSE_SEPARATOR);
  if (index <= 0) return { name: label };
  const code = label.slice(index + FAILURE_CAUSE_SEPARATOR.length);
  return CODE_SHAPE.test(code) ? { name: label.slice(0, index), transportCode: code } : { name: label };
}
