// ── Sanitizing markdown → HTML (G1 §7, the XSS contract) ────────────────────
// Strategy: ESCAPE FIRST, then transform. Raw HTML can never survive because
// every < > & " ' is entity-encoded before any markdown rule runs. Output
// element allowlist: p, br, strong, em, ul, ol, li, h2, h3, blockquote, a.
// Anchors: https/mailto/tel only, rel="noopener". Everything else (images,
// tables, code fences, raw html, footnotes) renders as plain text — stripped
// of meaning, never of content.

export function esc(s: unknown): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function attr(s: unknown): string { return esc(s); }

/** https/mailto/tel URLs only; everything else (javascript:, data:, relative tricks) → null */
export function safeHref(url: string): string | null {
  const u = String(url ?? '').trim();
  if (/^https:\/\/[^\s]+$/i.test(u)) return u;
  if (/^mailto:[^\s]+@[^\s]+$/i.test(u)) return u;
  if (/^tel:\+?[\d\-().\s]+$/i.test(u)) return u;
  return null;
}

// inline rules applied to an ALREADY-ESCAPED line
function inline(escaped: string): string {
  let s = escaped;
  // links: [text](url) — url validated, text already escaped
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    const href = safeHref(url);
    return href ? `<a href="${attr(href)}" rel="noopener">${text}</a>` : text;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

export function renderMarkdown(md: string): string {
  // strip control chars except \n (NUL lesson), normalize newlines
  let src = '';
  for (const ch of String(md ?? '')) { const c = ch.codePointAt(0)!; if (c === 10 || c >= 32) src += ch; }
  const lines = src.replaceAll('\r\n', '\n').split('\n');

  const out: string[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => { if (para.length) { out.push(`<p>${para.map((l) => inline(esc(l))).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.kind}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.kind}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote><p>${quote.map((l) => inline(esc(l))).join('<br>')}</p></blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (t === '') { flushAll(); continue; }

    const h = t.match(/^(#{2,3})\s+(.*)$/); // h2/h3 only (h1 is the template's)
    if (h) { flushAll(); out.push(`<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`); continue; }
    if (/^#\s/.test(t)) { flushAll(); out.push(`<h2>${inline(esc(t.replace(/^#\s+/, '')))}</h2>`); continue; } // demote h1→h2

    const ul = t.match(/^[-*]\s+(.*)$/);
    if (ul) { flushPara(); flushQuote(); if (!list || list.kind !== 'ul') { flushList(); list = { kind: 'ul', items: [] }; } list.items.push(inline(esc(ul[1]))); continue; }
    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    if (ol) { flushPara(); flushQuote(); if (!list || list.kind !== 'ol') { flushList(); list = { kind: 'ol', items: [] }; } list.items.push(inline(esc(ol[1]))); continue; }

    const q = t.match(/^>\s?(.*)$/);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }

    flushList(); flushQuote(); para.push(t);
  }
  flushAll();
  return out.join('\n');
}
