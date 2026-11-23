// ── Builder item 358: the host refused a publish because its account is out of credits ──
// The host bills every deploy in credits. With none left (and auto recharge off) it refuses new
// deploys, so every Publish stops. Its answer is "payment required" (402), or words about
// credits or a usage limit. A publish that fails this way says so in plain words: to the studio
// with what to do, to a client without the studio's billing. Read from the deploy's own error as
// lib/netlify.ts words it, and as the publish row keeps it ("deploy: deploy create failed: 402 …").
// Pure: no reads, no environment.

const CREDIT_WORDS = /\bcredits?\b|usage limit|limit (?:reached|exceeded)|(?:exceeded|over) (?:its|your|the) (?:plan|usage|credit|limit)|payment required/i;

/** Did the host refuse this deploy because the account has no credits left? Only the host's own
 *  answer is read, never a file's name (a page called "credits" is not a refusal). */
export function hostOutOfCredits(error: string | null | undefined): boolean {
  const e = String(error || '');
  let m = /deploy create failed: (\d{3})\b([\s\S]*)$/.exec(e);
  if (m) return m[1] === '402' || CREDIT_WORDS.test(m[2]);
  m = /upload failed for [\s\S]*: (\d{3}) \(after retry\)$/.exec(e);
  if (m) return m[1] === '402';
  m = /deploy state=error: ([\s\S]*)$/.exec(e);
  if (m) return CREDIT_WORDS.test(m[1]);
  return false;
}

/** What Publish says to the studio (and the platform): what happened and what to do. */
export const OUT_OF_CREDITS_STUDIO = 'Publishing is paused: the hosting account has run out of credits. Add credits at the host, or turn on auto recharge there, then publish again.';
/** What Publish says to a client: no studio billing, and their work is safe. */
export const OUT_OF_CREDITS_CLIENT = 'Publishing is paused on your studio’s side for now. They can see it, and your changes are safe in your draft.';
/** Home's Needs you row for a site whose last publish was refused this way. */
export const OUT_OF_CREDITS_ROW = { what: 'couldn’t publish: the hosting account is out of credits', when: 'Add credits at the host, or turn on auto recharge, then publish again' };
