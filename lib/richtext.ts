// Tiny isomorphic rich-text allowlist for resolution wording — no deps, safe to
// import on both server and client. Resolutions are policy amendments, so the
// only formatting that matters is: deletion (<s>, struck) and insertion (<u>,
// underlined), plus bold/italic and line breaks. Everything else is stripped.
//
// This is the entire threat model boundary for resolution HTML: text is authored
// by the authenticated moderating team (not the public), but we still sanitize to
// a closed allowlist with NO attributes so pasted markup can't smuggle in script,
// event handlers, or links. Stored value is already clean; render is then safe.

const ALLOWED = ['s', 'u', 'b', 'i', 'br'] as const

// Private-use placeholders to protect allowed tags while we escape everything else.
const TOK: Record<string, string> = {
  '<s>': 'A', '</s>': 'B',
  '<u>': 'C', '</u>': 'D',
  '<b>': 'E', '</b>': 'F',
  '<i>': 'G', '</i>': 'H',
  '<br>': 'I',
}

/** Reduce arbitrary HTML to the resolution allowlist. Synonyms map to the
 *  canonical tag (del/strike→s, ins→u, strong→b, em→i); block tags become breaks;
 *  attributes are dropped; all other markup is escaped to inert text. */
export function sanitizeRich(html: string | null | undefined): string {
  if (!html) return ''
  let s = html
    // contentEditable pads empty lines with &nbsp;. Fold it (and any already
    // double-escaped &amp;nbsp; healed from older saves) to a plain space, so the
    // entity-escape step below can't turn it into a literal "&nbsp;".
    .replace(/&(?:amp;)?nbsp;/gi, ' ')
    .replace(/<(?:strike|del)\b[^>]*>/gi, '<s>').replace(/<\/(?:strike|del)>/gi, '</s>')
    .replace(/<ins\b[^>]*>/gi, '<u>').replace(/<\/ins>/gi, '</u>')
    .replace(/<strong\b[^>]*>/gi, '<b>').replace(/<\/strong>/gi, '</b>')
    .replace(/<em\b[^>]*>/gi, '<i>').replace(/<\/em>/gi, '</i>')
    .replace(/<\/(?:p|div)>/gi, '<br>').replace(/<(?:p|div)\b[^>]*>/gi, '<br>')
    .replace(/<br\s*\/?>/gi, '<br>')
  // Strip attributes and normalize case on the allowed tags.
  s = s.replace(/<(s|u|b|i)\b[^>]*>/gi, (_m, t: string) => `<${t.toLowerCase()}>`)
       .replace(/<\/(s|u|b|i)\s*>/gi, (_m, t: string) => `</${t.toLowerCase()}>`)
  // Protect the allowlist, escape all remaining markup, then restore.
  for (const [tag, tok] of Object.entries(TOK)) s = s.split(tag).join(tok)
  s = s.replace(/&(?!(?:amp|lt|gt|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
       .replace(/</g, '&lt;').replace(/>/g, '&gt;')
  for (const [tag, tok] of Object.entries(TOK)) s = s.split(tok).join(tag)
  // Collapse runs of breaks and trim them at the edges.
  return s.replace(/(?:<br>\s*){2,}/g, '<br>').replace(/^(?:\s*<br>)+/, '').replace(/(?:<br>\s*)+$/, '').trim()
}

/** Flatten resolution HTML to plain text — for the threshold classifier and any
 *  non-HTML surface. Keeps both struck and inserted words inline (the marked-up
 *  reading), which is what the Parliamentarian should judge. */
export function htmlToPlain(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** True if the value carries any allowlisted formatting (vs. plain text). */
export function hasRichFormatting(html: string | null | undefined): boolean {
  return !!html && ALLOWED.some(t => new RegExp(`<${t}\\b`, 'i').test(html))
}
