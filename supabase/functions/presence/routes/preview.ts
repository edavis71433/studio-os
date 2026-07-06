// GET /preview?page=/menu/ — render the CURRENT DRAFT through the exact same
// serializer + renderer that publish uses, return one page's HTML. No files
// written, no deploy. The ONLY preview-specific behavior (contract-permitted
// wrapper): image paths are substituted with short-lived signed transform URLs
// so drafts show real images before any publish exists.
import { json } from '../../_shared/http.ts';
import { getTemplate } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { validateSnapshot } from '../lib/manifest_validate.ts';
import { previewUrlMap } from '../lib/media.ts';
import type { SiteRow } from '../lib/site.ts';

export async function handlePreview(req: Request, site: SiteRow, cors: Record<string, string>) {
  const url = new URL(req.url);
  const page = url.searchParams.get('page') || '/';

  const t = getTemplate(site.template_slug, site.template_version);
  if (!t) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);

  const now = new Date().toISOString(); // preview timestamp = "as of right now" (never persisted)
  const { snapshot, mediaManifest } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now });

  // preview is allowed while INVALID — clients need to see drafts — but blockers ride along in a header
  const v = validateSnapshot(snapshot, t.manifest);

  const fileMap = t.render(snapshot, t.manifest, { baseUrl: 'https://preview.invalid' });
  const filePath = page === '/' ? 'index.html' : `${page.replace(/^\/|\/$/g, '')}/index.html`;
  let html = fileMap[filePath] as string | undefined;
  if (!html) return json({ error: 'page_not_found', message: `No page at ${page}.` }, 404, cors);

  // the contract-permitted wrapper: signed-image substitution + internal link rewrite to preview routes
  const urls = await previewUrlMap(mediaManifest);
  for (const [outPath, signed] of Object.entries(urls)) html = html!.replaceAll(`"${outPath}"`, `"${signed}"`);
  html = html!.replaceAll('https://preview.invalid', '');
  // inline the hashed stylesheet (a lone HTML response can't fetch deploy assets)
  const cssKey = Object.keys(fileMap).find((k) => k.startsWith('assets/') && k.endsWith('.css'));
  if (cssKey) html = html.replace(/<link rel="stylesheet" href="[^"]*">/, `<style>${fileMap[cssKey]}</style>`);

  return new Response(html, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Presence-Draft-Blockers': String(v.blockers.length),
      'X-Presence-Draft-Warnings': String(v.warnings.length),
    },
  });
}
