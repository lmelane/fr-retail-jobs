/**
 * Boîte de réception de test : un serveur HTTP qui imite l'API Brevo v3 (envoi
 * transactionnel, contacts) et ARCHIVE chaque email en JSON au lieu de
 * l'envoyer. Le backend et le site y sont dirigés par `BREVO_API_URL`.
 * Lecture : `GET /` (liste HTML), `GET /api/messages` (JSON),
 * `DELETE /api/messages` (vide la boîte).
 */
import { createServer } from 'node:http';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const port = Number(process.env.INBOX_PORT);
const dir = process.env.INBOX_DIR;
if (!port || !dir) throw new Error('INBOX_PORT et INBOX_DIR sont requis');
mkdirSync(dir, { recursive: true, mode: 0o700 });

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const messages = () => readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
const echapper = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? (() => { try { return JSON.parse(raw); } catch { return { brut: raw }; } })() : null;
  if (req.method === 'POST' && url.pathname === '/v3/smtp/email') {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
    const message = { id, recuLe: new Date().toISOString(), to: body?.to, templateId: body?.templateId, subject: body?.subject, params: body?.params, replyTo: body?.replyTo, headers: body?.headers, apiKey: req.headers['api-key'] ? 'présente' : 'absente' };
    writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(message, null, 2), { mode: 0o600 });
    return json(res, 201, { messageId: `<${id}@stack.local>` });
  }
  if (req.method === 'POST' && url.pathname === '/v3/contacts') return json(res, 201, { id: Date.now() });
  if (req.method === 'POST' && /^\/v3\/contacts\/lists\/\d+\/contacts\/remove$/.test(url.pathname)) return json(res, 200, { contacts: { success: body?.emails ?? [] } });
  if (url.pathname.startsWith('/v3/')) return json(res, 200, { stack: 'réponse neutre', chemin: url.pathname });
  if (req.method === 'GET' && url.pathname === '/api/messages') return json(res, 200, messages());
  if (req.method === 'DELETE' && url.pathname === '/api/messages') { for (const f of readdirSync(dir)) if (f.endsWith('.json')) unlinkSync(path.join(dir, f)); return json(res, 200, { vide: true }); }
  if (req.method === 'GET' && url.pathname === '/') {
    const lignes = messages().reverse().map((m) => `<tr><td>${echapper(m.recuLe)}</td><td>${echapper((m.to ?? []).map((t) => t.email).join(', '))}</td><td>${echapper(m.templateId ?? m.subject)}</td><td><code>${echapper(JSON.stringify(m.params ?? {}).slice(0, 300))}</code></td></tr>`).join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Boîte de réception — stack locale</title><style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.4rem .6rem;vertical-align:top}</style><h1>Boîte de réception (stack locale)</h1><p>${lignes ? '' : 'Aucun email capturé.'}</p><table><tr><th>Reçu</th><th>Destinataire</th><th>Template / sujet</th><th>Paramètres</th></tr>${lignes}</table>`);
  }
  json(res, 404, { erreur: 'inconnu' });
}).listen(port, '127.0.0.1', () => console.log(`inbox: http://127.0.0.1:${port}/ (${dir})`));
