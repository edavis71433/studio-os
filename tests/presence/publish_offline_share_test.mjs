// ── Wave-1 publish surface: G5 publish windows · G6 share draft · G10 offline ─
//   deno run --allow-read --allow-env tests/presence/publish_offline_share_test.mjs
// Pure cores (offline holding page, schedule kinds, status shape) + the full
// signed-token probe (mint → validate → expired rejected → tampered rejected →
// site-scoped) + structural wiring. No network, no database.

const OP = await import('../../supabase/functions/presence/lib/offline_page.ts');
const { renderOfflinePage, offlineFileMap } = OP;
const CM = await import('../../supabase/functions/presence/lib/commercial.ts');
const { isScheduleKind, validateScheduleTime } = CM;
const PE = await import('../../supabase/functions/presence/lib/preview_env.ts');
const { shapePreviewStatus } = PE;
const PL = await import('../../supabase/functions/presence/lib/preview_link.ts');
const { signPreviewToken, verifyPreviewToken, clampTtlSeconds, PREVIEW_LINK_MAX_TTL_S } = PL;

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';

// ═══ G10 · the offline holding page (pure) ════════════════════════════════════
{
  const html = renderOfflinePage({ businessName: 'Rosie’s Bakery', accent: '#0a7d5c', email: 'hi@rosies.example', phone: '(818) 555-0199' });
  ok('offline page: on-brand — business name present', html.includes('Rosie’s Bakery'));
  ok('offline page: on-brand — accent color used', html.includes('#0a7d5c'));
  ok('offline page: honest wording (temporarily offline, not an error)', /temporarily offline/i.test(html));
  ok('offline page: noindex meta present', html.includes('noindex,nofollow'));
  ok('offline page: contact email + phone rendered', html.includes('mailto:hi@rosies.example') && html.includes('tel:8185550199') && html.includes('(818) 555-0199'));
  ok('offline page: carries the holding marker', html.includes('presence-offline-holding'));
  ok('offline page: self-contained (no external asset URLs)', !/src="http|href="http/.test(html));

  const hostile = renderOfflinePage({ businessName: '<script>alert(1)</script>', accent: 'red;}</style><script>', email: '"><img src=x>' });
  ok('offline page: SAFETY — name is escaped', !hostile.includes('<script>alert(1)</script>') && hostile.includes('&lt;script&gt;'));
  ok('offline page: SAFETY — a non-hex accent falls back to the default', hostile.includes('#5b3fa0') && !hostile.includes('</style><script>'));
  ok('offline page: empty input still renders an honest page', /temporarily offline/i.test(renderOfflinePage({})));
  ok('offline page: deterministic (same input → same bytes)', renderOfflinePage({ businessName: 'X' }) === renderOfflinePage({ businessName: 'X' }));

  const files = offlineFileMap(html);
  ok('offline deploy: index.html + 404.html both carry the holding page', files['index.html'] === html && files['404.html'] === html);
  ok('offline deploy: robots.txt disallows everything', /Disallow: \/\n/.test(files['robots.txt']));
  ok('offline deploy: _headers keeps the tenant security headers', /Strict-Transport-Security/.test(files['_headers']) && /X-Frame-Options: DENY/.test(files['_headers']) && /Content-Security-Policy/.test(files['_headers']));
  ok('offline deploy: _headers adds X-Robots-Tag noindex', /X-Robots-Tag: noindex/.test(files['_headers']));
  ok('offline deploy: ships exactly the four files (nothing of the site leaks)', Object.keys(files).sort().join(',') === '404.html,_headers,index.html,robots.txt');
}

// ═══ G5 · schedule kinds — 'offline' is a first-class scheduled action ════════
{
  ok('schedule: publish/revert/offline are the only kinds', isScheduleKind('publish') && isScheduleKind('revert') && isScheduleKind('offline'));
  ok('schedule: junk kinds refused', !isScheduleKind('delete') && !isScheduleKind('') && !isScheduleKind(null) && !isScheduleKind('OFFLINE'));
  const now = '2026-07-15T12:00:00.000Z';
  ok('schedule: a future time validates', validateScheduleTime('2026-07-16T09:00:00Z', now).ok === true);
  ok('schedule: the past refused', validateScheduleTime('2026-07-14T09:00:00Z', now).ok === false);
}

// ═══ G10 · status shape — the offline marker reaches the management surface ═══
{
  const st = shapePreviewStatus({ draftChanges: 2, preview: null, live: { last_published_at: '2026-07-01T00:00:00Z', summary: 's' }, baseUrl: 'https://x', offlineAt: '2026-07-10T00:00:00Z' });
  ok('status: offline_since surfaces on the live block', st.live.offline_since === '2026-07-10T00:00:00Z' && st.live.published === true);
  const on = shapePreviewStatus({ draftChanges: 0, preview: null, live: null, baseUrl: 'https://x' });
  ok('status: absent marker → online (null), older callers unaffected', on.live.offline_since === null);
}

// ═══ G6 · the full token-flow probe (mint → validate → expired → tampered) ════
{
  const secret = 'probe-secret-0111';
  const now = Math.floor(Date.now() / 1000);
  const ttl = clampTtlSeconds(7 * 86400);
  ok('token: 7 days is within the server ceiling', ttl === 7 * 86400 && ttl <= PREVIEW_LINK_MAX_TTL_S);
  const tok = await signPreviewToken({ site_id: SITE_A, exp: now + ttl, scope: 'preview' }, secret);
  const v = await verifyPreviewToken(tok, secret, now);
  ok('token: mint → validate round-trips', v.ok === true && v.payload.site_id === SITE_A);
  ok('token: site-scoped — the signed payload names exactly one site', v.ok && v.payload.site_id !== SITE_B && v.payload.scope === 'preview');

  const expired = await signPreviewToken({ site_id: SITE_A, exp: now - 10, scope: 'preview' }, secret);
  const ve = await verifyPreviewToken(expired, secret, now);
  ok('token: expiry enforced server-side (expired → rejected)', ve.ok === false && ve.error === 'expired');

  // tampered payload: re-point the body at another site, keep the old signature
  const [body, sig] = tok.split('.');
  const swapped = btoa(JSON.stringify({ site_id: SITE_B, exp: now + ttl, scope: 'preview' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const vt = await verifyPreviewToken(`${swapped}.${sig}`, secret, now);
  ok('token: tampered payload → rejected (bad signature)', vt.ok === false && vt.error === 'bad_signature');
  // deterministic tamper — flip the FIRST hex char. The old `slice(0,-2)+"ab"`
  // was a NO-OP whenever the sig already ended in "ab" (~1/256 of the
  // timestamp-derived sigs), so the "expect rejected" assertion reddened CI at
  // random (it did on deploy #20). Flipping char 0 always changes the string.
  const badSig = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
  const vs = await verifyPreviewToken(`${body}.${badSig}`, secret, now);
  ok('token: tampered signature → rejected', vs.ok === false && vs.error === 'bad_signature');
  const vw = await verifyPreviewToken(tok, 'some-other-secret', now);
  ok('token: wrong secret → rejected', vw.ok === false && vw.error === 'bad_signature');
  const vm = await verifyPreviewToken('not-a-token', secret, now);
  ok('token: malformed → rejected', vm.ok === false && vm.error === 'malformed');
}

// ═══ Structural wiring — one publish surface, no second path ══════════════════
{
  const pub = read('supabase/functions/presence/routes/publish.ts');
  ok('wiring: takeSiteOffline deploys the holding page via the ONE deploy machinery', /renderOfflinePage\(/.test(pub) && /offlineFileMap\(/.test(pub) && /deployFileMap\(site\.netlify_site_id, offlineFileMap/.test(pub));
  ok('wiring: offline never deletes — no deleteSite anywhere in the publish routes', !/deleteSite/.test(pub));
  ok('wiring: offline refuses while a publish is in flight', /publish_in_progress[\s\S]*take the site offline/.test(pub));
  ok('wiring: offline is provenance-logged', /Took the website offline/.test(pub) && /writeChangeEvent/.test(pub));
  ok('wiring: back-online restores the last live version through runPipeline', /handleBackOnline[\s\S]*runPipeline\(site, principal, 'restore'/.test(pub));
  ok('wiring: a live publish clears the offline marker (one invariant, one place)', /offline_at: null/.test(pub));

  const idx = read('supabase/functions/presence/index.ts');
  ok('wiring: POST /site/offline + /site/online registered behind the authed boundary', /'\/site\/offline' && method === 'POST'.*handleTakeOffline/.test(idx) && /'\/site\/online' && method === 'POST'.*handleBackOnline/.test(idx));

  const sched = read('supabase/functions/presence/ops/scheduler.ts');
  ok('wiring: the cron fires kind=offline through the SAME due-publish loop', /row\.kind === 'offline'/.test(sched) && /takeSiteOffline\(/.test(sched));

  const com = read('supabase/functions/presence/routes/commercial.ts');
  ok('wiring: scheduling offline freezes NO snapshot (holding page renders at fire time)', /kind === 'offline'[\s\S]{0,400}snapshotId = null/.test(com));

  const penv = read('supabase/functions/presence/routes/preview_env.ts');
  ok('wiring: share-link capture reuses the ONE preview-slot capture', /capturePreviewSlot\(site, principal\)/.test(penv) && /body\?\.capture === true/.test(penv));
  ok('wiring: share mint stays site-scoped + expiry-signed', /signPreviewToken\(\{ site_id: site\.id, exp/.test(penv));

  const mig = read('supabase/migrations/0111_offline_unpublish.sql');
  ok('migration 0111: offline_at + kind=offline + nullable snapshot_id (additive)', /add column if not exists offline_at/.test(mig) && /'publish','revert','offline'/.test(mig) && /alter column snapshot_id drop not null/.test(mig));
  ok('apply pack: docs/presence/APPLY-0111-prod.sql matches the house pattern', /APPLY PACK · migration 0111/.test(read('docs/presence/APPLY-0111-prod.sql')));

  const html = read('presence.html');
  ok('UI: Share draft affordance mints a captured, expiring link', /piShareDraft/.test(html) && /Share a draft link/.test(html) && /\/preview\/share-link", \{ capture: true, ttl_seconds: 7 \* 86400 \}/.test(html));
  ok('UI: publish ritual gains Publish later + pending list + cancel', /Publish later — pick a time…/.test(html) && /\/schedule\/\$\{s\.id\}\/cancel/.test(html));
  ok('UI: the optional unpublish-at leg schedules kind=offline', /kind: "offline"/.test(html));
  ok('UI: Take site offline has a scary-clear confirm', /Take \$\{name\} OFFLINE now\?/.test(html) && /Nothing is deleted/.test(html));
  ok('UI: back-online affordance present', /\/site\/online/.test(html) && /Bring my site back online/.test(html));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PUBLISH SURFACE (G5/G6/G10): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
