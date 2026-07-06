// M2 closeout — ARB D1/D2 behavioral probes (New Test 1 + New Test 2).
// Service-role driven (retention pruning and hard media deletes are
// function/operator concerns). Env: SB, SR_KEY.
const SB = Deno.env.get("SB");
const SR = Deno.env.get("SR_KEY");
if (!SB || !SR) { console.error("need SB, SR_KEY"); Deno.exit(1); }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const rest = (p, i = {}) => fetch(`${SB}/rest/v1/${p}`, { ...i, headers: { ...H, ...(i.headers || {}) } });
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const results = [];
const ok = (n, p, note = "") => { results.push({ n, p }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${note ? " — " + note : ""}`); };

const site = (await j(await rest(`presence_sites?select=id&limit=1`)))[0];
if (!site) { console.error("no presence site seeded — run rls_probe first"); Deno.exit(1); }

// ═══ New Test 1: snapshot retention (D1) ═══
const mkSnap = async (tag) => (await j(await rest(`presence_snapshots`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, content: { tag }, template_slug: "restaurant-classic", template_version: "1.0.0", created_by_kind: "system" }) })))[0];
const mkPub = async (snapId, summary) => {
  const p = (await j(await rest(`presence_publishes`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, snapshot_id: snapId, actor_kind: "system", change_summary: summary }) })))[0];
  // complete it so the one-in-flight index frees up
  await rest(`presence_publishes?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ status: "live", completed_at: new Date().toISOString() }) });
  return p;
};
await rest(`presence_publishes?site_id=eq.${site.id}&status=in.(queued,deploying)`, { method: "PATCH", body: JSON.stringify({ status: "live", completed_at: new Date().toISOString() }) }); // drain in-flight from prior runs
const s1 = await mkSnap("old"); const s2 = await mkSnap("mid"); const s3 = await mkSnap("current");
ok("retention: three snapshots created", !!(s1?.id && s2?.id && s3?.id));
const p1 = await mkPub(s1.id, "old publish"); const p2 = await mkPub(s2.id, "mid publish"); const p3 = await mkPub(s3.id, "current publish");
ok("retention: three publishes recorded + completed", !!(p1?.id && p2?.id && p3?.id));

// prune the oldest PUBLISHED snapshot — the exact case D1 exists for
{ const r = await rest(`presence_snapshots?id=eq.${s1.id}`, { method: "DELETE" }); ok("retention: pruning a published snapshot succeeds", r.status === 204 || r.status === 200, String(r.status)); }
{ const d = await j(await rest(`presence_publishes?id=eq.${p1.id}&select=id,snapshot_id,change_summary,status`));
  ok("retention: publish history row SURVIVES prune", d.length === 1 && d[0].change_summary === "old publish");
  ok("retention: pruned publish shows snapshot_id NULL (honest, unrestorable)", d[0]?.snapshot_id === null); }
{ const d = await j(await rest(`presence_publishes?id=eq.${p2.id}&select=snapshot_id`));
  ok("retention: retained publish keeps its snapshot reference", d[0]?.snapshot_id === s2.id); }
// retained snapshot still restores: a kind=restore publish referencing it inserts fine
{ const r = await rest(`presence_publishes`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, snapshot_id: s2.id, kind: "restore", actor_kind: "system", change_summary: "restore probe" }) });
  const d = await j(r); ok("retention: retained snapshot still restorable (kind=restore insert)", r.status === 201 && d[0]?.snapshot_id === s2.id, String(r.status));
  if (d[0]?.id) await rest(`presence_publishes?id=eq.${d[0].id}`, { method: "PATCH", body: JSON.stringify({ status: "live", completed_at: new Date().toISOString() }) }); }

// ═══ New Test 2: media FK behavior (D2) ═══
const med = (await j(await rest(`presence_media`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, storage_path: `presence-media/${site.id}/${crypto.randomUUID()}.jpg`, alt_text: "probe dish photo", mime: "image/jpeg" }) })))[0];
const offM = (await j(await rest(`presence_offerings`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, name: "FK Probe Dish", category: "Probes", media_id: med.id }) })))[0];
const postM = (await j(await rest(`presence_posts`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: site.id, title: "FK Probe Post", slug: "fk-probe-post-" + Date.now(), hero_media_id: med.id }) })))[0];
ok("media: media + offering + post referencing it created", !!(med?.id && offM?.media_id === med.id && postM?.hero_media_id === med.id));
// dangling-uuid rejection now enforced by FK
{ const r = await rest(`presence_offerings`, { method: "POST", body: JSON.stringify({ site_id: site.id, name: "Dangler", category: "Probes", media_id: crypto.randomUUID() }) });
  ok("media: FK rejects a dangling media_id", r.status >= 400, String(r.status)); }
// hard delete the media
{ const r = await rest(`presence_media?id=eq.${med.id}`, { method: "DELETE" }); ok("media: hard delete succeeds", r.status === 204 || r.status === 200, String(r.status)); }
{ const d = await j(await rest(`presence_offerings?id=eq.${offM.id}&select=id,name,media_id`));
  ok("media: offering survives, media_id set NULL", d.length === 1 && d[0].media_id === null); }
{ const d = await j(await rest(`presence_posts?id=eq.${postM.id}&select=id,title,hero_media_id`));
  ok("media: post survives, hero_media_id set NULL", d.length === 1 && d[0].hero_media_id === null); }

// tidy the probe rows (keep history tables append-only — publishes/snapshots stay)
await rest(`presence_offerings?id=eq.${offM.id}`, { method: "DELETE" });
await rest(`presence_posts?id=eq.${postM.id}`, { method: "DELETE" });

const fails = results.filter((r) => !r.p);
console.log(`\n════ RETENTION/MEDIA PROBES: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
