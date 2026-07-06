// ── M7 room-API suite: the Client Room's read model + write surfaces ─────────
// Covers: GET /health (tri-state + four facts), GET /changes (diff sentences),
// GET /notes + dismiss/accept outcomes, content CRUD (faqs/offerings +
// singletons), GET /media with usage flags, preview ?version/?publish_id,
// POST /restore-to-draft (Draft Writer e2e: real publish -> mutate -> restore
// -> hidden-not-deleted + safety snapshot + provenance).
// Runs against a live environment (staging). Env: SB, SR_KEY, ANON.
// Requires: rcat-acceptance@example.com seeded, hosting provisioned
// (admin POST /admin/sites repairs it), NETLIFY_AUTH_TOKEN set on the function.
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
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, headers: r.headers, text, json };
};

// ── setup: client jwt + baseline draft (same seed as pipeline_test) ──
const A_EMAIL = "rcat-acceptance@example.com";
const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
const uA = (users.users || []).find((x) => (x.email || "").toLowerCase() === A_EMAIL);
const pwA = "rcat-" + crypto.randomUUID().slice(0, 12);
await fetch(`${SB}/auth/v1/admin/users/${uA.id}`, { method: "PUT", headers: H, body: JSON.stringify({ password: pwA }) });
const jwt = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: A_EMAIL, password: pwA }) })).json()).access_token;
if (!jwt) { console.error("no jwt for rcat identity"); Deno.exit(1); }
const cA = (await j(await rest(`clients?email=eq.${encodeURIComponent(A_EMAIL)}&select=id`)))[0];
const site = (await j(await rest(`presence_sites?client_id=eq.${cA.id}&select=id,netlify_site_id`)))[0];
// identity baseline (the diff + health suites assume these exact values)
await call("PUT", "/identity", jwt, { business_name: "RCAT Test Bistro", description: "A cozy test bistro serving deterministic plates.", phone: "(323) 555-0100", email: "hi@rcat.example", tagline: "Test plates, real pipeline" });
// drain in-flight publishes from prior runs
await rest(`presence_publishes?site_id=eq.${site.id}&status=in.(queued,deploying)`, { method: "PATCH", body: JSON.stringify({ status: "failed", error_text: "test-drain", completed_at: new Date().toISOString() }) });

// ═══ 1. health ═══
{
  const r = await call("GET", "/health", jwt);
  ok("health: 200", r.status === 200, `state=${r.json?.data?.state}`);
  ok("health: sentence + four facts", !!r.json?.data?.sentence && !!r.json?.data?.facts?.website && !!r.json?.data?.facts?.draft && !!r.json?.data?.facts?.last_publish && !!r.json?.data?.facts?.domain);
  ok("health: tri-state enum, never a score", ["healthy", "needs_attention", "outdated"].includes(r.json?.data?.state) && !("score" in (r.json?.data ?? {})));
}
// ═══ 2. changes ═══
{
  const r = await call("GET", "/changes", jwt);
  ok("changes: 200 with sentence list", r.status === 200 && Array.isArray(r.json?.data?.changes), `count=${r.json?.data?.count}`);
  ok("changes: sentences are plain strings w/ sections", (r.json?.data?.changes ?? []).every((c) => typeof c.sentence === "string" && typeof c.section === "string"));
}
// ═══ 3. notes: grammar + outcomes ═══
{
  const r = await call("GET", "/notes", jwt);
  ok("notes: 200, max three", r.status === 200 && Array.isArray(r.json?.data) && r.json.data.length <= 3, `n=${r.json?.data?.length}`);
  const note = r.json?.data?.[0];
  if (note) {
    ok("notes: grammar (title+reason+action)", typeof note.title === "string" && typeof note.reason === "string" && typeof note.action === "object");
    const d = await call("POST", `/notes/${note.id}/dismiss`, jwt);
    ok("notes: dismiss records outcome", d.status === 200, note.title);
    const r2 = await call("GET", "/notes", jwt);
    ok("notes: dismiss means gone", !(r2.json?.data ?? []).some((n) => n.id === note.id));
  } else console.log("      (no active notes this run — dismissal path exercised when one exists)");
  const bad = await call("POST", `/notes/${crypto.randomUUID()}/accept`, jwt);
  ok("notes: resolving unknown note -> 404", bad.status === 404);
}
// ═══ 4. content CRUD (faqs as the representative collection) ═══
{
  const c = await call("POST", "/faqs", jwt, { question: "Do you smoke-test?", answer: "Every deploy." });
  const faqId = c.json?.data?.id ?? null;
  ok("crud: create -> 201 + id", c.status === 201 && !!faqId);
  const u = await call("PATCH", `/faqs/${faqId}`, jwt, { answer: "Every single deploy." });
  ok("crud: update -> 200", u.status === 200);
  const l = await call("GET", "/faqs", jwt);
  ok("crud: listed", (l.json?.data ?? []).some((f) => f.id === faqId));
  const d = await call("DELETE", `/faqs/${faqId}`, jwt);
  ok("crud: soft delete -> 200", d.status === 200);
  const l2 = await call("GET", "/faqs", jwt);
  ok("crud: gone from list", !(l2.json?.data ?? []).some((f) => f.id === faqId));
  const empty = await call("PATCH", `/faqs/${crypto.randomUUID()}`, jwt, {});
  ok("crud: empty update rejected -> 400", empty.status === 400);
}
// ═══ 5. hide/show toggle ═══
{
  const l = await call("GET", "/offerings", jwt);
  const o = (l.json?.data ?? [])[0];
  if (o) {
    const h = await call("PATCH", `/offerings/${o.id}`, jwt, { is_visible: false });
    ok("toggle: hide -> 200", h.status === 200);
    const s = await call("PATCH", `/offerings/${o.id}`, jwt, { is_visible: true });
    ok("toggle: show -> 200", s.status === 200);
  } else console.log("      (no offerings seeded — toggle skipped)");
}
// ═══ 6. singletons ═══
{
  ok("singleton: GET /settings 200", (await call("GET", "/settings", jwt)).status === 200);
  ok("singleton: PUT /settings 200", (await call("PUT", "/settings", jwt, { category_order: ["Mains", "Starters"] })).status === 200);
  ok("singleton: GET /location 200", (await call("GET", "/location", jwt)).status === 200);
  ok("singleton: GET /voice 200", (await call("GET", "/voice", jwt)).status === 200);
}
// ═══ 7. media list with usage flags ═══
{
  const r = await call("GET", "/media", jwt);
  ok("media: 200 + used_by arrays", r.status === 200 && Array.isArray(r.json?.data) && (r.json.data.length === 0 || Array.isArray(r.json.data[0].used_by)), `n=${r.json?.data?.length}`);
}
// ═══ 8. preview versions ═══
{
  const d = await call("GET", "/preview?page=/", jwt);
  ok("preview: draft 200 html + version header", d.status === 200 && d.text.includes("<html") && d.headers.get("x-presence-preview-version") === "draft");
  const badPub = await call("GET", `/preview?publish_id=${crypto.randomUUID()}`, jwt);
  ok("preview: unknown publish -> 410", badPub.status === 410);
}
// ═══ 9. Draft Writer e2e: publish -> mutate -> restore-to-draft ═══
if (!site.netlify_site_id) {
  console.log("      (no hosting attached — Draft Writer e2e skipped; run admin provisioning first)");
} else {
  const pub = await call("POST", "/publish", jwt);
  ok("restore-e2e: publish accepted", pub.status === 200 || pub.status === 202, `status=${pub.status} ${pub.json?.error ?? ""}`);
  let final = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => setTimeout(res, 3000));
    const rows = await j(await rest(`presence_publishes?site_id=eq.${site.id}&select=id,status,error_text&order=created_at.desc&limit=1`));
    final = rows[0];
    if (final && !["queued", "deploying"].includes(final.status)) break;
  }
  ok("restore-e2e: publish reached live", final?.status === "live", `status=${final?.status} ${final?.error_text ?? ""}`);
  if (final?.status === "live") {
    await call("PUT", "/identity", jwt, { tagline: "Mutated after publish" });
    const added = await call("POST", "/offerings", jwt, { name: "Restore Probe Ravioli", category: "Mains", price_text: "$21" });
    ok("restore-e2e: draft mutated", added.status === 201);
    const ch1 = await call("GET", "/changes", jwt);
    ok("restore-e2e: diff sees mutations", ch1.json?.data?.count >= 2, `count=${ch1.json?.data?.count}`);
    const restore = await call("POST", "/restore-to-draft", jwt, { publish_id: final.id });
    ok("restore-e2e: restore-to-draft 200", restore.status === 200, restore.json?.data?.message);
    ok("restore-e2e: names the safety copy", (restore.json?.data?.set_aside ?? "").includes("safety"));
    const idn = await call("GET", "/identity", jwt);
    ok("restore-e2e: tagline round-tripped", idn.json?.data?.tagline === "Test plates, real pipeline", idn.json?.data?.tagline);
    const offRow = (await j(await rest(`presence_offerings?site_id=eq.${site.id}&name=eq.Restore%20Probe%20Ravioli&deleted_at=is.null&select=id,is_visible&order=created_at.desc&limit=1`)))[0];
    ok("restore-e2e: post-publish entity HIDDEN not deleted", offRow && offRow.is_visible === false, JSON.stringify(offRow));
    const ch2 = await call("GET", "/changes", jwt);
    ok("restore-e2e: draft matches live after restore", ch2.status === 200 && ch2.json?.data?.count === 0, `count=${ch2.json?.data?.count}`);
    const snaps = await j(await rest(`presence_snapshots?site_id=eq.${site.id}&select=content&order=created_at.desc&limit=1`));
    ok("restore-e2e: safety snapshot holds the mutated draft", snaps[0]?.content?.identity?.tagline === "Mutated after publish");
    const ev = await j(await rest(`presence_change_events?site_id=eq.${site.id}&entity_type=eq.restore&select=id&order=created_at.desc&limit=1`));
    ok("restore-e2e: restore provenance event written", !!ev[0]);
    if (offRow) await call("DELETE", `/offerings/${offRow.id}`, jwt); // tidy
    ok("restore-e2e: live preview renders after cycle", (await call("GET", "/preview?version=live", jwt)).status === 200);
  }
}
// ═══ 10. degenerate retained snapshots are designed-unrestorable ═══
{
  const cands = await j(await rest(`presence_publishes?site_id=eq.${site.id}&status=eq.live&snapshot_id=not.is.null&select=id,snapshot_id&order=created_at.asc&limit=10`));
  let degenerate = null;
  for (const c of cands) {
    const s = await j(await rest(`presence_snapshots?id=eq.${c.snapshot_id}&select=content`));
    if (s[0] && !s[0].content?.identity?.business_name) { degenerate = c; break; }
  }
  if (degenerate) {
    const r = await call("POST", "/restore-to-draft", jwt, { publish_id: degenerate.id });
    ok("degenerate: restore refused -> 410 (draft untouched)", r.status === 410, r.json?.message);
    const p = await call("GET", `/preview?publish_id=${degenerate.id}`, jwt);
    ok("degenerate: preview refused -> 410", p.status === 410);
  } else console.log("      (no degenerate retained snapshot on this site — refusal path idle)");
  const bad = await call("POST", "/restore-to-draft", jwt, { publish_id: crypto.randomUUID() });
  ok("restore: unknown publish -> 404", bad.status === 404);
  const malformed = await call("POST", "/restore-to-draft", jwt, {});
  ok("restore: missing id -> 400", malformed.status === 400);
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ ROOM API: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
