// GA resolution-code scheme — isomorphic, no deps.
//
// [Committee][number][adopted-amendment letters][.first-order][.second-order]
//   GL2      main motion (General Legislation #2)
//   GL2.1    first amendment proposed against GL2
//   GL2.1.1  amendment to that amendment (second order — RONR's limit)
//   GL2.2    second first-order amendment (e.g. after GL2.1 failed)
//   GL2a     GL2 after an amendment is ADOPTED (new main motion); next adoption → GL2b
//
// Committee codes: GL General Legislation · SP Strategic Plan · F Finance ·
// FL Floor Motion · M Moderator · NC Nominations Committee.

export const COMMITTEE_CODES = ['GL', 'SP', 'F', 'FL', 'M', 'NC'] as const

/** Depth of a code: 0 = main motion, 1 = first-order amendment, 2 = second-order. */
export function codeDepth(code: string | null | undefined): number {
  if (!code) return 0
  return code.split('.').length - 1
}

/** Next amendment code for a parent: parent's code + the lowest unused .N among
 *  the sibling codes already pointed at it. GL2 + [GL2.1, GL2.2] → GL2.3.
 *  Second-order works the same: GL2.1 + [] → GL2.1.1. Returns null when the
 *  parent has no code or is already at RONR's second-order limit. */
export function nextAmendmentCode(parentCode: string | null | undefined, siblingCodes: (string | null)[]): string | null {
  if (!parentCode || codeDepth(parentCode) >= 2) return null
  const prefix = `${parentCode}.`
  let max = 0
  for (const s of siblingCodes) {
    if (!s || !s.startsWith(prefix)) continue
    const n = parseInt(s.slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${max + 1}`
}

/** Code for a main motion after an amendment is adopted: append/advance the
 *  letter suffix on the final segment. GL2 → GL2a, GL2a → GL2b. Works at any
 *  depth (GL2.1 → GL2.1a covers an adopted second-order amendment). */
export function bumpAdoptedCode(code: string | null | undefined): string | null {
  if (!code) return null
  const m = code.match(/^(.*?)([a-z]*)$/)
  if (!m) return null
  const letters = m[2]
  if (!letters) return `${code}a`
  // a→b … z→aa (z rollover is theoretical; assemblies don't adopt 26 amendments)
  const last = letters[letters.length - 1]
  return last === 'z' ? `${m[1]}${letters}a` : `${m[1]}${letters.slice(0, -1)}${String.fromCharCode(last.charCodeAt(0) + 1)}`
}
