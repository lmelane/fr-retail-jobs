/**
 * Les environnements de chaque processus de la stack locale, construits depuis
 * la configuration privée. Principe : un environnement MINIMAL et explicite,
 * jamais l'environnement du shell (une URL de production exportée par
 * inadvertance n'atteint aucun processus), et chaque clé tierce connue des
 * trois dépôts est posée VIDE ou synthétique — une valeur posée dans
 * l'environnement prime sur `.env.local` sous Next (vérifié avec @next/env),
 * donc les vraies clés des fichiers du propriétaire ne sont jamais lues.
 */
import path from 'node:path';
import { MARCHES, ROOT, pgUrl } from './infra.mjs';

export const CATALOGUE_DB = 'catwalks_stack_catalogue';
/** « test » dans le nom : le garde des scripts et témoins du backend l'exige avant d'écrire. */
export const BACKEND_DB = 'catwalks_stack_backend_test';
export const MINIO_BUCKET = 'catwalks-stack-observations';

export const urls = (config) => {
  const p = config.ports;
  return {
    api: `http://127.0.0.1:${p.api}`,
    backend: `http://127.0.0.1:${p.backend}`,
    backendPublic: `http://localhost:${p.backend}`,
    website: `http://localhost:${p.website}`,
    inbox: `http://127.0.0.1:${p.inbox}`,
    minio: `http://127.0.0.1:${p.minio}`,
    minioConsole: `http://127.0.0.1:${p.minioConsole}`,
  };
};
export const catalogueDbUrl = (config) => pgUrl('catwalks', config.secrets.pgCatalogue, config.ports.catalogueDb, CATALOGUE_DB);
export const backendDbUrl = (config) => pgUrl('catwalks', config.secrets.pgBackend, config.ports.backendDb, BACKEND_DB);
export const websiteOrigins = (config) => [
  `http://localhost:${config.ports.website}`, `http://127.0.0.1:${config.ports.website}`,
  ...MARCHES.map((m) => `http://${m.toLowerCase()}.catwalks.localhost:${config.ports.website}`),
];

const BASE_KEYS = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'COLORTERM'];
function base() {
  const env = {};
  for (const k of BASE_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.NEXT_TELEMETRY_DISABLED = '1';
  env.CI = '1';
  return env;
}

/** Tiers neutralisés dans les trois dépôts : vide = service muet, jamais un appel réel. */
const NEUTRE = Object.fromEntries([
  'AHREFS_MCP_TOKEN', 'AHREFS_WA_PROJECT_ID', 'BREVO_LISTE_CANDIDATS_ID', 'BREVO_LISTE_MEDIA_ID',
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_STORAGE_BUCKET', 'PUBLIC_MEDIA_BUCKET',
  'GEMINI_API_KEY', 'GMAIL_DELEGATION_CLIENT_EMAIL', 'GMAIL_DELEGATION_PRIVATE_KEY', 'GOOGLE_MAPS_API_KEY', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
  'GSC_SERVICE_ACCOUNT_JSON', 'POSTHOG_HOST', 'POSTHOG_PERSONAL_API_KEY', 'POSTHOG_PROJECT_ID', 'NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST',
  'REVE_API_KEY', 'SENTRY_AUTH_TOKEN', 'SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN', 'SLACK_WEBHOOK_CANDIDATS', 'SLACK_WEBHOOK_CANDIDATURES',
  'TURNSTILE_SECRET_KEY', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'VERCEL_PREVIEW_PREFIXES', 'MEDIA_ZONE_URL', 'NEXT_PUBLIC_VERCEL_ENV',
  'HEALTHCHECK_PING_URL', 'GOOGLE_INDEXING_CREDENTIALS', 'ALERT_EMAIL', 'CATWALKS_RAILWAY_TOKEN', 'RAILWAY_TOKEN',
].map((k) => [k, '']));

const brevo = (config) => ({
  BREVO_API_KEY: config.secrets.brevoKey,
  BREVO_API_URL: `${urls(config).inbox}/v3`,
  BREVO_SENDER_EMAIL: 'stack@catwalks.test',
  BREVO_SENDER_NAME: 'Catwalks (stack locale)',
  INTERNAL_NOTIFICATION_RECIPIENT: 'interne@catwalks.test',
  SUPPORT_EMAIL: 'support@catwalks.test',
});

export function envCli(config) {
  return {
    // La clé Brevo est vidée pour le CLI : l'alerte de santé de l'agrégateur (`pipeline/alert.ts`) écrit sur l'URL
    // réelle de Brevo sans lire BREVO_API_URL, et partait vers le vrai service avec la clé synthétique (401 « Key
    // not found », mesuré le 17/09 pendant la campagne F3). Sans clé, l'alerte est un non-événement documenté ;
    // la route vers la boîte de réception locale est un changement du lecteur, à faire en F6.
    ...base(), ...NEUTRE, ...brevo(config), BREVO_API_KEY: '',
    NODE_ENV: 'development',
    DATABASE_URL: catalogueDbUrl(config), DIRECT_URL: catalogueDbUrl(config), PGOPTIONS: '',
    CATALOGUE_FLUX_URL: urls(config).backend, CATALOGUE_FLUX_KEY: config.secrets.fluxKey,
    OBSERVATION_ARCHIVE_S3_ENDPOINT: urls(config).minio, OBSERVATION_ARCHIVE_S3_REGION: 'local',
    OBSERVATION_ARCHIVE_S3_BUCKET: MINIO_BUCKET, OBSERVATION_ARCHIVE_S3_ACCESS_KEY_ID: config.secrets.minioUser,
    OBSERVATION_ARCHIVE_S3_SECRET_ACCESS_KEY: config.secrets.minioPassword, OBSERVATION_ARCHIVE_S3_PREFIX: 'stack-local',
    OBSERVATION_ARCHIVE_S3_FORCE_PATH_STYLE: 'true',
    SITE_URL: urls(config).website, NEXT_PUBLIC_SITE_URL: urls(config).website,
    EGRESS_PROBE: '0',
  };
}

export function envApi(config, mode) {
  return {
    ...base(), ...NEUTRE, ...brevo(config), BREVO_API_KEY: '',
    NODE_ENV: mode === 'build' ? 'production' : 'development',
    DATABASE_URL: catalogueDbUrl(config), DIRECT_URL: catalogueDbUrl(config), PGOPTIONS: '',
    CATALOGUE_API_KEY: config.secrets.catalogueApiKey,
    NEXT_PUBLIC_SITE_URL: urls(config).website,
    NEXT_DIST_DIR: '.next-stack', PORT: String(config.ports.api),
  };
}

export function envBackend(config, mode) {
  return {
    ...base(), ...NEUTRE, ...brevo(config),
    NODE_ENV: mode === 'build' ? 'production' : 'development',
    DATABASE_URL: backendDbUrl(config), DIRECT_URL: backendDbUrl(config), PGOPTIONS: '',
    NEXTAUTH_SECRET: config.secrets.nextauthSecret, NEXTAUTH_URL: urls(config).backendPublic, SENTRY_DISABLED: '1',
    API_PUBLIC_URL: urls(config).backendPublic, SITE_BASE_URL: urls(config).website, BO_PUBLIC_URL: '',
    CORS_ALLOWED_ORIGINS: websiteOrigins(config).join(','), CSP_FRAME_ANCESTORS: '',
    CATALOGUE_FLUX_KEY: config.secrets.fluxKey, CRON_SECRET: config.secrets.cronSecret, BREVO_WEBHOOK_SECRET: config.secrets.cronSecret,
    TURNSTILE_ENFORCE: '0', RELANCE_PROFIL_ACTIVE: '0', DIGEST_OFFRES_ACTIF: '0',
    NEXT_DIST_DIR: '.next-stack', PORT: String(config.ports.backend),
  };
}

export function envWebsite(config, mode) {
  return {
    ...base(), ...NEUTRE, ...brevo(config),
    NODE_ENV: mode === 'build' ? 'production' : 'development',
    API_URL: urls(config).backend, NEXT_PUBLIC_API_URL: urls(config).backendPublic,
    EMPLOIS_API_URL: urls(config).api, CATALOGUE_API_KEY: config.secrets.catalogueApiKey,
    EMPLOIS_INDEXABLE: '0', SENTRY_DISABLED: '1',
    NEXT_DIST_DIR: '.next-stack', PORT: String(config.ports.website),
  };
}

export const appDirs = (config) => ({
  api: path.join(ROOT, 'apps/api'),
  backend: config.dirs.backend,
  website: config.dirs.website,
});
