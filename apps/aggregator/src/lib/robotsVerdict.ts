/**
 * robots.txt verdict for `User-agent: *` on one request path — the dated access verdict `promoteSource` requires.
 * Longest matching rule wins (RFC 9309); Allow beats Disallow on a tie; a robots.txt without a `*` group allows.
 * Groups for named agents (Amazonbot, ClaudeBot…) do not apply: the aggregator identifies itself as a generic client.
 */
export function robotsVerdictFor(robots: string | null, path: string): 'ALLOWED' | 'DISALLOWED' | 'NO_ROBOTS' {
  if (robots === null) return 'NO_ROBOTS';
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; pattern: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; pattern: string }> } | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase(), value = m[2]!.trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase()); lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
    } else lastWasAgent = false;
  }
  const group = groups.find((g) => g.agents.includes('*'));
  if (!group) return 'ALLOWED';
  const matches = (pattern: string) => {
    const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$'));
    return re.test(path);
  };
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.rules) if (matches(r.pattern)) { const len = r.pattern.length; if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len }; }
  return !best || best.allow ? 'ALLOWED' : 'DISALLOWED';
}

