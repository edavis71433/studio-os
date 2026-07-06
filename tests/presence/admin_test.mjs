// ── M6 admin/provisioning/domain/lifecycle/recovery tests ────────────────────
// Runs the FULL journey a real customer takes: provision → live website →
// domain ops → lifecycle → recovery → teardown, entirely through the presence
// function's admin surface (the test never holds the Netlify token).
// Env: SB, SR_KEY, ANON. Requires staff user staging-staff@studio-os.test.
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
  return { status: r.status, text: await r.text() };
};
const jc = (x) => { try { return JSON.parse(x); } catch { return null; } };
const login = async (email, pw) => (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) })).json()).access_token;

// ── setup: staff JWT + a fresh e2e client ──
const users = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
const staffU = (users.users || []).find((x) => (x.email || "") === "staging-staff@studio-os.test");
const staffPw = "m6s-" + crypto.randomUUID().slice(0, 10);
await fetch(`${SB}/auth/v1/admin/users/${staffU.id}`, { method: "PUT", headers: H, body: JSON.stringify({ password: staffPw }) });
const staffJwt = await login("staging-staff@studio-os.test", staffPw);

const E2E_EMAIL = "rcat-m6-e2e@example.com";
// Get-or-create the e2e client. Clients with presence history can never be
// hard-deleted (change events are append-only BY DESIGN — cascade blocked), so
// runs reuse the client and reset its site back to a pristine pre-provision
// state (service role, test-only maneuver).
let client = (await j(await rest(`clients?email=eq.${encodeURIComponent(E2E_EMAIL)}&select=id`)))[0];
if (!client) client = (await j(await rest(`clients`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: "M6 E2E Diner", email: E2E_EMAIL, contact_email: E2E_EMAIL, status: "archived" }) })))[0];
const stale = (await j(await rest(`presence_sites?client_id=eq.${client.id}&select=id`)))[0];
if (stale) {
  await rest(`presence_publishes?site_id=eq.${stale.id}`, { method: "DELETE" });
  await rest(`presence_snapshots?site_id=eq.${stale.id}`, { method: "DELETE" });
  for (const t of ["presence_offerings", "presence_locations", "presence_identity", "presence_media"]) await rest(`${t}?site_id=eq.${stale.id}`, { method: "DELETE" });
  await rest(`presence_sites?id=eq.${stale.id}`, { method: "PATCH", body: JSON.stringify({ status: "draft", netlify_site_id: null, custom_domain: null, last_published_at: null }) });
}
ok("setup: staff jwt + pristine e2e client", !!staffJwt && !!client?.id);

// ═══ SECURITY: admin surface is staff-only ═══
{ const cA = (await j(await rest(`clients?email=eq.rcat-acceptance%40example.com&select=id`)))[0];
  const uA = (users.users || []).find((x) => (x.email || "").toLowerCase() === "rcat-acceptance@example.com");
  const pwA = "m6c-" + crypto.randomUUID().slice(0, 8);
  await fetch(`${SB}/auth/v1/admin/users/${uA.id}`, { method: "PUT", headers: H, body: JSON.stringify({ password: pwA }) });
  const cJwt = await login("rcat-acceptance@example.com", pwA);
  const r1 = await call("GET", "/admin/sites", cJwt);
  const r2 = await call("POST", "/admin/sites", cJwt, { client_id: cA.id });
  const r3 = await call("GET", "/admin/sites", null);
  ok("security: client blocked from ALL admin routes (403), anon 401", r1.status === 403 && r2.status === 403 && r3.status === 401, `${r1.status}/${r2.status}/${r3.status}`);
}

// ═══ PROVISIONING ═══
{ const r = await call("POST", "/admin/sites", staffJwt, { client_id: "00000000-0000-0000-0000-00000000dead" });
  ok("provision: unknown client → 404", r.status === 404, String(r.status)); }
{ const r = await call("POST", "/admin/sites", staffJwt, { client_id: client.id, template_slug: "no-such-template" });
  ok("provision: unknown template → 400", r.status === 400, String(r.status)); }

let siteId = null, netlifyUrl = null, netlifyId = null;
{ const t0 = performance.now();
  const r = await call("POST", "/admin/sites", staffJwt, { client_id: client.id });
  const ms = performance.now() - t0;
  const d = jc(r.text)?.data;
  siteId = d?.site_id; netlifyUrl = d?.netlify_url; netlifyId = d?.netlify_site_id;
  ok("provision: creates site + REAL Netlify site, status ready", (r.status === 201 || r.status === 200) && d?.status === "ready" && !!netlifyId && /https:\/\/presence-[0-9a-f]{12}\.netlify\.app/.test(netlifyUrl || ""), `${r.status} ${netlifyUrl} (${ms.toFixed(0)}ms)`);
  console.log(`      provision duration: ${ms.toFixed(0)}ms`);
  const ident = (await j(await rest(`presence_identity?site_id=eq.${siteId}&select=business_name`)))[0];
  ok("provision: initial draft seeded from client name", ident?.business_name === "M6 E2E Diner");
  const ent = (await j(await rest(`presence_entitlements?client_id=eq.${client.id}&select=status`)))[0];
  ok("provision: entitlement active", ent?.status === "active");
}
{ const r = await call("POST", "/admin/sites", staffJwt, { client_id: client.id });
  const d = jc(r.text)?.data;
  ok("provision: IDEMPOTENT rerun — same site, same hosting, no duplicates", r.status === 200 && d?.already_existed === true && d?.site_id === siteId && d?.netlify_site_id === netlifyId, `${r.status}`);
  const count = (await j(await rest(`presence_sites?client_id=eq.${client.id}&select=id`))).length;
  ok("provision: exactly one site row after rerun", count === 1, String(count));
}

// ═══ FIRST PUBLISH → LIVE WEBSITE (the M6 success criterion) ═══
const HOURS = [
  { day: "mon", closed: true, intervals: [] },
  ...["tue", "wed", "thu", "fri", "sat", "sun"].map((d) => ({ day: d, closed: false, intervals: [{ open: "11:00", close: "21:00" }] })),
];
await rest(`presence_identity?site_id=eq.${siteId}`, { method: "PATCH", body: JSON.stringify({ description: "A diner provisioned, published and verified entirely by the M6 pipeline.", phone: "(323) 555-0166", email: "hi@m6diner.example", tagline: "From admin panel to live site" }) });
await rest(`presence_locations`, { method: "POST", body: JSON.stringify({ site_id: siteId, address_line1: "6 Milestone Ave", city: "Los Angeles", region: "CA", postal_code: "90006", timezone: "America/Los_Angeles", hours: HOURS }) });
await rest(`presence_offerings`, { method: "POST", body: JSON.stringify({ site_id: siteId, name: "Provisioned Pancakes", category: "Breakfast", price_text: "$12", description: "Stacked by the operator." }) });

let firstSnapshotId = null;
{ const t0 = performance.now();
  const r = await call("POST", `/admin/sites/${siteId}/publish`, staffJwt);
  const ms = performance.now() - t0;
  const d = jc(r.text)?.data;
  ok("force publish: staff publish through the ONE pipeline → live", r.status === 200 && d?.status === "live", `${r.status} ${d?.status} (${ms.toFixed(0)}ms)`);
  console.log(`      publish→live duration: ${ms.toFixed(0)}ms`);
  const live = await fetch(`${netlifyUrl}/`);
  const html = await live.text();
  ok("LIVE WEBSITE: real page serves the client's content", live.status === 200 && html.includes("M6 E2E Diner") && html.startsWith("<!DOCTYPE html>"), String(live.status));
  const menu = await fetch(`${netlifyUrl}/menu/`);
  ok("LIVE WEBSITE: menu page live with offerings", menu.status === 200 && (await menu.text()).includes("Provisioned Pancakes"), String(menu.status));
  firstSnapshotId = (await j(await rest(`presence_snapshots?site_id=eq.${siteId}&order=created_at.desc&limit=1&select=id`)))[0]?.id;
}

// ═══ SECOND PUBLISH (changed content) ═══
await rest(`presence_offerings`, { method: "POST", body: JSON.stringify({ site_id: siteId, name: "Second Publish Special", category: "Mains", price_text: "$21" }) });
{ const r = await call("POST", `/admin/sites/${siteId}/publish`, staffJwt);
  ok("second publish → live", r.status === 200 && jc(r.text)?.data?.status === "live", String(r.status));
  const menu = await (await fetch(`${netlifyUrl}/menu/?v=2`, { headers: { "Cache-Control": "no-cache" } })).text();
  ok("live site reflects the change", menu.includes("Second Publish Special"));
}

// ═══ PUBLISH HISTORY + DEPLOY HISTORY (operator views) ═══
{ const r = await call("GET", `/admin/sites/${siteId}/publishes`, staffJwt);
  const rows = jc(r.text)?.data || [];
  ok("admin publish history: full operator records w/ duration + deploy ids", r.status === 200 && rows.length >= 2 && rows[0].netlify_deploy_id && rows[0].duration_seconds !== null, `${rows.length} rows`);
}
let deploysList = [];
{ const r = await call("GET", `/admin/sites/${siteId}/deploys`, staffJwt);
  deploysList = jc(r.text)?.data || [];
  ok("deploy history from host: both deploys visible + ready", r.status === 200 && deploysList.filter((d) => d.state === "ready").length >= 2, `${deploysList.length} deploys`);
}

// ═══ RESTORE SNAPSHOT (business recovery through the pipeline) ═══
{ const r = await call("POST", `/admin/sites/${siteId}/restore-snapshot`, staffJwt, { snapshot_id: firstSnapshotId });
  ok("restore snapshot: operator restore → live", r.status === 200 && jc(r.text)?.data?.status === "live", String(r.status));
  const menu = await (await fetch(`${netlifyUrl}/menu/?v=3`, { headers: { "Cache-Control": "no-cache" } })).text();
  ok("live site rolled back to snapshot-1 content", menu.includes("Provisioned Pancakes") && !menu.includes("Second Publish Special"));
  const r2 = await call("POST", `/admin/sites/${siteId}/restore-snapshot`, staffJwt, { snapshot_id: "00000000-0000-0000-0000-00000000beef" });
  ok("restore snapshot: unknown snapshot → 404", r2.status === 404, String(r2.status));
}

// ═══ RESTORE DEPLOY (instant operational recovery) ═══
{ const v2 = deploysList.find((d) => d.title?.includes("publish") && d.state === "ready"); // newest ready publish deploy = v2
  const r = await call("POST", "/admin/restore-deploy", staffJwt, { site_id: siteId, deploy_id: v2.id });
  ok("restore deploy: instant rollback accepted", r.status === 200, String(r.status));
  await new Promise((z) => setTimeout(z, 4000));
  const menu = await (await fetch(`${netlifyUrl}/menu/?v=4`, { headers: { "Cache-Control": "no-cache" } })).text();
  ok("live site flipped to the restored deploy", menu.includes("Second Publish Special"));
}

// ═══ DOMAIN MANAGEMENT ═══
{ const bad = await call("POST", `/admin/sites/${siteId}/domain`, staffJwt, { domain: "not a domain!" });
  ok("domain: invalid name → 400", bad.status === 400, String(bad.status));
  const r = await call("POST", `/admin/sites/${siteId}/domain`, staffJwt, { domain: "m6-e2e.dapperdigitalstudios.com" });
  const d = jc(r.text)?.data;
  ok("domain: attach → plain-language DNS-pending status", r.status === 200 && d?.health === "dns_pending" && /CNAME/.test(d?.message || "") && d?.dns?.expected_cname?.endsWith(".netlify.app"), `${r.status} ${d?.health}`);
  const g = await call("GET", `/admin/sites/${siteId}/domain`, staffJwt);
  const gd = jc(g.text)?.data;
  ok("domain: status readable (dns + ssl + guidance)", g.status === 200 && gd?.custom_domain === "m6-e2e.dapperdigitalstudios.com" && gd?.ssl !== undefined, gd?.health);
  const del = await call("DELETE", `/admin/sites/${siteId}/domain`, staffJwt);
  ok("domain: remove", del.status === 200, String(del.status));
  const g2 = await call("GET", `/admin/sites/${siteId}/domain`, staffJwt);
  ok("domain: back to netlify subdomain (no_domain)", jc(g2.text)?.data?.health === "no_domain");
}

// ═══ LIFECYCLE ═══
{ const r = await call("POST", `/admin/sites/${siteId}/lifecycle`, staffJwt, { to: "paused" });
  ok("lifecycle: live → paused", r.status === 200, String(r.status));
  const bad = await call("POST", `/admin/sites/${siteId}/lifecycle`, staffJwt, { to: "draft" });
  const bd = jc(bad.text);
  ok("lifecycle: illegal transition fails cleanly with allowed set", bad.status === 409 && bd?.error === "invalid_transition" && Array.isArray(bd?.allowed), `${bad.status} allowed=${JSON.stringify(bd?.allowed)}`);
  const bad2 = await call("POST", `/admin/sites/${siteId}/lifecycle`, staffJwt, { to: "nonsense" });
  ok("lifecycle: unknown state → 400", bad2.status === 400, String(bad2.status));
  // paused site: staff force publish still works (operator judgment)
  const pub = await call("POST", `/admin/sites/${siteId}/publish`, staffJwt);
  ok("lifecycle: paused + staff force publish → allowed, site back to live", pub.status === 200 && jc(pub.text)?.data?.status === "live", String(pub.status));
  // archived blocks ALL publishing
  await call("POST", `/admin/sites/${siteId}/lifecycle`, staffJwt, { to: "archived" });
  const blocked = await call("POST", `/admin/sites/${siteId}/publish`, staffJwt);
  ok("lifecycle: archived blocks publish (409 lifecycle_blocked)", blocked.status === 409 && jc(blocked.text)?.error === "lifecycle_blocked", String(blocked.status));
  const back = await call("POST", `/admin/sites/${siteId}/lifecycle`, staffJwt, { to: "ready" });
  ok("lifecycle: archived → ready (reactivate)", back.status === 200, String(back.status));
}

// ═══ CANCEL QUEUED + RETRY FAILED ═══
{ const snapId = firstSnapshotId;
  await rest(`presence_publishes`, { method: "POST", body: JSON.stringify({ site_id: siteId, snapshot_id: snapId, actor_kind: "system", change_summary: "queued-probe" }) });
  const r = await call("POST", `/admin/sites/${siteId}/cancel`, staffJwt);
  ok("cancel: queued publish canceled", r.status === 200 && jc(r.text)?.data?.canceled === 1, String(r.status));
  const again = await call("POST", `/admin/sites/${siteId}/cancel`, staffJwt);
  ok("cancel: nothing queued → honest 409", again.status === 409, String(again.status));
  const rec = (await j(await rest(`presence_publishes?site_id=eq.${siteId}&status=eq.canceled&select=id&limit=1`)))[0];
  ok("cancel: record status = canceled (gate freed)", !!rec);
}
{ // plant a failed publish pointing at the retained snapshot → retry → live
  const failed = (await j(await rest(`presence_publishes`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ site_id: siteId, snapshot_id: firstSnapshotId, actor_kind: "system", change_summary: "menu tweak that failed" }) })))[0];
  await rest(`presence_publishes?id=eq.${failed.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error_text: "deploy: simulated outage", completed_at: new Date().toISOString() }) });
  const r = await call("POST", `/admin/sites/${siteId}/retry`, staffJwt, {});
  ok("retry: failed publish re-runs the SAME snapshot → live", r.status === 200 && jc(r.text)?.data?.status === "live", String(r.status));
  const hist = jc((await call("GET", `/admin/sites/${siteId}/publishes`, staffJwt)).text)?.data || [];
  ok("retry: history records the retry with provenance summary", hist.some((p) => (p.change_summary || "").startsWith("Retry:")));
}

// ═══ MONITORING (operator health) ═══
{ const t0 = performance.now();
  const r = await call("GET", `/admin/sites/${siteId}/health`, staffJwt);
  const ms = performance.now() - t0;
  const d = jc(r.text)?.data;
  ok("health: hosting connected + url + state", r.status === 200 && d?.hosting?.connected === true && d?.hosting?.url?.includes(".netlify.app"), `${r.status} (${ms.toFixed(0)}ms)`);
  ok("health: publishing block (last, last-success w/ duration + deploy state)", d?.publishing?.last_successful_publish?.duration_seconds !== null && d?.publishing?.last_successful_publish?.current_deploy_state === "ready" && d?.publishing?.in_flight === false, `dur=${d?.publishing?.last_successful_publish?.duration_seconds}s`);
  ok("health: last_error preserved for operators", (d?.publishing?.last_error?.error_text || "").includes("simulated outage"));
  ok("health: content contract + template + draft validation", d?.content?.content_contract_version === 1 && d?.content?.template === "restaurant-classic@1.0.0" && d?.content?.draft?.blockers === 0);
  ok("health: media check (0 missing)", d?.media?.missing?.length === 0);
  ok("health: domain block plain-language", d?.domain?.health === "no_domain");
  console.log(`      health latency: ${ms.toFixed(0)}ms`);
}

// ═══ RECOVERY: hosting disconnected detection + provisioning repair ═══
{ // simulate the disaster: the Netlify site vanishes outside our control.
  // Operator-only path uses the admin surface end to end.
  // (deleting directly via svc on Netlify would need the token — instead use
  // lifecycle deleting on a SECOND site? No: simulate by pointing the site at
  // a bogus netlify id, exactly what "site deleted on the host" looks like.)
  const realId = netlifyId;
  await rest(`presence_sites?id=eq.${siteId}`, { method: "PATCH", body: JSON.stringify({ netlify_site_id: "00000000-dead-beef-0000-000000000000" }) });
  const r = await call("GET", `/admin/sites/${siteId}/health`, staffJwt);
  const d = jc(r.text)?.data;
  ok("recovery: hosting-disconnected DETECTED in health", d?.hosting?.connected === false && /DISCONNECTED/.test(d?.hosting?.message || ""), d?.hosting?.message?.slice(0, 50));
  // provisioning repairs it: dangling id → creates/adopts hosting again
  const rp = await call("POST", "/admin/sites", staffJwt, { client_id: client.id });
  const rd = jc(rp.text)?.data;
  ok("recovery: provisioning rerun REPAIRS hosting (adopts same-name site)", rp.status === 200 && rd?.netlify_site_id === realId, `${rp.status} ${rd?.netlify_site_id === realId ? "same site adopted" : rd?.netlify_site_id}`);
}

// ═══ PROVENANCE: every admin action wrote an event ═══
{ const ev = await j(await rest(`presence_change_events?site_id=eq.${siteId}&entity_type=in.(site,domain)&select=entity_type,action,summary`));
  const kinds = new Set(ev.map((e) => `${e.entity_type}:${e.action}`));
  ok("provenance: site create + lifecycle updates + domain attach/detach all recorded", kinds.has("site:create") && kinds.has("site:update") && kinds.has("domain:create") && kinds.has("domain:delete"), [...kinds].join(","));
}

// ═══ TEARDOWN: archived → deleting removes hosting, keeps history ═══
{ await call("POST", `/admin/sites/${siteId}/lifecycle`, staffJwt, { to: "paused" });
  await call("POST", `/admin/sites/${siteId}/lifecycle`, staffJwt, { to: "archived" });
  const r = await call("POST", `/admin/sites/${siteId}/lifecycle`, staffJwt, { to: "deleting" });
  ok("lifecycle: archived → deleting tears down hosting", r.status === 200, String(r.status));
  const gone = await fetch(`${netlifyUrl}/`, { redirect: "manual" });
  await gone.text();
  ok("teardown: live site no longer served", gone.status === 404, String(gone.status));
  const snaps = (await j(await rest(`presence_snapshots?site_id=eq.${siteId}&select=id`))).length;
  ok("teardown: snapshots RETAINED for business recovery", snaps >= 1, `${snaps} snapshots`);
  const dead = await call("POST", `/admin/sites/${siteId}/publish`, staffJwt);
  ok("teardown: deleting blocks publish", dead.status === 409, String(dead.status));
  const prov = await call("POST", "/admin/sites", staffJwt, { client_id: client.id });
  ok("teardown: re-provision while deleting → honest 409", prov.status === 409, String(prov.status));
}
// rows stay (append-only provenance forbids hard delete); hosting is gone and
// the next run's setup resets the site to pristine draft.

const fails = results.filter((r) => !r.p);
console.log(`\n════ M6 ADMIN/OPS: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) { for (const f of fails) console.log(" FAIL:", f.n); Deno.exit(1); }
