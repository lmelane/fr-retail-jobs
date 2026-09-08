import { describe, expect, it } from 'vitest';
import { detectChallenge, type ChallengeVendor } from './responseIntegrity.js';

/** Une réponse minimale : statut, en-têtes, et le corps déjà lu. */
function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('detectChallenge — signatures par fournisseur', () => {
  it('reconnaît le WAF Amazon au 202 + en-tête dédié', () => {
    expect(detectChallenge(res(202, { 'x-amzn-waf-action': 'challenge' }), '')).toBe('aws');
  });

  it("ne prend pas un 202 ordinaire pour un challenge Amazon", () => {
    expect(detectChallenge(res(202), 'contenu normal')).toBeUndefined();
  });

  /**
   * LE CAS L'ORÉAL (2026-09-08). Cloudflare répond **200**, pas 202 : la page
   * passait donc `response.ok` et était rendue au parseur, qui n'y trouvait
   * aucune carte — 0 offre, 0 erreur, et la source déclarée BROKEN à tort.
   */
  it('reconnaît un challenge Cloudflare servi en 200', () => {
    const body =
      "<html><head><title>Just a moment...</title></head><body>" +
      "<script src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'></script></body></html>";
    expect(detectChallenge(res(200), body)).toBe('cloudflare');
  });

  it('reconnaît Cloudflare au seul chemin challenge-platform', () => {
    const body = "<html><body><script src='/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1'></script></body></html>";
    expect(detectChallenge(res(200), body)).toBe('cloudflare');
  });

  it('reconnaît un 503 Cloudflare « Checking your browser »', () => {
    const body = '<html><body><h1>Checking your browser before accessing</h1></body></html>';
    expect(detectChallenge(res(503), body)).toBe('cloudflare');
  });

  it('reconnaît Akamai', () => {
    const body = '<html><body>Reference #18.2ae2c17.1757308800 Access Denied</body></html>';
    expect(detectChallenge(res(403), body)).toBe('akamai');
  });

  it('reconnaît Imperva / Incapsula', () => {
    const body = '<html><body><iframe src="/_Incapsula_Resource?SWCGHOEL=v2"></iframe></body></html>';
    expect(detectChallenge(res(200), body)).toBe('imperva');
  });

  it('reconnaît DataDome', () => {
    const body = '<html><body><script src="https://js.datadome.co/tags.js"></script>captcha-delivery</body></html>';
    expect(detectChallenge(res(403), body)).toBe('datadome');
  });

  it('reconnaît PerimeterX / HUMAN', () => {
    const body = '<html><body><div id="px-captcha">Please verify you are a human</div></body></html>';
    expect(detectChallenge(res(403), body)).toBe('perimeterx');
  });

  /**
   * Le garde-fou le plus important du détecteur : une VRAIE page d'offres ne
   * doit jamais être prise pour un challenge, sinon on casse 440 sources d'un
   * coup pour réparer une seule.
   */
  it('laisse passer une vraie page de listing', () => {
    const body =
      '<html><head><title>Careers — Search Jobs</title></head><body>' +
      '<a href="/en_US/jobs/JobDetail/Data-Analyst/253399">Data Analyst</a>' +
      '<a href="/en_US/jobs/JobDetail/Brand-Manager/253400">Brand Manager</a></body></html>';
    expect(detectChallenge(res(200), body)).toBeUndefined();
  });

  it('laisse passer une réponse JSON normale', () => {
    expect(detectChallenge(res(200, { 'content-type': 'application/json' }), '{"jobs":[{"id":1}]}')).toBeUndefined();
  });

  /**
   * Une page qui PARLE d'un fournisseur anti-bot sans en être une — une offre
   * d'emploi « Security Engineer, Cloudflare » — n'est pas un challenge. Le
   * marqueur doit être un artefact d'infrastructure, jamais le simple nom.
   */
  it("ne prend pas une offre qui mentionne Cloudflare pour un challenge", () => {
    const body =
      '<html><body><h1>Security Engineer</h1><p>Experience with Cloudflare and Akamai required. ' +
      'You will help protect our sites against bots.</p></body></html>';
    expect(detectChallenge(res(200), body)).toBeUndefined();
  });

  it('ignore le corps quand la réponse est vide', () => {
    expect(detectChallenge(res(200), '')).toBeUndefined();
  });

  it('un challenge reste détecté quelle que soit la casse', () => {
    const body = '<HTML><HEAD><TITLE>JUST A MOMENT...</TITLE></HEAD><BODY>/CDN-CGI/CHALLENGE-PLATFORM/</BODY></HTML>';
    expect(detectChallenge(res(200), body)).toBe('cloudflare');
  });
});

describe('ChallengeVendor — le type reste ouvert aux futurs fournisseurs', () => {
  it('accepte une valeur connue', () => {
    const vendor: ChallengeVendor = 'cloudflare';
    expect(vendor).toBe('cloudflare');
  });
});
