/** Derived evidence used only for search. Never replaces the stored description
 * or establishes a source identity, employer ownership, or publication right. */
export function searchEvidence(description: string | null | undefined) {
  const text = (description ?? '').replace(/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ');
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const duties: string[] = [], affiliations: string[] = [];
  let inDuties = false, statementsAllowed = true;
  const start = /^(?:(?:vos|tes|votre|your|key|main|core|essential|primary|principal)\s+)?(?:missions?|responsabilit[ée]s?|responsibilities|duties|tasks|r[oô]le|role|job summary|mission statement)\b|^(?:what you(?:'ll| will) do|about the role|the role|ce que vous ferez|descriptif du poste|description du poste|aufgaben|deine aufgaben|ihre aufgaben|le tue responsabilit[aà]|tus funciones|responsabilidades|工作职责|岗位职责)|^you will be\s*[:—-]?$/i;
  const stop = /^(?:profil|qualifications?|requirements?|skills|comp[ée]tences|your profile|what you(?:'ll| will) bring|what we offer|benefits|avantages|who we are|about us|[àa] propos|pr[ée]sentation|notre (?:histoire|maison|entreprise)|your life and career|salary|salaires?|how to attend|what to (?:bring|wear)|hiring process|how to apply|application process|notre processus|processus de recrutement|ce que .*?(?:offrir|apporterez)|dein profil|ihr profil|requisiti|requisitos|任职要求)/i;
  const roleStatement = /\b(?:nous recherchons|nous recrutons|vous serez|vous [êe]tes|en tant que|as (?:a|an|the)|we (?:are looking|are seeking|seek)|you (?:will be|are)|reporting to|rattach[ée]e? [àa])\b/i;
  // Bound relationship phrases, not the surrounding brand history or an
  // arbitrary sentence mentioning an employer. E.g. La Prairie for Nocibé.
  const affiliation = /\b(?:pour (?:nos?|les?|la|une?|des?) (?:points? de vente|boutiques?|corners?|comptoirs?|magasins?)|for our (?:stores?|boutiques?|counters?)|au sein (?:de (?:la|notre)|du|d['’]une?) (?:boutique|magasin)|(?:represent|representing|repr[ée]senter) (?:the brand|la marque))\s+[^.!?;\n]{1,100}/gi;
  for (const line of lines) {
    if (stop.test(line)) { inDuties = false; statementsAllowed = false; }
    else if (start.test(line)) { inDuties = true; statementsAllowed = true; }
    if (inDuties || (statementsAllowed && roleStatement.test(line))) duties.push(line);
    for (const match of line.matchAll(affiliation)) affiliations.push(match[0]);
  }
  return { duties: duties.join('\n'), affiliations: affiliations.join('\n') };
}
