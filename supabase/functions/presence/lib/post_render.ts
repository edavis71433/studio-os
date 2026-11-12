// ── The blog on the live site, one way for all eight templates (builder list item 40) ──
// The Updates page, a page per category (/updates/category/<id>/), and each post: its
// category, who wrote it and when, its cover, the photos inside its text, and a line
// about its author at the end. The templates had eight copies of the list and the post;
// they now call these, each passing its own photo drawing (img), date format and the
// frame its cover sits in, and the post styles (POST_CSS) read each template's own
// colours (--ink, --soft, --line, --accent-dark, --card, --radius). Pure.
import { attr, esc } from './markdown.ts';
import { normalizeTags, postTagsAttr, postTagsHtml, tagFilterBar, tagFilterScript } from './search_index.ts';
import { categoriesWithPosts, postSummary, renderPostBody, type PostCategory } from './blog.ts';
import type { MediaRef, SiteConfig, SnapshotContent } from './render_types.ts';

type Post = SnapshotContent['posts'][number];
export interface PostDraw {
  img: (m: MediaRef | null | undefined, sizes: string, lazy?: boolean, cls?: string) => string;
  date: (iso: string) => string;
  prE: (kind: string, id: string) => string;   // the builder canvas's mark on each post
  frame: string;                               // the template's own style for the cover's frame
}

/** A category's page on the live site. Pure. */
export const categoryPath = (cat: { id: string }): string => `/updates/category/${cat.id}/`;

const newestFirst = (posts: Post[]): Post[] => [...posts].sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** "By Sam Ortiz · Nov 18, 2026", or the date alone. Pure. */
export function postByline(p: Post, d: Pick<PostDraw, 'date'>): string {
  const date = `<time datetime="${attr(p.published_at)}">${esc(d.date(p.published_at))}</time>`;
  return p.author?.name ? `By ${esc(p.author.name)} · ${date}` : date;
}

/** The links over the list: All, then each category that has posts. '' with none. Pure. */
export function categoryNav(posts: Post[], current: PostCategory | null): string {
  const cats = categoriesWithPosts(posts);
  if (!cats.length) return '';
  const link = (href: string, label: string, on: boolean) => `<a href="${attr(href)}"${on ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  return `<nav class="post-cats" aria-label="Categories">${link('/updates/', 'All', !current)}${cats.map((c) => link(categoryPath(c), c.name, current?.id === c.id)).join('')}</nav>`;
}

/** The Updates page, or one category's page. Pure. */
export function postListBody(c: SnapshotContent, d: PostDraw, current: PostCategory | null = null): string {
  const all = newestFirst(c.posts);
  const posts = current ? all.filter((p) => p.category?.id === current.id) : all;
  const rows = posts.map((p) => {
    const tags = normalizeTags(p.tags);
    const sum = postSummary(p);
    const href = `/updates/${attr(p.slug)}/`;
    const thumb = p.hero ? `<a class="post-thumb" href="${href}" tabindex="-1" aria-hidden="true">${d.img(p.hero, '(max-width: 700px) 100vw, 240px')}</a>` : '';
    return `
<article${d.prE('post', p.id)}${postTagsAttr(tags, attr)} class="post-row${p.hero ? '' : ' no-thumb'}">${thumb}<div class="post-text">${p.category ? `<p class="post-kicker">${esc(p.category.name)}</p>` : ''}<h2><a href="${href}">${esc(p.title)}</a></h2>
<p class="post-meta">${postByline(p, d)}</p>
${sum ? `<p>${esc(sum)}</p>` : ''}${postTagsHtml(tags, esc)}</div></article>`;
  }).join('');
  return `<section class="block wrap"><h1>${esc(current ? current.name : 'Updates')}</h1>${categoryNav(c.posts, current)}${current ? '' : tagFilterBar(posts, esc, attr)}<div class="post-list">${rows}
${posts.length === 0 ? '<p>No updates yet — our news will land here.</p>' : ''}</div>${current ? '' : tagFilterScript(posts)}</section>`;
}

/** One post's page. Pure. */
export function postPageBody(_c: SnapshotContent, p: Post, d: PostDraw): string {
  const figure = (m: MediaRef, alt: string, caption: string) => `<figure class="post-fig">${d.img({ ...m, alt: alt || m.alt }, '(max-width: 900px) 100vw, 760px')}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
  const a = p.author;
  const author = a?.name ? `
<aside class="post-author" aria-label="About the author">${a.photo ? d.img(a.photo, '56px', true, 'post-author-photo') : `<span class="post-author-mark" aria-hidden="true">${esc(initials(a.name))}</span>`}<div><p class="post-author-name">Written by ${esc(a.name)}</p>${a.bio ? `<p class="post-author-bio">${esc(a.bio)}</p>` : ''}</div></aside>` : '';
  return `<section class="block wrap"><article class="post prose">
${p.category ? `<p class="post-kicker">${esc(p.category.name)}</p>` : ''}<h1>${esc(p.title)}</h1>
<p class="post-meta">${postByline(p, d)}</p>
${p.hero ? `<div class="post-cover" style="${d.frame}">${d.img(p.hero, '(max-width: 900px) 100vw, 860px', false)}</div>` : ''}
${renderPostBody(p.body_md, p.images, figure)}
${postTagsHtml(normalizeTags(p.tags), esc)}${author}</article>
<p class="post-more"><a href="/updates/">← All updates</a>${p.category ? `<a href="${attr(categoryPath(p.category))}">More in ${esc(p.category.name)}</a>` : ''}</p></section>`;
}

/** What Google reads about a post: who wrote it, when, its picture and its section. Pure. */
export function postLd(site: SiteConfig, businessName: string, p: Post): object {
  const url = `${site.baseUrl}/updates/${p.slug}/`;
  const image = p.hero?.variants?.w1600 || p.hero?.variants?.w800;
  const summary = postSummary(p, 300);
  return {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: String(p.title || '').slice(0, 110), url, mainEntityOfPage: url,
    datePublished: p.published_at,
    author: p.author?.name ? { '@type': 'Person', name: p.author.name } : { '@type': 'Organization', name: businessName },
    publisher: { '@type': 'Organization', name: businessName },
    ...(image ? { image: site.baseUrl + image } : {}),
    ...(p.category ? { articleSection: p.category.name } : {}),
    ...(summary ? { description: summary } : {}),
  };
}

/** The category pages to write, each with the posts it lists. Pure. */
export const postCategories = (c: SnapshotContent) => categoriesWithPosts(c.posts);

/** The post styles, in each template's own colours. */
export const POST_CSS = `
.post-row{display:grid;grid-template-columns:220px 1fr;gap:24px;align-items:start}
.post-row.no-thumb{grid-template-columns:1fr}
.post-row[hidden]{display:none}
.post-thumb{display:block;border-radius:var(--radius,12px);overflow:hidden}
.post-thumb img{display:block;width:100%;height:auto;aspect-ratio:3/2;object-fit:cover}
.post-text h2{margin:0}
.post-text h2 a{color:var(--ink);text-decoration:none}
.post-text h2 a:hover{text-decoration:underline}
.post-cover img{display:block;width:100%;height:auto}
.post-kicker{color:var(--accent-dark,var(--accent));font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:0 0 6px}
.post-cats{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 8px}
.post-cats a{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border:1px solid var(--line);border-radius:999px;color:var(--ink);text-decoration:none}
.post-cats a:hover{border-color:var(--ink)}
.post-cats a[aria-current="page"]{background:var(--ink);border-color:var(--ink);color:var(--card,#fff)}
.post-fig{margin:24px 0}
.post-fig img{display:block;width:100%;height:auto;border-radius:var(--radius,12px)}
.post-fig figcaption{color:var(--soft);font-size:.9rem;font-style:italic;margin-top:8px}
.post-author{display:flex;gap:14px;align-items:center;border:1px solid var(--line);border-radius:var(--radius,14px);padding:16px 18px;margin:32px 0 0}
.post-author-photo{display:block;width:56px;height:56px;border-radius:999px;object-fit:cover}
.post-author-mark{flex:0 0 auto;display:inline-grid;place-items:center;width:56px;height:56px;border-radius:999px;background:var(--line);color:var(--ink);font-weight:700}
.post-author-name{font-weight:700;margin:0}
.post-author-bio{color:var(--soft);margin:2px 0 0}
.post-more{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:28px}
@media (max-width:700px){.post-row{grid-template-columns:1fr;gap:12px}}
`;
