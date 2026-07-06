// ── M5 pipeline tests: preview, publish, validation, media, history, restore,
//    hostile scenarios. Runs against a live environment (staging). Env: SB,
//    SR_KEY, ANON. Netlify-dependent steps assert DESIGNED failure behavior
//    when NETLIFY_AUTH_TOKEN is absent (calm client message, operator-only
//    error_text, failed record) — rerun after token setup for full e2e.
const SB = Deno.env.get("SB"), SR = Deno.env.get("SR_KEY"), ANON = Deno.env.get("ANON");
if (!SB || !SR || !ANON) { console.error("need SB, SR_KEY, ANON"); Deno.exit(1); }
const FN = `${SB}/functions/v1/presence`;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const rest = (p, i = {}) => fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { ...H, ...(i.headers || {}) } });
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const results = [];
const ok = (n, p, note = "") => { results.push({ n, p }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${note ? " — " + note : ""}`); };
const call = async (method, route, jwt, body) => {
  const h = { "Content-Type": "application/json" };
  if (jwt) h["x-dds-user-jwt"] = jwt;
  const r = await fetch(`${FN}${route}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
const jc = (x) => { try { return JSON.parse(x); } catch { return null; } };

// ── setup: client A + fully publishable draft content ──
const A_EMAIL = "rcat-acceptance@example.com";
const cA = (await j(await rest(`clients?email=eq.${encodeURIComponent(A_EMAIL)}&select=id`)))[0];
let site = (await j(await rest(`presence_sites?client_id=eq.${cA.id}&select=id`)))[0];
if (!site) site = (await j(await rest(`presence_sites`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ client_id: cA.id }) })))[0];
await rest(`presence_entitlements?client_id=eq.${cA.id}&product=eq.presence`, { method: "DELETE" });
await rest(`presence_entitlements`, { method: "POST", body: JSON.stringify({ client_id: cA.id, product: "presence", status: "active" }) });
// identity + location from fixture-grade data (idempotent upserts)
await rest(`presence_identity?on_conflict=site_id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ site_id: site.id, business_name: "RCAT Test Bistro", description: "A cozy test bistro serving deterministic plates.", phone: "(323) 555-0100", email: "hi@rcat.example", tagline: "Test plates, real pipeline" }) });
const HOURS = [
  { day: "mon", closed: true, intervals: [] },
  { day: "tue", closed: false, intervals: [{ open: "17:00", close: "22:00" }] },
  { day: "wed", closed: false, intervals: [{ open: "17:00", close: "22:00" }] },
  { day: "thu", closed: false, intervals: [{ open: "17:00", close: "22:00" }] },
  { day: "fri", closed: false, intervals: [{ open: "17:00", close: "23:00" }] },
  { day: "sat", closed: false, intervals: [{ open: "12:00", close: "23:00" }] },
  { day: "sun", closed: false, intervals: [{ open: "12:00", close: "20:00" }] },
];
const locExist = (await j(await rest(`presence_locations?site_id=eq.${site.id}&select=id`)))[0];
if (locExist) await rest(`presence_locations?id=eq.${locExist.id}`, { method: "PATCH", body: JSON.stringify({ address_line1: "1 Test Way", city: "Los Angeles", region: "CA", postal_code: "90001", timezone: "America/Los_Angeles", hours: HOURS }) });
else await rest(`presence_locations`, { method: "POST", body: JSON.stringify({ site_id: site.id, address_line1: "1 Test Way", city: "Los Angeles", region: "CA", postal_code: "90001", timezone: "America/Los_Angeles", hours: HOURS }) });
const havePasta = (await j(await rest(`presence_offerings?site_id=eq.${site.id}&deleted_at=is.null&name=eq.Pipeline%20Pasta&select=id`))).length > 0;
if (!havePasta) await rest(`presence_offerings`, { method: "POST", body: JSON.stringify({ site_id: site.id, name: "Pipeline Pasta", category: "Mains", price_text: "$18", description: "Al dente, every run." }) });
// drain in-flight publishes from prior runs
await rest(`presence_publishes?site_id=eq.${site.id}&status=in.(queued,deploying)`, { method: "PATCH", body: JSON.stringify({ status: "failed", error_text: "test-drain", completed_at: new Date().toISOString() }) });

// mint A's jwt
const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
const uA = (users.users || []).find((x) => (x.email || "").toLowerCase() === A_EMAIL);
const pwA = "m5-" + crypto.randomUUID().slice(0, 10);
await fetch(`${SB}/auth/v1/admin/users/${uA.id}`, { method: "PUT", headers: H, body: JSON.stringify({ password: pwA }) });
const jwtA = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: A_EMAIL, password: pwA }) })).json()).access_token;
ok("setup: publishable draft + jwt", !!jwtA && !!site?.id);

// ═══ 1. PREVIEW ═══
{ const r = await call("GET", "/preview", null); ok("preview: unauthenticated → 401", r.status === 401, String(r.status)); }
let previewHtml = "";
{ const t0 = performance.now();
  const r = await call("GET", "/preview", jwtA);
  const ms = performance.now() - t0;
  previewHtml = r.text;
  ok("preview: 200 HTML document with draft content", r.status === 200 && previewHtml.startsWith("<!DOCTYPE html>") && previewHtml.includes("RCAT Test Bistro"), String(r.status));
  ok("preview: no-store + blocker headers present", r.headers.get("cache-control") === "no-store" && r.headers.get("x-presence-draft-blockers") !== null, `blockers=${r.headers.get("x-presence-draft-blockers")}`);
  ok("preview: renderer artifacts present (skip link, JSON-LD, hours table)", previewHtml.includes('class="skip"') && previewHtml.includes("application/ld+json") && previewHtml.includes('<table class="hours">'));
  ok("preview: stylesheet inlined (self-contained page)", previewHtml.includes("<style>:root{--ink") && !previewHtml.includes('rel="stylesheet"'));
  console.log(`      preview latency: ${ms.toFixed(0)}ms`);
}
{ const r = await call("GET", "/preview?page=/menu/", jwtA); ok("preview: ?page=/menu/ renders menu page", r.status === 200 && r.text.includes("Pipeline Pasta"), String(r.status)); }
{ const r = await call("GET", "/preview?page=/nope/", jwtA); ok("preview: unknown page → 404", r.status === 404, String(r.status)); }

// ═══ 2. VALIDATION (publish blocked before render) ═══
{ // break the draft: clear business_name; publish must 422 with field-anchored plain language
  await rest(`presence_identity?site_id=eq.${site.id}`, { method: "PATCH", body: JSON.stringify({ business_name: "" }) });
  const r = await call("POST", "/publish", jwtA);
  const body = jc(r.text);
  ok("validate: invalid draft → 422 with plain-language fields", r.status === 422 && body?.error === "validation_failed" && (body?.fields || []).some((f) => f.field === "identity.business_name"), String(r.status));
  ok("validate: no stack traces / internals in error", !r.text.includes("at ") && !r.text.toLowerCase().includes("supabase") && !r.text.includes("postgres"));
  await rest(`presence_identity?site_id=eq.${site.id}`, { method: "PATCH", body: JSON.stringify({ business_name: "RCAT Test Bistro" }) });
}

// ═══ 3. PUBLISH (deploy-boundary behavior without Netlify config) ═══
{ const r = await call("POST", "/publish", jwtA);
  const body = jc(r.text);
  // designed behavior with no netlify_site_id/token: calm 502, failed record, operator detail internal
  ok("publish: valid draft reaches pipeline; unconfigured hosting fails CALMLY", r.status === 502 && body?.error === "publish_failed" && String(body?.message || "").includes("nothing changed on your live site"), String(r.status));
  const rec = (await j(await rest(`presence_publishes?site_id=eq.${site.id}&order=created_at.desc&limit=1&select=status,error_text,kind,snapshot_id,change_summary`)))[0];
  ok("publish: failed record written w/ operator-only error_text + snapshot persisted", rec?.status === "failed" && /netlify_site_id|NETLIFY_AUTH_TOKEN/.test(rec?.error_text || "") && !!rec?.snapshot_id, rec?.error_text?.slice(0, 60));
  ok("publish: client message NEVER contains the internal detail", !String(body?.message || "").toLowerCase().includes("netlify"));
  // snapshot immutable + stamped
  const snap = (await j(await rest(`presence_snapshots?id=eq.${rec.snapshot_id}&select=content_contract_version,template_slug,template_version,created_by_kind`)))[0];
  ok("snapshot: stamped contract v1 + template + provenance", snap?.content_contract_version === 1 && snap?.template_slug === "restaurant-classic" && snap?.created_by_kind === "client");
}

// ═══ 4. ONE PUBLISH AT A TIME (race-safe via partial unique index) ═══
{ // plant an in-flight record, then attempt a publish
  const snapId = (await j(await rest(`presence_snapshots?site_id=eq.${site.id}&order=created_at.desc&limit=1&select=id`)))[0].id;
  const inflight = (await j(await rest(`presence_publishes`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, snapshot_id: snapId, actor_kind: "system", change_summary: "inflight-probe" }) })))[0];
  const r = await call("POST", "/publish", jwtA);
  ok("publish: second publish while one is queued → 409 plain message", r.status === 409 && jc(r.text)?.error === "publish_in_progress", String(r.status));
  await rest(`presence_publishes?id=eq.${inflight.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error_text: "test-drain", completed_at: new Date().toISOString() }) });
}

// ═══ 5. MEDIA PIPELINE ═══
{ const bad = await call("POST", "/media/upload-url", jwtA, { mime: "image/gif", bytes: 1000, alt_text: "a gif" });
  ok("media: mime allowlist rejects gif → 422", bad.status === 422, String(bad.status)); }
{ const bad = await call("POST", "/media/upload-url", jwtA, { mime: "image/jpeg", bytes: 99 * 1024 * 1024, alt_text: "huge" });
  ok("media: 10MB cap enforced → 422", bad.status === 422, String(bad.status)); }
{ const bad = await call("POST", "/media/upload-url", jwtA, { mime: "image/jpeg", bytes: 1000, alt_text: "x" });
  ok("media: alt text required → 422", bad.status === 422, String(bad.status)); }
let mediaId = null;
{ const good = await call("POST", "/media/upload-url", jwtA, { mime: "image/png", bytes: 68, alt_text: "one red test pixel", width: 1, height: 1 });
  const body = jc(good.text)?.data;
  mediaId = body?.media_id;
  ok("media: signed upload URL + row issued", good.status === 200 && !!body?.upload_url && !!mediaId, String(good.status));
  if (body?.upload_url) {
    // upload a real 1x1 png through the signed URL
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const up = await fetch(body.upload_url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
    ok("media: bytes accepted through signed URL (private bucket)", up.ok, String(up.status));
  }
}
{ // reference it from an offering → delete must refuse and NAME the blocker
  const off = (await j(await rest(`presence_offerings`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, name: "Photo Dish", category: "Mains", media_id: mediaId }) })))[0];
  const del = await call("DELETE", `/media/${mediaId}`, jwtA);
  ok("media: in-use delete refused, blocker named", del.status === 409 && jc(del.text)?.message?.includes("Photo Dish"), String(del.status));
  await rest(`presence_offerings?id=eq.${off.id}`, { method: "DELETE" });
  const del2 = await call("DELETE", `/media/${mediaId}`, jwtA);
  ok("media: unreferenced delete succeeds", del2.status === 200, String(del2.status));
}

// ═══ 6. HISTORY (plain language, internals hidden) ═══
{ const r = await call("GET", "/publishes", jwtA);
  const rows = jc(r.text)?.data || [];
  ok("history: 200 + rows with plain fields", r.status === 200 && rows.length >= 1 && rows[0].summary !== undefined && rows[0].status !== undefined, `${rows.length} rows`);
  ok("history: NO deploy ids / error_text leak to clients", !r.text.includes("netlify") && !r.text.includes("error_text") && !r.text.includes("NETLIFY"));
}

// ═══ 7. RESTORE ═══
{ const r = await call("POST", "/restore", jwtA, {});
  ok("restore: missing publish_id → 400", r.status === 400, String(r.status)); }
{ // point at a history row whose snapshot exists → same pipeline → same calm config failure
  const rec = (await j(await rest(`presence_publishes?site_id=eq.${site.id}&snapshot_id=not.is.null&order=created_at.desc&limit=1&select=id`)))[0];
  const r = await call("POST", "/restore", jwtA, { publish_id: rec.id });
  const restored = (await j(await rest(`presence_publishes?site_id=eq.${site.id}&order=created_at.desc&limit=1&select=kind,status`)))[0];
  ok("restore: flows through the SAME pipeline (kind=restore recorded)", restored?.kind === "restore", `${r.status}/${restored?.kind}`);
}
{ // pruned snapshot → honest 410
  const snapX = (await j(await rest(`presence_snapshots`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, content: { x: 1 }, template_slug: "restaurant-classic", template_version: "1.0.0", created_by_kind: "system" }) })))[0];
  const pubX = (await j(await rest(`presence_publishes`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, snapshot_id: snapX.id, actor_kind: "system", change_summary: "prune-probe" }) })))[0];
  await rest(`presence_publishes?id=eq.${pubX.id}`, { method: "PATCH", body: JSON.stringify({ status: "live", completed_at: new Date().toISOString() }) });
  await rest(`presence_snapshots?id=eq.${snapX.id}`, { method: "DELETE" });
  const r = await call("POST", "/restore", jwtA, { publish_id: pubX.id });
  ok("restore: pruned snapshot → honest 410 not_restorable", r.status === 410 && jc(r.text)?.error === "not_restorable", String(r.status));
}

// ═══ 8. HOSTILE ═══
{ // B (no site) cannot publish/preview at all
  const B_EMAIL = "rcat-hostile-b@example.com";
  let uB = (users.users || []).find((x) => (x.email || "").toLowerCase() === B_EMAIL);
  const pwB = "m5b-" + crypto.randomUUID().slice(0, 8);
  if (!uB) uB = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email: B_EMAIL, password: pwB, email_confirm: true }) })).json();
  else await fetch(`${SB}/auth/v1/admin/users/${uB.id}`, { method: "PUT", headers: H, body: JSON.stringify({ password: pwB }) });
  const cB = (await j(await rest(`clients?email=eq.${encodeURIComponent(B_EMAIL)}&select=id`)))[0] ||
    (await j(await rest(`clients`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: "RCAT Hostile B", email: B_EMAIL, contact_email: B_EMAIL, status: "archived" }) })))[0];
  const jwtB = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: B_EMAIL, password: pwB }) })).json()).access_token;
  const p1 = await call("POST", "/publish", jwtB);
  const p2 = await call("GET", "/preview", jwtB);
  ok("hostile: siteless client cannot publish or preview (404 no_site)", p1.status === 404 && p2.status === 404, `${p1.status}/${p2.status}`);
  const p3 = await call("POST", "/admin/restore-deploy", jwtB, { site_id: site.id, deploy_id: "x" });
  ok("hostile: client blocked from admin instant-restore (403)", p3.status === 403, String(p3.status));
  await rest(`clients?id=eq.${cB.id}`, { method: "DELETE" });
  await fetch(`${SB}/auth/v1/admin/users/${uB.id}`, { method: "DELETE", headers: H });
}
{ // paused entitlement blocks publish but not preview-read? (preview is a GET = read)
  await rest(`presence_entitlements?client_id=eq.${cA.id}&product=eq.presence`, { method: "PATCH", body: JSON.stringify({ status: "paused" }) });
  const pub = await call("POST", "/publish", jwtA);
  const prev = await call("GET", "/preview", jwtA);
  ok("hostile: paused → publish 403, preview (read) still works", pub.status === 403 && prev.status === 200, `${pub.status}/${prev.status}`);
  await rest(`presence_entitlements?client_id=eq.${cA.id}&product=eq.presence`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ M5 PIPELINE: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) { for (const f of fails) console.log(" FAIL:", f.n); Deno.exit(1); }
