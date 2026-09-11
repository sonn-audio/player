/**
 * Is this server new enough for this build?
 *
 * The only version comparison the player makes, and it is about the bundle as a whole rather than
 * about any feature — for features, `ServerContext` asks the server what it can do instead, which is
 * a better question than a number can answer.
 *
 * Open on both unknowns, matching the server's own rule exactly. A build that states no minimum made
 * no claim, and a core whose version cannot be ordered — `dev`, a working copy — is never accused of
 * being too old. Disagreeing with the server here would put a notice on screen that the server, and
 * the console, both consider false.
 */

function parse(input: string): { parts: number[]; prerelease: string | null } | null {
  const trimmed = input.trim().replace(/^v/i, '');
  if (!trimmed) return null;
  // Build metadata distinguishes two builds of one version (`4.0.0-beta.21+testing-20260911`),
  // so it takes no part in the ordering.
  const [withoutBuild] = trimmed.split('+', 1);
  const [core, pre] = (withoutBuild ?? '').split('-', 2);
  const parts = (core ?? '').split('.').map((p) => Number.parseInt(p.replace(/\D+.*$/, ''), 10));
  if (parts.length === 0 || parts.some((p) => Number.isNaN(p))) return null;
  while (parts.length < 3) parts.push(0);
  return { parts, prerelease: pre ? pre.trim() : null };
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  // A finished release outranks its own prerelease.
  if (!a) return 1;
  if (!b) return -1;
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    // Numerically, so beta.9 precedes beta.21 instead of sorting after it.
    if (lNum && rNum) return Number(l) - Number(r);
    if (lNum) return -1;
    if (rNum) return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

export function satisfiesMin(running: string | null | undefined, minimum: string | null | undefined): boolean {
  const min = (minimum ?? '').trim();
  const have = (running ?? '').trim();
  if (!min || !have) return true;
  const left = parse(have);
  const right = parse(min);
  if (!left || !right) return true;
  for (let i = 0; i < Math.max(left.parts.length, right.parts.length); i += 1) {
    const l = left.parts[i] ?? 0;
    const r = right.parts[i] ?? 0;
    if (l !== r) return l > r;
  }
  return comparePrerelease(left.prerelease, right.prerelease) >= 0;
}
