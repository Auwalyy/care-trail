/**
 * Referral codes look like "CT-XXXX-XXXY": seven Crockford base32 characters (no I, L, O, U)
 * followed by a Crockford mod-37 check symbol. Facility staff typing a code from a paper receipt
 * get immediate feedback on most typos (single substitutions, adjacent transpositions) before any
 * lookup is made.
 *
 * The random body is generated only on the server; this module holds the shared normalisation
 * and check logic used by API, web and mobile.
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Crockford check alphabet: 32 base symbols plus * ~ $ = U (37 total). */
const CHECK_ALPHABET = CROCKFORD_ALPHABET + '*~$=U';

const BODY_RE = /^[0-9A-HJKMNP-TV-Z]{7}$/;

export const REFERRAL_CODE_PATTERN = /^CT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{3}[0-9A-HJKMNP-TV-Z*~$=U]$/;

export function computeCheckSymbol(body: string): string {
  let value = 0;
  for (const ch of body) {
    const idx = CROCKFORD_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid referral code character: ${ch}`);
    value = (value * 32 + idx) % 37;
  }
  return CHECK_ALPHABET.charAt(value);
}

/** Build a full code from 7 Crockford characters. */
export function buildReferralCode(body7: string): string {
  if (!BODY_RE.test(body7)) throw new Error('Referral code body must be 7 Crockford characters');
  const full = body7 + computeCheckSymbol(body7);
  return `CT-${full.slice(0, 4)}-${full.slice(4)}`;
}

/**
 * Normalise user input: upper-case, strip spaces and dashes, drop the CT prefix, and map common
 * misreadings in the body (O→0, I/L→1). Returns null if the input cannot be a referral code.
 */
export function normaliseReferralCode(input: string): string | null {
  let raw = input.toUpperCase().replace(/[\s-]/g, '');
  if (raw.startsWith('CT')) raw = raw.slice(2);
  if (raw.length !== 8) return null;
  const body = raw.slice(0, 7).replace(/O/g, '0').replace(/[IL]/g, '1');
  const check = raw.charAt(7);
  const joined = body + check;
  const code = `CT-${joined.slice(0, 4)}-${joined.slice(4)}`;
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

export function isValidReferralCode(input: string): boolean {
  const code = normaliseReferralCode(input);
  if (!code) return false;
  const chars = code.slice(3).replace('-', '');
  return computeCheckSymbol(chars.slice(0, 7)) === chars.charAt(7);
}
