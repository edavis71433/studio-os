// M2 staging verification: presence_* tables, RLS ownership chain, default-deny
// system tables, and immutability triggers. Seeds via service role, probes as
// two real client JWTs (A = rcat-acceptance, B = disposable), tears down B.
const SB = Deno.env.get("SB");
const SR = Deno.env.get("SR_KEY");
const ANON = Deno.env.get("ANON");
if (!SB || !SR || !ANON) { console.error("need SB, SR_KEY, ANON"); Deno.exit(1); }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const rest = (p, i = {}) => fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { ...H, ...(i.headers || {}) } });
const results = [];
const ok = (n, p, note = "") => { results.push({ n, p }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${note ? " — " + note : ""}`); };

// ── seed (service role) ──
const A_EMAIL = "rcat-acceptance@example.com";
const cA = (await (await rest(`clients?email=eq.${encodeURIComponent(A_EMAIL)}&select=id`)).json())[0];
if (!cA) { console.error("staging test client missing"); Deno.exit(1); }
// site for A (idempotent)
let site = (await (await rest(`presence_sites?client_id=eq.${cA.id}&select=id`)).json())[0];
if (!site) site = (await (await rest(`presence_sites`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ client_id: cA.id }) })).json())[0];
ok("seed: presence_sites row (service)", !!site?.id, site?.id);
// identity singleton + one offering + change event + snapshot + publish + entitlement
await rest(`presence_identity`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ site_id: site.id, business_name: "RCAT Test Bistro" }) });
const off = (await (await rest(`presence_offerings`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, name: "Seeded Dish", category: "Mains", price_text: "$12" }) })).json())[0];
ok("seed: offering (service)", !!off?.id);
const ev = (await (await rest(`presence_change_events`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, entity_type: "offering", entity_id: off.id, action: "create", summary: "Seeded Dish added", actor_kind: "system", provenance: "import" }) })).json())[0];
ok("seed: change event (service)", !!ev?.id);
const snap = (await (await rest(`presence_snapshots`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, content: { probe: true }, template_slug: "restaurant-classic", template_version: "1.0.0", created_by_kind: "system" }) })).json())[0];
ok("seed: snapshot (service)", !!snap?.id);
await rest(`presence_publishes?site_id=eq.${site.id}&status=in.(queued,deploying)`, { method: "PATCH", body: JSON.stringify({ status: "live", completed_at: new Date().toISOString() }) }); // drain in-flight from prior runs (the one-in-flight index is doing its job)
const pub = (await (await rest(`presence_publishes`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, snapshot_id: snap.id, actor_kind: "system", change_summary: "probe publish" }) })).json())[0];
ok("seed: publish (service)", !!pub?.id);
await rest(`presence_entitlements`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ client_id: cA.id, product: "presence", status: "active" }) });

// ── mint JWTs ──
const pwA = "probe-" + crypto.randomUUID().slice(0, 10);
const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
const uA = (users.users || []).find((x) => (x.email || "").toLowerCase() === A_EMAIL);
await fetch(`${SB}/auth/v1/admin/users/${uA.id}`, { method: "PUT", headers: H, body: JSON.stringify({ password: pwA }) });
const jwtA = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: A_EMAIL, password: pwA }) })).json()).access_token;
const B_EMAIL = "rcat-probe-b@example.com";
let uB = (users.users || []).find((x) => (x.email || "").toLowerCase() === B_EMAIL);
const pwB = "probe-" + crypto.randomUUID().slice(0, 10);
if (!uB) uB = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email: B_EMAIL, password: pwB, email_confirm: true }) })).json();
else await fetch(`${SB}/auth/v1/admin/users/${uB.id}`, { method: "PUT", headers: H, body: JSON.stringify({ password: pwB }) });
// B gets a client row but NO presence site
let cB = (await (await rest(`clients?email=eq.${encodeURIComponent(B_EMAIL)}&select=id`)).json())[0];
if (!cB) cB = (await (await rest(`clients`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: "RCAT Probe B", email: B_EMAIL, contact_email: B_EMAIL, status: "archived" }) })).json())[0];
const jwtB = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: B_EMAIL, password: pwB }) })).json()).access_token;
ok("mint: client A + B JWTs", !!jwtA && !!jwtB);

const as = (jwt, p, i = {}) => fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(i.headers || {}) } });
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

// ── A: ownership works ──
{ const r = await as(jwtA, `presence_sites?select=id`); const d = await j(r); ok("A reads own site", r.status === 200 && d.length === 1); }
{ const r = await as(jwtA, `presence_offerings?select=id,name`); const d = await j(r); ok("A reads own offerings", r.status === 200 && d.length >= 1); }
{ const r = await as(jwtA, `presence_offerings`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, name: "A's Special", category: "Mains" }) }); const d = await j(r); ok("A inserts own offering", r.status === 201 && d[0]?.id, String(r.status)); }
{ const r = await as(jwtA, `presence_identity?site_id=eq.${site.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ tagline: "Probe tagline" }) }); const d = await j(r); ok("A updates own identity", r.status === 200 && d.length === 1); }
{ const r = await as(jwtA, `presence_change_events?select=id&limit=5`); const d = await j(r); ok("A reads own change events", r.status === 200 && d.length >= 1); }

// ── A: system tables are deny ──
{ const r = await as(jwtA, `presence_snapshots?select=id`); const d = await j(r); ok("A CANNOT read snapshots (0 rows)", r.status === 200 && d.length === 0); }
{ const r = await as(jwtA, `presence_publishes?select=id`); const d = await j(r); ok("A CANNOT read publishes (0 rows)", r.status === 200 && d.length === 0); }
{ const r = await as(jwtA, `presence_entitlements?select=id`); const d = await j(r); ok("A CANNOT read entitlements (0 rows)", r.status === 200 && d.length === 0); }
{ const r = await as(jwtA, `presence_change_events`, { method: "POST", body: JSON.stringify({ site_id: site.id, entity_type: "offering", action: "create", summary: "forged" }) }); ok("A CANNOT insert change event", r.status === 401 || r.status === 403, String(r.status)); }
{ const r = await as(jwtA, `presence_snapshots`, { method: "POST", body: JSON.stringify({ site_id: site.id, content: {}, template_slug: "x", template_version: "1" }) }); ok("A CANNOT insert snapshot", r.status === 401 || r.status === 403, String(r.status)); }
{ const r = await as(jwtA, `presence_redirects`, { method: "POST", body: JSON.stringify({ site_id: site.id, from_path: "/old", to_path: "/new" }) }); ok("A CANNOT write redirects (read-only)", r.status === 401 || r.status === 403, String(r.status)); }

// ── B: cross-client isolation ──
{ const r = await as(jwtB, `presence_sites?select=id`); const d = await j(r); ok("B sees no sites", r.status === 200 && d.length === 0); }
{ const r = await as(jwtB, `presence_offerings?select=id`); const d = await j(r); ok("B sees no offerings", r.status === 200 && d.length === 0); }
{ const r = await as(jwtB, `presence_offerings`, { method: "POST", body: JSON.stringify({ site_id: site.id, name: "B forged dish", category: "Hack" }) }); ok("B CANNOT insert into A's site", r.status === 401 || r.status === 403, String(r.status)); }
{ const r = await as(jwtB, `presence_identity?site_id=eq.${site.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ tagline: "hacked" }) }); const d = await j(r); ok("B CANNOT update A's identity (0 rows)", (r.status === 200 && Array.isArray(d) && d.length === 0) || r.status === 401 || r.status === 403, String(r.status)); }
{ const r = await as(jwtB, `presence_change_events?select=id`); const d = await j(r); ok("B sees no change events", r.status === 200 && d.length === 0); }

// ── immutability triggers (even service role is blocked) ──
{ const r = await rest(`presence_snapshots?id=eq.${snap.id}`, { method: "PATCH", body: JSON.stringify({ template_slug: "tampered" }) }); const t = await r.text(); ok("snapshot UPDATE blocked (service)", r.status >= 400 && t.includes("immutable"), `${r.status}`); }
{ const r = await rest(`presence_change_events?id=eq.${ev.id}`, { method: "PATCH", body: JSON.stringify({ summary: "tampered" }) }); const t = await r.text(); ok("change event UPDATE blocked (service)", r.status >= 400 && t.includes("immutable"), `${r.status}`); }
{ const r = await rest(`presence_change_events?id=eq.${ev.id}`, { method: "DELETE" }); const t = await r.text(); ok("change event DELETE blocked (service)", r.status >= 400 && t.includes("immutable"), `${r.status}`); }
{ const r = await rest(`presence_snapshots?id=eq.${snap.id}&select=id`, { method: "GET" }); const d = await j(r); ok("snapshot survives (still readable by service)", d.length === 1); }

// ── structural constraints ──
{ const r = await rest(`presence_posts`, { method: "POST", body: JSON.stringify({ site_id: site.id, title: "Bad Slug", slug: "Bad Slug!!" }) }); ok("slug format CHECK rejects bad slug", r.status >= 400, String(r.status)); }
{ const r = await rest(`presence_media`, { method: "POST", body: JSON.stringify({ site_id: site.id, storage_path: `presence-media/${site.id}/x.jpg`, alt_text: "a" }) }); ok("alt_text min-length CHECK rejects", r.status >= 400, String(r.status)); }
{ const r = await rest(`presence_publishes`, { method: "POST", body: JSON.stringify({ site_id: site.id, snapshot_id: snap.id, actor_kind: "system" }) }); ok("one-in-flight publish unique index rejects second queued", r.status >= 400, String(r.status)); }

// ── teardown probe-B ──
await rest(`clients?id=eq.${cB.id}`, { method: "DELETE" });
await fetch(`${SB}/auth/v1/admin/users/${uB.id}`, { method: "DELETE", headers: H });

const fails = results.filter((r) => !r.p);
console.log(`\n════ PRESENCE RLS/CONSTRAINT PROBES: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
