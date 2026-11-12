// ── Builder item 190: a developer's HTML block, read the way a browser reads it ─
// The old cleaner was a row of patterns run over the text, and a browser doesn't
// read HTML by pattern: `<img src="x"/onerror="…">` has no space before the handler
// and `<a href=javascript:…>` has no quotes, so both went straight through.
//
// This one walks the text with the browser's own rules for where a tag, a name and
// a value start and end (the HTML standard's tokenizer), then WRITES THE BLOCK OUT
// AGAIN from what it understood. Nothing of the developer's text is copied through
// as markup: every tag kept is on the list below, every attribute kept is on that
// tag's list, every address is checked after it is decoded, every value is written
// back inside double quotes with its marks escaped, and every `<` in running text
// becomes `&lt;`. So the browser can only read the result one way, the way it was
// checked. Deny by default: a tag or attribute nobody listed is not written.
// Pure, no imports.

/** The only elements permitted in a developer HTML block: presentational content
 *  tags. No scripting, embedding, form, or metadata elements. */
export const DEV_HTML_ALLOW: ReadonlySet<string> = new Set([
  'div', 'span', 'p', 'a', 'img', 'picture', 'source', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i',
  'u', 's', 'small', 'sub', 'sup', 'br', 'hr', 'blockquote', 'q', 'cite', 'pre',
  'code', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
  'address', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'col', 'colgroup', 'dl', 'dt', 'dd', 'time', 'mark', 'abbr',
]);

const VOID = new Set(['br', 'hr', 'img', 'source', 'col']);
// A browser reads what's inside these as plain text up to the closing tag, so no tag
// in there is real. They go, with what they hold.
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
// These go with everything inside them too, nested ones counted.
const DROP_WHOLE = new Set(['svg', 'math', 'object', 'template', 'form', 'select', 'applet', 'frameset', 'head', 'audio', 'video', 'canvas']);

// Attributes any kept tag may carry, then each tag's own. A value is kept when its
// check answers a string. No `style` (custom CSS is the styling channel), no `on…`,
// no `name` or `data-…` (a page script could be steered by them), no `srcdoc`.
type Check = (v: string) => string | null;
const words: Check = (v) => (v.length <= 2000 ? v : null);
const token = (re: RegExp): Check => (v) => (re.test(v) ? v : null);
const whole = token(/^\d{1,5}$/);
const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const FILE_SCHEMES = new Set(['http', 'https']);
/** An address as the browser will read it: tabs and line ends anywhere are dropped,
 *  as are spaces and control characters at either end. One that names a scheme must
 *  name a listed one; anything else is an address on the site itself. */
function address(v: string, schemes: Set<string>): string | null {
  const u = v.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
  if (u.length > 2000) return null;
  const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(u);
  if (m && !schemes.has(m[1].toLowerCase())) return null;
  return u;
}
const link: Check = (v) => address(v, LINK_SCHEMES);
const file: Check = (v) => address(v, FILE_SCHEMES);
const fileSet: Check = (v) => {
  if (v.length > 4000) return null;
  for (const part of v.split(',')) {
    const first = part.trim().split(/\s+/)[0];
    if (first && address(first, FILE_SCHEMES) === null) return null;
  }
  return v;
};
const GLOBAL: Record<string, Check> = {
  class: words, id: token(/^[A-Za-z][\w\-:.]{0,100}$/), title: words, lang: token(/^[A-Za-z0-9\-]{1,35}$/),
  dir: token(/^(ltr|rtl|auto)$/i), role: token(/^[a-z]{1,30}$/i),
};
const cell = { colspan: whole, rowspan: whole, scope: token(/^(row|col|rowgroup|colgroup)$/i), headers: words };
const OWN: Record<string, Record<string, Check>> = {
  a: { href: link, target: token(/^_(blank|self)$/i), rel: token(/^[a-z \-]{1,100}$/i) },
  img: { src: file, srcset: fileSet, sizes: words, alt: words, width: whole, height: whole, loading: token(/^(lazy|eager)$/i), decoding: token(/^(sync|async|auto)$/i) },
  source: { src: file, srcset: fileSet, sizes: words, media: words, type: token(/^[a-z0-9.+\-]+\/[a-z0-9.+\-]+$/i) },
  td: cell, th: cell,
  col: { span: whole }, colgroup: { span: whole },
  ol: { start: token(/^-?\d{1,6}$/), reversed: () => '', type: token(/^[1aAiI]$/) },
  li: { value: token(/^-?\d{1,6}$/) },
  time: { datetime: token(/^[0-9TZWPDHMS:.+\- ]{1,40}$/i) },
  blockquote: { cite: link }, q: { cite: link },
};
function checkFor(tag: string, name: string): Check | null {
  if (Object.hasOwn(OWN, tag) && Object.hasOwn(OWN[tag], name)) return OWN[tag][name];
  if (Object.hasOwn(GLOBAL, name)) return GLOBAL[name];
  if (/^aria-[a-z]{1,30}$/.test(name)) return words;
  return null;
}

// Character references, decoded as a browser decodes them inside an attribute, so
// `jav&#x61;script:` and `javascript&colon;` are judged as what they turn into.
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', Tab: '\t', NewLine: '\n',
  sol: '/', bsol: '\\', lpar: '(', rpar: ')', semi: ';', comma: ',', period: '.', excl: '!', quest: '?',
  num: '#', percnt: '%', equals: '=', plus: '+', hyphen: '-', dash: '‐', lowbar: '_', commat: '@',
  copy: '©', reg: '®', trade: '™', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  eacute: 'é', egrave: 'è', agrave: 'à', aacute: 'á', ntilde: 'ñ', uuml: 'ü',
  ouml: 'ö', auml: 'ä', ccedil: 'ç', deg: '°', frac12: '½', times: '×',
  euro: '€', pound: '£', cent: '¢',
};
// the few a browser accepts without the closing ";"
const NO_SEMI = new Set(['amp', 'lt', 'gt', 'quot', 'nbsp', 'copy', 'reg']);
function decode(v: string): string {
  return v.replace(/&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z][a-zA-Z0-9]*))(;?)(?=([=a-zA-Z0-9]?))/g, (m, hex, dec, name, semi, next) => {
    if (name) {
      if (!Object.hasOwn(NAMED, name)) return m;
      if (!semi && (!NO_SEMI.has(name) || next)) return m;
      return NAMED[name];
    }
    const code = hex ? parseInt(hex.slice(-8), 16) : parseInt(String(dec).slice(-10), 10);
    if (!(code > 0) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
    return String.fromCodePoint(code);
  });
}
const quote = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
interface Tag { name: string; attrs: Array<[string, string]>; end: number }
/** One tag, from the first letter of its name, by the standard's rules: a name ends at
 *  a space, "/" or ">"; an attribute name ends at a space, "/", ">" or "="; a value is
 *  in double quotes, in single quotes, or runs to the next space or ">". Null when the
 *  text ends inside the tag (a browser throws such a tag away). */
function readTag(s: string, at: number): Tag | null {
  const n = s.length;
  let j = at;
  while (j < n && !isSpace(s[j]) && s[j] !== '/' && s[j] !== '>') j++;
  const name = s.slice(at, j).toLowerCase();
  const attrs: Array<[string, string]> = [];
  for (;;) {
    while (j < n && (isSpace(s[j]) || s[j] === '/')) j++;
    if (j >= n) return null;
    if (s[j] === '>') return { name, attrs, end: j + 1 };
    let k = j;
    if (s[k] === '=') k++;   // a leading "=" is part of the name
    while (k < n && !isSpace(s[k]) && s[k] !== '/' && s[k] !== '>' && s[k] !== '=') k++;
    const an = s.slice(j, k).toLowerCase();
    j = k;
    while (j < n && isSpace(s[j])) j++;
    let av = '';
    if (s[j] === '=') {
      j++;
      while (j < n && isSpace(s[j])) j++;
      if (j >= n) return null;
      if (s[j] === '"' || s[j] === "'") {
        const e = s.indexOf(s[j], j + 1);
        if (e < 0) return null;
        av = s.slice(j + 1, e); j = e + 1;
      } else {
        k = j;
        while (k < n && !isSpace(s[k]) && s[k] !== '>') k++;
        av = s.slice(j, k); j = k;
      }
    }
    if (!attrs.some(([a]) => a === an)) attrs.push([an, av]);   // the first of a repeated name wins, as in a browser
  }
}

// An opening tag that ends the one before it, as a browser does without being told.
const ENDS_P = new Set(['address', 'article', 'aside', 'blockquote', 'div', 'dl', 'figcaption', 'figure', 'footer', 'header',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const ROW_GROUP = new Set(['thead', 'tbody', 'tfoot']);

/** A developer's HTML block, made safe. What comes back holds only listed tags and
 *  attributes, closed in order, so it also can't spill out of the slot it is drawn in. */
export function cleanDevHtml(html: string): string {
  const s = String(html || '').replace(/\u0000/g, '');
  const n = s.length;
  let i = 0, out = '';
  const open: string[] = [];
  let dropName = '', dropDepth = 0;
  const top = () => open[open.length - 1];
  const close = () => { out += `</${open.pop()}>`; };
  const text = (t: string) => { if (t && !dropDepth) out += t.replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const skipTo = (mark: string, from: number) => { const e = s.indexOf(mark, from); return e < 0 ? n : e + mark.length; };

  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { text(s.slice(i)); break; }
    text(s.slice(i, lt));
    i = lt;
    const c = s[i + 1] || '';
    if (c === '!' || c === '?') {
      if (s.startsWith('<!--', i)) {
        if (s.startsWith('<!-->', i)) { i += 5; continue; }
        if (s.startsWith('<!--->', i)) { i += 6; continue; }
        const a = s.indexOf('-->', i + 4), b = s.indexOf('--!>', i + 4);
        i = a < 0 && b < 0 ? n : (b < 0 || (a >= 0 && a < b)) ? a + 3 : b + 4;
      } else i = skipTo('>', i + 2);
      continue;
    }
    const closing = c === '/';
    const first = closing ? (s[i + 2] || '') : c;
    if (!/[a-zA-Z]/.test(first)) {
      if (!closing) { text('<'); i += 1; }            // a lone "<" is text
      else if (first === '>') i += 3;                  // "</>" is nothing
      else i = skipTo('>', i + 2);                     // "</ …>" is a comment to the browser
      continue;
    }
    const tag = readTag(s, closing ? i + 2 : i + 1);
    if (!tag) break;                                   // the text ended inside a tag
    i = tag.end;
    const name = tag.name;

    if (closing) {
      if (dropDepth) { if (name === dropName && --dropDepth === 0) dropName = ''; continue; }
      if (!DEV_HTML_ALLOW.has(name) || VOID.has(name)) continue;
      const idx = open.lastIndexOf(name);
      if (idx < 0) continue;                           // closes nothing of ours: it can't close the slot
      while (open.length > idx) close();
      continue;
    }

    if (name === 'plaintext') break;                   // everything after it is text the browser never leaves
    if (RAW_TEXT.has(name)) {
      const re = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'ig');
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) break;
      const endTag = readTag(s, m.index + 2);
      if (!endTag) break;
      i = endTag.end;
      continue;
    }
    if (dropDepth) { if (name === dropName) dropDepth++; continue; }
    if (DROP_WHOLE.has(name)) { dropName = name; dropDepth = 1; continue; }
    if (!DEV_HTML_ALLOW.has(name)) continue;           // the wrapper goes, its words stay

    if (ENDS_P.has(name) && top() === 'p') close();
    if (name === 'li' && top() === 'li') close();
    if ((name === 'dt' || name === 'dd') && (top() === 'dt' || top() === 'dd')) close();
    if (name === 'td' || name === 'th' || name === 'tr' || ROW_GROUP.has(name)) {
      if (top() === 'td' || top() === 'th') close();
      if (name !== 'td' && name !== 'th' && top() === 'tr') close();
      if (ROW_GROUP.has(name) && ROW_GROUP.has(top())) close();
    }

    const kept: Array<[string, string]> = [];
    for (const [an, raw] of tag.attrs) {
      const check = checkFor(name, an);
      if (!check) continue;
      const v = check(decode(raw));
      if (v !== null) kept.push([an, v]);
    }
    // a link that opens a new tab never hands that tab a way back to this page
    if (name === 'a' && kept.some(([a, v]) => a === 'target' && v.toLowerCase() === '_blank')) {
      const rel = kept.find(([a]) => a === 'rel');
      if (!rel) kept.push(['rel', 'noopener noreferrer']);
      else if (!/\bnoopener\b/i.test(rel[1])) rel[1] = `${rel[1]} noopener`.trim();
    }
    out += `<${name}${kept.map(([a, v]) => (v === '' && a === 'reversed' ? ` ${a}` : ` ${a}="${quote(v)}"`)).join('')}>`;
    if (!VOID.has(name)) open.push(name);
  }
  while (open.length) close();
  return out.trim();
}
