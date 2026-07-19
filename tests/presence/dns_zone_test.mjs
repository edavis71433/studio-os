// ── Managed DNS, slice D1 — pure helpers + behavioral decision table ─────────
//   deno run --allow-read --allow-env --allow-net tests/presence/dns_zone_test.mjs
// Part A unit-tests every pure piece: SigV4 against the OFFICIAL AWS example
// vector, wire conversions, guardrail classes, SPF merge-not-append, the scan
// name list, import filter, the rrset change planner. Part B drives the zone
// routes + applyPlan behaviorally with a globalThis.fetch fake covering the
// Route 53 XML API, DoH, and PostgREST (the inbound_email_test idiom). NO
// live AWS calls, ever — a request that escapes the fake FAILS the run.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// env before imports (module-load reads in db.ts etc.); AWS stays UNSET for now
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.delete('AWS_ACCESS_KEY_ID');
Deno.env.delete('AWS_SECRET_ACCESS_KEY');

const r53 = await import('../../supabase/functions/presence/lib/route53.ts');
const M = await import('../../supabase/functions/presence/platform/managed_dns.ts');
const { dnsFor, guidedDns } = await import('../../supabase/functions/presence/platform/contract.ts');
const Z = await import('../../supabase/functions/presence/routes/zone.ts');
const { applyPlan } = await import('../../supabase/functions/presence/routes/foundations.ts');

// ═══════════════ PART A · pure ═══════════════

// SigV4 — the official AWS documentation example (iam ListUsers / AKIDEXAMPLE)
{
  const parts = await r53.sigv4({
    method: 'GET', path: '/', query: { Action: 'ListUsers', Version: '2010-05-08' },
    headers: { host: 'iam.amazonaws.com', 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', 'x-amz-date': '20150830T123600Z' },
    body: '', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', service: 'iam', amzDate: '20150830T123600Z',
  });
  ok('SigV4: canonical request hash matches the AWS vector', parts.stringToSign.endsWith('f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59'));
  ok('SigV4: string-to-sign scope matches', parts.stringToSign.includes('20150830/us-east-1/iam/aws4_request'));
  ok('SigV4: signature matches the AWS vector exactly', parts.signature === '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  ok('SigV4: Authorization carries credential scope + signed headers', /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/iam\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=/.test(parts.authorization));
}

// xml helpers
ok('xmlText: first match, entity-decoded', r53.xmlText('<a><Name>x &amp; y.</Name></a>', 'Name') === 'x & y.');
ok('xmlText: absent → null', r53.xmlText('<a></a>', 'Nope') === null);
ok('xmlBlocks: all blocks in order', JSON.stringify(r53.xmlBlocks('<NameServer>a</NameServer><NameServer>b</NameServer>', 'NameServer')) === JSON.stringify(['a', 'b']));
ok('xmlEscape round-trips through xmlUnescape', r53.xmlUnescape(r53.xmlEscape('a<b>&"c"')) === 'a<b>&"c"');

// TXT wire form
ok('txtToWire: quoted', M.txtToWire('v=spf1 ~all') === '"v=spf1 ~all"');
ok('txtToWire: 255-char chunking', M.txtToWire('x'.repeat(300)).split('" "').length === 2);
ok('txtToWire: inner quotes escaped', M.txtToWire('a"b') === '"a\\"b"');
ok('txtFromWire: round-trip incl. chunks + quotes', M.txtFromWire(M.txtToWire('a"b' + 'y'.repeat(300))) === 'a"b' + 'y'.repeat(300));

// record ↔ wire value
ok('recordToWireValue: MX carries priority + fqdn', M.recordToWireValue({ type: 'MX', name: 'acme.com', value: 'mail.acme.com', priority: 10 }) === '10 mail.acme.com.');
ok('recordToWireValue: CNAME gets trailing dot', M.recordToWireValue({ type: 'CNAME', name: 'www.acme.com', value: 'acme.netlify.app' }) === 'acme.netlify.app.');
ok('recordToWireValue: A untouched', M.recordToWireValue({ type: 'A', name: 'acme.com', value: '75.2.60.5' }) === '75.2.60.5');
ok('wireValueToRecord: MX parses priority, strips dots', (() => { const r = M.wireValueToRecord('acme.com.', 'MX', 300, '10 mail.acme.com.'); return r.priority === 10 && r.value === 'mail.acme.com' && r.name === 'acme.com'; })());
ok('wireValueToRecord: TXT unquotes', M.wireValueToRecord('acme.com.', 'TXT', 300, '"v=spf1 ~all"').value === 'v=spf1 ~all');

// protected classes
const DOM = 'acme.com';
ok('protected: MX', M.protectedClass({ type: 'MX', name: 'acme.com', value: 'mail.acme.com', priority: 10 }, DOM) === 'mx');
ok('protected: SPF TXT', M.protectedClass({ type: 'TXT', name: 'acme.com', value: 'v=spf1 include:x.com ~all' }, DOM) === 'spf');
ok('protected: DKIM by _domainkey name', M.protectedClass({ type: 'CNAME', name: 'selector1._domainkey.acme.com', value: 'x.onmicrosoft.com' }, DOM) === 'dkim');
ok('protected: DMARC by _dmarc name', M.protectedClass({ type: 'TXT', name: '_dmarc.acme.com', value: 'v=DMARC1; p=none' }, DOM) === 'dmarc');
ok('protected: apex A is a site record', M.protectedClass({ type: 'A', name: 'acme.com', value: '75.2.60.5' }, DOM) === 'site');
ok('protected: www CNAME is a site record', M.protectedClass({ type: 'CNAME', name: 'www.acme.com', value: 'x.netlify.app' }, DOM) === 'site');
ok('protected: _dds-verify TXT is a site record', M.protectedClass({ type: 'TXT', name: '_dds-verify.acme.com', value: 'dds-tok' }, DOM) === 'site');
ok('protected: plain TXT is not protected', M.protectedClass({ type: 'TXT', name: 'acme.com', value: 'hello' }, DOM) === null);
ok('protected: sub-domain A is not protected', M.protectedClass({ type: 'A', name: 'blog.acme.com', value: '1.2.3.4' }, DOM) === null);

// SPF merge — MERGE, never append
ok('mergeSpf: mechanisms union, existing first, deduped', M.mergeSpf('v=spf1 include:a.com ~all', 'v=spf1 include:b.com include:a.com ~all') === 'v=spf1 include:a.com include:b.com ~all');
ok('mergeSpf: exactly one v=spf1 marker', (M.mergeSpf('v=spf1 include:a.com ~all', 'v=spf1 include:b.com ~all').match(/v=spf1/g) || []).length === 1);
ok('mergeSpf: the EXISTING all-qualifier wins (never loosened)', M.mergeSpf('v=spf1 include:a.com -all', 'v=spf1 include:b.com ~all').endsWith('-all'));
ok('mergeSpf: incoming all used when existing lacks one', M.mergeSpf('v=spf1 include:a.com', 'v=spf1 include:b.com -all').endsWith('-all'));
ok('mergeSpf: ip4 mechanisms carried', M.mergeSpf('v=spf1 ip4:1.2.3.4 ~all', 'v=spf1 include:x.com ~all') === 'v=spf1 ip4:1.2.3.4 include:x.com ~all');

// scan name list (spec §2 step 2 — fixed list)
{
  const t = M.scanTargets('Acme.com');
  const names = t.map((x) => x.name);
  ok('scan: apex + www + mail + ftp + autodiscover + _dmarc present', ['acme.com', 'www.acme.com', 'mail.acme.com', 'ftp.acme.com', 'autodiscover.acme.com', '_dmarc.acme.com'].every((n) => names.includes(n)));
  ok('scan: common DKIM selectors present', ['google._domainkey.acme.com', 'default._domainkey.acme.com', 'selector1._domainkey.acme.com', 'selector2._domainkey.acme.com', 'k1._domainkey.acme.com', 'zmail._domainkey.acme.com'].every((n) => names.includes(n)));
  ok('scan: SRV names present', names.includes('_autodiscover._tcp.acme.com') && names.includes('_sip._tls.acme.com'));
  ok('scan: apex queries MX+TXT but never CNAME/NS', (() => { const apex = t.find((x) => x.name === 'acme.com'); return apex.types.includes('MX') && apex.types.includes('TXT') && !apex.types.includes('CNAME') && !apex.types.includes('NS'); })());
  ok('scan: _dds-verify TXT scanned (re-import of the verification record)', names.includes('_dds-verify.acme.com'));
}

// import filter
{
  const scanned = [
    { type: 'NS', name: 'acme.com', value: 'old-ns.example.net' },
    { type: 'CNAME', name: 'acme.com', value: 'flattened.example.net' },
    { type: 'A', name: 'acme.com', value: '9.9.9.9' },
    { type: 'CNAME', name: 'www.acme.com', value: 'old-host.example.net' },
    { type: 'MX', name: 'acme.com', value: 'mail.acme.com', priority: 10 },
    { type: 'TXT', name: 'acme.com', value: 'v=spf1 include:old.com ~all' },
    { type: 'TXT', name: 'acme.com', value: 'v=spf1 include:old.com ~all' },   // dupe
  ];
  const f = M.importFilter(scanned, 'acme.com');
  ok('import: NS never imports', !f.keep.some((r) => r.type === 'NS') && f.dropped.some((r) => r.type === 'NS'));
  ok('import: apex CNAME dropped (invalid in a real zone)', f.dropped.some((r) => r.type === 'CNAME' && r.name === 'acme.com'));
  ok('import: apex A + www CNAME reported as replaced, not kept', f.replaced.length === 2 && !f.keep.some((r) => r.name === 'www.acme.com'));
  ok('import: MX and SPF kept', f.keep.some((r) => r.type === 'MX') && f.keep.some((r) => /v=spf1/.test(r.value)));
  ok('import: duplicates collapse', f.keep.filter((r) => /v=spf1/.test(r.value)).length === 1);
}

// site records
ok('siteRecords: apex A uses the ONE Netlify constant + low cutover TTL', (() => { const s = M.siteRecords('acme.com', 'acme.netlify.app', null); const a = s.find((r) => r.type === 'A'); return a.value === '75.2.60.5' && a.ttl === 300; })());
ok('siteRecords: www CNAME points at the netlify target', M.siteRecords('acme.com', 'acme.netlify.app', null).some((r) => r.type === 'CNAME' && r.value === 'acme.netlify.app'));
ok('siteRecords: verify TXT only when a REAL token exists (never invented)', M.siteRecords('acme.com', null, null).every((r) => !r.name.startsWith('_dds-verify')) && M.siteRecords('acme.com', null, 'dds-tok').some((r) => r.name === '_dds-verify.acme.com' && r.value === 'dds-tok'));

// applyable records (plan apply: placeholders stay guided)
{
  const recs = [
    { type: 'TXT', name: 'acme.com', value: 'v=spf1 include:_spf.google.com ~all', ttl: 3600 },
    { type: 'TXT', name: 'google._domainkey.acme.com', value: 'v=DKIM1; (copy the key from your email provider’s admin panel)', ttl: 3600 },
  ];
  const a = M.applyableRecords(recs);
  ok('applyable: real SPF applies', a.apply.length === 1 && /v=spf1/.test(a.apply[0].value));
  ok('applyable: DKIM placeholder is NEVER written (stays guided)', a.stillGuided.length === 1 && /_domainkey/.test(a.stillGuided[0].name));
}

// the change planner — rrset semantics
{
  const existing = [
    { type: 'A', name: 'acme.com', value: '9.9.9.9', ttl: 300 },
    { type: 'TXT', name: 'acme.com', value: 'v=spf1 include:old.com ~all', ttl: 300 },
    { type: 'TXT', name: 'acme.com', value: 'keep-me', ttl: 300 },
    { type: 'CNAME', name: 'www.acme.com', value: 'old.example.net', ttl: 300 },
  ];
  const plan = M.planUpserts(existing, [
    { type: 'A', name: 'acme.com', value: '75.2.60.5', ttl: 300 },
    { type: 'TXT', name: 'acme.com', value: 'v=spf1 include:_spf.google.com ~all', ttl: 300 },
    { type: 'CNAME', name: 'www.acme.com', value: 'acme.netlify.app', ttl: 300 },
  ]);
  const aSet = plan.changes.find((c) => c.rrset.type === 'A');
  const txtSet = plan.changes.find((c) => c.rrset.type === 'TXT');
  const cnameSet = plan.changes.find((c) => c.rrset.type === 'CNAME');
  ok('planner: A union — existing value PRESERVED, new added (no clobber)', aSet && aSet.rrset.values.length === 2 && aSet.rrset.values.includes('9.9.9.9') && aSet.rrset.values.includes('75.2.60.5'));
  ok('planner: SPF merged into ONE value, second v=spf1 never appended', txtSet && txtSet.rrset.values.filter((v) => v.includes('v=spf1')).length === 1 && txtSet.rrset.values.some((v) => v.includes('include:old.com') && v.includes('include:_spf.google.com')));
  ok('planner: non-SPF TXT values ride along untouched', txtSet.rrset.values.some((v) => v === '"keep-me"'));
  ok('planner: CNAME replaces (singleton)', cnameSet && cnameSet.rrset.values.length === 1 && cnameSet.rrset.values[0] === 'acme.netlify.app.');
  ok('planner: merged SPF reported', plan.merged.length === 1);
  const noop = M.planUpserts(existing, [{ type: 'TXT', name: 'acme.com', value: 'keep-me', ttl: 300 }]);
  ok('planner: already-present value → NO change issued', noop.changes.length === 0);
}
{
  const existing = [
    { type: 'A', name: 'acme.com', value: '1.1.1.1', ttl: 300 },
    { type: 'A', name: 'acme.com', value: '2.2.2.2', ttl: 300 },
    { type: 'TXT', name: 'x.acme.com', value: 'solo', ttl: 300 },
  ];
  const rrsets = [
    { name: 'acme.com.', type: 'A', ttl: 300, values: ['1.1.1.1', '2.2.2.2'] },
    { name: 'x.acme.com.', type: 'TXT', ttl: 300, values: ['"solo"'] },
  ];
  const partial = M.planRemoval(existing, { type: 'A', name: 'acme.com', value: '1.1.1.1' }, rrsets);
  ok('removal: one of two values → UPSERT the remainder', partial.action === 'UPSERT' && partial.rrset.values.length === 1 && partial.rrset.values[0] === '2.2.2.2');
  const last = M.planRemoval(existing, { type: 'TXT', name: 'x.acme.com', value: 'solo' }, rrsets);
  ok('removal: last value → DELETE the rrset', last.action === 'DELETE');
  ok('removal: absent record → null (nothing to do)', M.planRemoval(existing, { type: 'A', name: 'acme.com', value: '8.8.8.8' }, rrsets) === null);
}

// mergeDesired + nsPropagated
ok('mergeDesired: new record appended with its source', M.mergeDesired([], [{ type: 'A', name: 'acme.com', value: '75.2.60.5' }], 'platform')[0].source === 'platform');
ok('mergeDesired: existing entry updated in place, source kept', (() => { const d = M.mergeDesired([{ type: 'A', name: 'acme.com', value: '75.2.60.5', ttl: 3600, source: 'import' }], [{ type: 'A', name: 'acme.com', value: '75.2.60.5', ttl: 300 }], 'user'); return d.length === 1 && d[0].ttl === 300 && d[0].source === 'import'; })());
ok('nsPropagated: any AWS name observed → true', M.nsPropagated(['ns-101.awsdns-01.org', 'old.ns.com'], ['ns-101.awsdns-01.org'], M.BRANDED_NS) === true);
ok('nsPropagated: branded name observed → true', M.nsPropagated(['ns1.davisdigitalstudio.com'], ['ns-101.awsdns-01.org'], M.BRANDED_NS) === true);
ok('nsPropagated: stranger nameservers → false', M.nsPropagated(['ns1.godaddy.com'], ['ns-101.awsdns-01.org'], M.BRANDED_NS) === false);

// ═══════════════ PART B · behavioral (fetch fake) ═══════════════

const SITE = { id: '22222222-2222-4222-8222-222222222222', custom_domain: 'acme.com', netlify_site_id: null, edition: 'studio', status: 'ready' };
const PRINCIPAL = { kind: 'staff', userId: '33333333-3333-4333-8333-333333333333' };
const CORS = {};

// ── the world the fake serves ──
const world = {
  doh: new Map(),            // "name|typecode" -> [{data, TTL}]
  dohFail: new Set(),        // "name|typecode" -> 500
  aws: { calls: [], delegationSets: [], zones: new Map(), nextZone: 1 },
  db: { dnsZones: new Map(), history: [], snapshots: [], writes: [], plans: new Map(), monitorToken: null },
  escaped: [],
};
const AWS_NS = ['ns-101.awsdns-01.org', 'ns-202.awsdns-02.co.uk', 'ns-303.awsdns-03.com', 'ns-404.awsdns-04.net'];
const TYPEC = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, SRV: 33, DS: 43, CAA: 257 };

function xml(status, body) { return new Response(body, { status, headers: { 'content-type': 'text/xml' } }); }
function jres(status, body) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }

function awsRoute(method, u, body) {
  const a = world.aws;
  a.calls.push({ method, path: u.pathname, body });
  const dsXml = (d) => `<DelegationSet><Id>/delegationset/${d.id}</Id><CallerReference>${d.ref}</CallerReference><NameServers>${d.ns.map((n) => `<NameServer>${n}</NameServer>`).join('')}</NameServers></DelegationSet>`;
  if (u.pathname === '/2013-04-01/delegationset' && method === 'GET') {
    return xml(200, `<ListReusableDelegationSetsResponse><DelegationSets>${a.delegationSets.map(dsXml).join('')}</DelegationSets><IsTruncated>false</IsTruncated></ListReusableDelegationSetsResponse>`);
  }
  if (u.pathname === '/2013-04-01/delegationset' && method === 'POST') {
    const ref = /<CallerReference>([^<]+)</.exec(body)?.[1] || '';
    if (a.delegationSets.some((d) => d.ref === ref)) return xml(409, '<ErrorResponse><Error><Code>DelegationSetAlreadyCreated</Code><Message>exists</Message></Error></ErrorResponse>');
    const d = { id: 'N1DELEGATION', ref, ns: AWS_NS };
    a.delegationSets.push(d);
    return xml(201, `<CreateReusableDelegationSetResponse>${dsXml(d)}</CreateReusableDelegationSetResponse>`);
  }
  if (u.pathname === '/2013-04-01/hostedzonesbyname' && method === 'GET') {
    const dnsname = u.searchParams.get('dnsname') || '';
    const hits = [...a.zones.values()].filter((z) => z.name === dnsname);
    return xml(200, `<ListHostedZonesByNameResponse><HostedZones>${hits.map((z) => `<HostedZone><Id>/hostedzone/${z.id}</Id><Name>${z.name}.</Name><ResourceRecordSetCount>${z.rrsets.length}</ResourceRecordSetCount></HostedZone>`).join('')}</HostedZones><IsTruncated>false</IsTruncated></ListHostedZonesByNameResponse>`);
  }
  if (u.pathname === '/2013-04-01/hostedzone' && method === 'POST') {
    const name = (/<Name>([^<]+)</.exec(body)?.[1] || '').replace(/\.$/, '');
    const id = `Z${a.nextZone++}ZONE`;
    const z = { id, name, rrsets: [
      { name: name + '.', type: 'NS', ttl: 172800, values: AWS_NS.map((n) => n + '.') },
      { name: name + '.', type: 'SOA', ttl: 900, values: [`${AWS_NS[0]}. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400`] },
    ] };
    a.zones.set(id, z);
    return xml(201, `<CreateHostedZoneResponse><HostedZone><Id>/hostedzone/${id}</Id><Name>${name}.</Name><ResourceRecordSetCount>2</ResourceRecordSetCount></HostedZone><ChangeInfo><Id>/change/C100</Id><Status>PENDING</Status></ChangeInfo><DelegationSet><NameServers>${AWS_NS.map((n) => `<NameServer>${n}</NameServer>`).join('')}</NameServers></DelegationSet></CreateHostedZoneResponse>`);
  }
  const zoneRr = u.pathname.match(/^\/2013-04-01\/hostedzone\/([^/]+)\/rrset$/);
  if (zoneRr && method === 'GET') {
    const z = a.zones.get(zoneRr[1]);
    if (!z) return xml(404, '<ErrorResponse><Error><Code>NoSuchHostedZone</Code></Error></ErrorResponse>');
    return xml(200, `<ListResourceRecordSetsResponse><ResourceRecordSets>${z.rrsets.map((s) => `<ResourceRecordSet><Name>${s.name}</Name><Type>${s.type}</Type><TTL>${s.ttl}</TTL><ResourceRecords>${s.values.map((v) => `<ResourceRecord><Value>${r53.xmlEscape(v)}</Value></ResourceRecord>`).join('')}</ResourceRecords></ResourceRecordSet>`).join('')}</ResourceRecordSets><IsTruncated>false</IsTruncated></ListResourceRecordSetsResponse>`);
  }
  if (zoneRr && method === 'POST') {
    const z = a.zones.get(zoneRr[1]);
    if (!z) return xml(404, '<ErrorResponse><Error><Code>NoSuchHostedZone</Code></Error></ErrorResponse>');
    for (const chg of body.match(/<Change>[\s\S]*?<\/Change>/g) || []) {
      const action = /<Action>([^<]+)</.exec(chg)?.[1];
      const name = /<Name>([^<]+)</.exec(chg)?.[1];
      const type = /<Type>([^<]+)</.exec(chg)?.[1];
      const ttl = Number(/<TTL>(\d+)</.exec(chg)?.[1] || 300);
      const values = (chg.match(/<Value>[\s\S]*?<\/Value>/g) || []).map((v) => r53.xmlUnescape(v.slice(7, -8)));
      z.rrsets = z.rrsets.filter((s) => !(s.name === name && s.type === type));
      if (action === 'UPSERT') z.rrsets.push({ name, type, ttl, values });
    }
    return xml(200, '<ChangeResourceRecordSetsResponse><ChangeInfo><Id>/change/C200</Id><Status>PENDING</Status></ChangeInfo></ChangeResourceRecordSetsResponse>');
  }
  const zoneDel = u.pathname.match(/^\/2013-04-01\/hostedzone\/([^/]+)$/);
  if (zoneDel && method === 'DELETE') {
    const z = a.zones.get(zoneDel[1]);
    if (!z) return xml(404, '<ErrorResponse><Error><Code>NoSuchHostedZone</Code></Error></ErrorResponse>');
    const extra = z.rrsets.filter((s) => !((s.type === 'NS' || s.type === 'SOA') && s.name === z.name + '.'));
    if (extra.length) return xml(400, '<ErrorResponse><Error><Code>HostedZoneNotEmpty</Code></Error></ErrorResponse>');
    a.zones.delete(zoneDel[1]);
    return xml(200, '<DeleteHostedZoneResponse><ChangeInfo><Id>/change/C300</Id><Status>PENDING</Status></ChangeInfo></DeleteHostedZoneResponse>');
  }
  if (/^\/2013-04-01\/change\//.test(u.pathname)) return xml(200, '<GetChangeResponse><ChangeInfo><Status>INSYNC</Status></ChangeInfo></GetChangeResponse>');
  return xml(400, '<ErrorResponse><Error><Code>UnhandledFakePath</Code></Error></ErrorResponse>');
}

function dbRoute(method, u, body) {
  const path = u.pathname.replace('/rest/v1/', '');
  const parsed = body ? JSON.parse(body) : null;
  world.db.writes.push({ method, path, body: parsed });
  if (path === 'presence_monitor_connections') {
    if (u.search.includes('select=token')) return jres(200, world.db.monitorToken ? [{ token: world.db.monitorToken }] : []);
    return jres(200, []);
  }
  if (path === 'presence_dns_zones') {
    if (method === 'GET') { const doc = world.db.dnsZones.get(u.searchParams.get('site_id')?.replace('eq.', '')); return jres(200, doc ? [doc] : []); }
    if (method === 'POST') { world.db.dnsZones.set(parsed.site_id, parsed); return jres(201, [parsed]); }
  }
  if (path === 'presence_dns_zone_history' && method === 'POST') { world.db.history.push(parsed); return jres(201, []); }
  if (path === 'presence_zone_snapshots' && method === 'POST') { world.db.snapshots.push(parsed); return jres(201, []); }
  if (path === 'presence_infra_plans') {
    const id = u.searchParams.get('id')?.replace('eq.', '');
    const plan = world.db.plans.get(id);
    if (method === 'GET') return jres(200, plan ? [plan] : []);
    if (method === 'PATCH') {
      if (u.search.includes('status=eq.approved')) return jres(200, plan ? [{ id: plan.id }] : []);  // the atomic claim
      if (plan && parsed?.status) plan.status = parsed.status;
      return jres(200, plan ? [plan] : []);
    }
  }
  return jres(method === 'POST' ? 201 : 200, []);
}

globalThis.fetch = (input, _init) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (_init?.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();
  const u = new URL(url);
  const body = typeof _init?.body === 'string' ? _init.body : '';
  if (u.hostname === 'route53.amazonaws.com') return Promise.resolve(awsRoute(method, u, body));
  if (u.hostname === 'cloudflare-dns.com') {
    const key = `${u.searchParams.get('name')}|${u.searchParams.get('type')}`;
    if (world.dohFail.has(key)) return Promise.resolve(jres(500, {}));
    const answers = (world.doh.get(key) || []).map((a) => ({ name: u.searchParams.get('name'), type: Number(u.searchParams.get('type')), TTL: a.TTL ?? 300, data: a.data }));
    return Promise.resolve(jres(200, { Status: 0, Answer: answers }));
  }
  if (u.hostname === 'example.supabase.co') return Promise.resolve(dbRoute(method, u, body));
  world.escaped.push(url);
  return Promise.resolve(jres(500, { error: 'escaped the fake' }));
};

// ── B1: DORMANT + FAIL-CLOSED (no secrets) ──
ok('dormant: contract selects guided when secrets absent', dnsFor() === guidedDns && dnsFor().capabilities.write === 'guided');
ok('dormant: route53Configured() false', r53.route53Configured() === false);
ok('dormant: client op refuses without a network call', await r53.listReusableDelegationSets().then((r) => !r.ok && r.error === 'aws_not_configured'));
{
  const g = await Z.handleZoneGet(SITE, CORS);
  const gj = await g.json();
  ok('dormant: GET /foundations/zone → honest 503', g.status === 503 && gj.error === 'not_configured' && /isn’t switched on yet/.test(gj.message));
  const c = await Z.handleZoneCreate(new Request('http://x/', { method: 'POST', body: '{}' }), SITE, PRINCIPAL, CORS);
  ok('dormant: POST /foundations/zone → honest 503', c.status === 503);
  const d = await Z.handleZoneDelete(new Request('http://x/', { method: 'DELETE', body: '{"confirm":true}' }), SITE, PRINCIPAL, CORS);
  ok('dormant: DELETE /foundations/zone → honest 503', d.status === 503);
  const rr = await Z.handleZoneRecords(new Request('http://x/', { method: 'POST', body: '{}' }), 'POST', SITE, PRINCIPAL, CORS);
  ok('dormant: record CRUD → honest 503', rr.status === 503);
  ok('dormant: ZERO AWS calls were made', world.aws.calls.length === 0);
}

// ── switch the secrets on (call-time reads pick this up immediately) ──
Deno.env.set('AWS_ACCESS_KEY_ID', 'AKIDTEST');
Deno.env.set('AWS_SECRET_ACCESS_KEY', 'secret');
Deno.env.set('AWS_REGION', 'us-east-1');
ok('live: contract selects the automatic adapter once secrets exist', dnsFor().slug === 'route53' && dnsFor().capabilities.write === 'automatic');

// ── B2: DS pre-flight ──
world.doh.set('acme.com|43', [{ data: '12345 13 2 ABCDEF' }]);
ok('DS check: present', await M.checkDs('acme.com') === 'present');
{
  const c = await Z.handleZoneCreate(new Request('http://x/', { method: 'POST', body: '{}' }), SITE, PRINCIPAL, CORS);
  const cj = await c.json();
  ok('create: DNSSEC DS present → 409 with registrar guidance, zone NOT created', c.status === 409 && cj.error === 'dnssec_active' && /Turn DNSSEC off/.test(cj.message) && world.aws.zones.size === 0);
}
world.dohFail.add('acme.com|43');
world.doh.delete('acme.com|43');
ok('DS check: failed probe → unknown (never claims safe)', await M.checkDs('acme.com') === 'unknown');
{
  const c = await Z.handleZoneCreate(new Request('http://x/', { method: 'POST', body: '{}' }), SITE, PRINCIPAL, CORS);
  ok('create: failed DS probe → refuses (502), nothing done', c.status === 502 && (await c.json()).error === 'dnssec_unverified');
}
world.dohFail.delete('acme.com|43');
ok('DS check: absent', await M.checkDs('acme.com') === 'absent');

// ── B3: zone creation — scan, import, site records, write-through ──
world.doh.set('acme.com|15', [{ data: '10 mail.oldhost.com.' }]);
world.doh.set('acme.com|16', [{ data: '"v=spf1 include:oldhost.com ~all"' }]);
world.doh.set('acme.com|1', [{ data: '9.9.9.9' }]);
world.doh.set('www.acme.com|5', [{ data: 'oldweb.example.net.' }]);
world.db.monitorToken = 'dds-veriftoken123';
{
  const c = await Z.handleZoneCreate(new Request('http://x/', { method: 'POST', body: '{}' }), SITE, PRINCIPAL, CORS);
  const cj = await c.json();
  ok('create: 201 with the delegation-set nameservers', c.status === 201 && JSON.stringify(cj.data.nameservers) === JSON.stringify(AWS_NS));
  ok('create: delegation set created exactly once, fixed caller ref', world.aws.delegationSets.length === 1 && world.aws.delegationSets[0].ref === r53.DELEGATION_SET_CALLER_REF);
  ok('create: MX + SPF imported; old apex A replaced (reported)', cj.data.imported.some((r) => r.type === 'MX') && cj.data.imported.some((r) => /v=spf1/.test(r.value)) && cj.data.replaced_by_site_records.some((r) => r.value === '9.9.9.9'));
  ok('create: site records placed (apex A + www CNAME + verify TXT)', cj.data.placed.length === 3 && cj.data.placed.some((r) => r.value === '75.2.60.5') && cj.data.placed.some((r) => r.name === '_dds-verify.acme.com'));
  const z = [...world.aws.zones.values()][0];
  ok('create: the zone actually contains imported MX + placed A', z.rrsets.some((s) => s.type === 'MX' && s.values[0] === '10 mail.oldhost.com.') && z.rrsets.some((s) => s.type === 'A' && s.values.includes('75.2.60.5')));
  ok('create: pre-migration snapshot taken', world.db.snapshots.length >= 1 && world.db.snapshots[0].domain === 'acme.com');
  ok('create: desired-zone doc written through with sources', (() => { const d = world.db.dnsZones.get(SITE.id); return d && d.records.some((r) => r.source === 'import') && d.records.some((r) => r.source === 'platform'); })());
  ok('create: zone history appended', world.db.history.length >= 1);
  const c2 = await Z.handleZoneCreate(new Request('http://x/', { method: 'POST', body: '{}' }), SITE, PRINCIPAL, CORS);
  const cj2 = await c2.json();
  ok('create: idempotent — existing zone reused, not duplicated', c2.status === 201 && cj2.data.created === false && world.aws.zones.size === 1);
}

// ── B4: GET status — NS propagation + state machine ──
world.doh.set('acme.com|2', [{ data: 'ns1.godaddy.com.' }]);
{
  const g = await Z.handleZoneGet(SITE, CORS);
  const gj = await g.json();
  ok('status: ns_pending while the registrar still points elsewhere', g.status === 200 && gj.data.zone.status === 'ns_pending' && gj.data.zone.ns.propagated === false);
  ok('status: platform section carries delegation set + glue map', gj.data.platform.available && gj.data.platform.delegation_set_id === 'N1DELEGATION' && gj.data.platform.glue.length === 4 && gj.data.platform.glue[0].host === 'ns1.davisdigitalstudio.com');
  ok('status: records carry managed flags + protection classes', gj.data.zone.records.some((r) => r.managed && r.protected === 'mx'));
}
world.doh.set('acme.com|2', [{ data: 'ns-101.awsdns-01.org.' }]);
{
  const g = await Z.handleZoneGet(SITE, CORS);
  const gj = await g.json();
  ok('status: NS detected → live (no hosting attached, so no ssl leg)', gj.data.zone.status === 'live' && gj.data.zone.ns.propagated === true);
}

// ── B5: record CRUD guardrails ──
{
  const post = (bodyObj) => Z.handleZoneRecords(new Request('http://x/', { method: 'POST', body: JSON.stringify(bodyObj) }), 'POST', SITE, PRINCIPAL, CORS);
  const noConfirm = await post({ record: { type: 'MX', name: 'acme.com', value: 'smtp.google.com', priority: 1 } });
  ok('CRUD: protected class without confirm → 409 confirm_required', noConfirm.status === 409 && (await noConfirm.json()).error === 'confirm_required');
  const confirmed = await post({ record: { type: 'MX', name: 'acme.com', value: 'smtp.google.com', priority: 1 }, confirm: true });
  ok('CRUD: protected class WITH confirm → applied', confirmed.status === 200);
  const unprotected = await post({ record: { type: 'TXT', name: 'note.acme.com', value: 'hello' } });
  ok('CRUD: unprotected record needs no confirm', unprotected.status === 200);
  const invalid = await post({ record: { type: 'A', name: 'acme.com', value: 'not-an-ip' }, confirm: true });
  ok('CRUD: invalid record → 400 validation, nothing changed', invalid.status === 400);
  const spf = await post({ record: { type: 'TXT', name: 'acme.com', value: 'v=spf1 include:_spf.google.com ~all' }, confirm: true });
  const spfJ = await spf.json();
  const z = [...world.aws.zones.values()][0];
  const spfValues = z.rrsets.filter((s) => s.type === 'TXT' && s.name === 'acme.com.').flatMap((s) => s.values).filter((v) => v.includes('v=spf1'));
  ok('CRUD: SPF MERGED — one v=spf1 in the zone carrying both includes', spfJ.data.spf_merged === true && spfValues.length === 1 && spfValues[0].includes('include:oldhost.com') && spfValues[0].includes('include:_spf.google.com'));
  const del = (bodyObj) => Z.handleZoneRecords(new Request('http://x/', { method: 'DELETE', body: JSON.stringify(bodyObj) }), 'DELETE', SITE, PRINCIPAL, CORS);
  const delImported = await del({ record: { type: 'MX', name: 'acme.com', value: 'mail.oldhost.com', priority: 10 } });
  ok('CRUD: deleting a SCAN-IMPORTED record without confirm → refused', delImported.status === 409);
  const delMissing = await del({ record: { type: 'TXT', name: 'ghost.acme.com', value: 'nope' }, confirm: true });
  ok('CRUD: deleting an absent record → honest 404', delMissing.status === 404);
  const delOk = await del({ record: { type: 'TXT', name: 'note.acme.com', value: 'hello' } });
  ok('CRUD: unprotected delete lands', delOk.status === 200 && !z.rrsets.some((s) => s.name === 'note.acme.com.'));
}

// ── B6: applyPlan wiring — approved DNS plans APPLY through the adapter ──
{
  const PLAN_ID = '44444444-4444-4444-8444-444444444444';
  world.db.plans.set(PLAN_ID, {
    id: PLAN_ID, kind: 'email_auth', title: 'Protect email sent from @acme.com', status: 'approved',
    steps: [
      { what: 'Add the SPF and DMARC records at your DNS host', why: 'x', automated: false, done: false,
        records: [
          { type: 'TXT', name: 'acme.com', value: 'v=spf1 include:_spf.google.com ~all', ttl: 3600 },
          { type: 'TXT', name: '_dmarc.acme.com', value: 'v=DMARC1; p=none; rua=mailto:postmaster@acme.com', ttl: 3600 },
        ] },
      { what: 'Copy the DKIM record from your email provider’s admin panel, then add it', why: 'x', automated: false, done: false,
        records: [{ type: 'TXT', name: 'google._domainkey.acme.com', value: 'v=DKIM1; (copy the key from your email provider’s admin panel)', ttl: 3600 }] },
      { what: 'The platform re-checks the records and confirms alignment', why: 'x', automated: true, done: false },
    ],
  });
  const r = await applyPlan(SITE, PLAN_ID, PRINCIPAL, CORS);
  const rj = await r.json();
  const z = [...world.aws.zones.values()][0];
  ok('applyPlan: approved DNS plan applies through managed DNS', r.status === 200 && rj.data.status === 'applied' && rj.data.notes.some((n) => /through managed DNS/.test(n)));
  ok('applyPlan: DMARC record actually landed in the zone', z.rrsets.some((s) => s.name === '_dmarc.acme.com.' && s.values[0].includes('v=DMARC1')));
  ok('applyPlan: DKIM placeholder was NOT written (stays guided)', !z.rrsets.some((s) => s.name === 'google._domainkey.acme.com.') && rj.data.notes.some((n) => /guided/.test(n)));
  ok('applyPlan: write-through into the desired doc (drift machinery fed)', (() => { const d = world.db.dnsZones.get(SITE.id); return d && d.records.some((x) => x.name === '_dmarc.acme.com'); })());
}

// ── B7: detach ──
{
  const noConfirm = await Z.handleZoneDelete(new Request('http://x/', { method: 'DELETE', body: '{}' }), SITE, PRINCIPAL, CORS);
  ok('detach: without confirm → 400 with the point-NS-away warning', noConfirm.status === 400 && /confirm/.test((await noConfirm.json()).error));
  const snapshotsBefore = world.db.snapshots.length;
  const d = await Z.handleZoneDelete(new Request('http://x/', { method: 'DELETE', body: '{"confirm":true}' }), SITE, PRINCIPAL, CORS);
  const dj = await d.json();
  ok('detach: confirmed → zone emptied + deleted, snapshot kept', d.status === 200 && dj.data.deleted === true && world.aws.zones.size === 0 && world.db.snapshots.length === snapshotsBefore + 1);
  const after = await Z.handleZoneDelete(new Request('http://x/', { method: 'DELETE', body: '{"confirm":true}' }), SITE, PRINCIPAL, CORS);
  ok('detach: repeat → honest 404 (already guided mode)', after.status === 404);
}

ok('behavioral: NO request ever escaped the fake (no live AWS)', world.escaped.length === 0, world.escaped.join(', '));

// ── B8: registration pins (index.ts + the untouched guided surface) ──
{
  const idx = await Deno.readTextFile(new URL('../../supabase/functions/presence/index.ts', import.meta.url));
  ok('pin: GET /foundations/zone registered', /route === '\/foundations\/zone' && method === 'GET'.*handleZoneGet/.test(idx.replace(/\n/g, ' ')) || idx.includes("if (route === '/foundations/zone' && method === 'GET') return handleZoneGet(site, cors);"));
  ok('pin: POST /foundations/zone registered', idx.includes("if (route === '/foundations/zone' && method === 'POST') return handleZoneCreate(req, site, principal, cors);"));
  ok('pin: DELETE /foundations/zone registered', idx.includes("if (route === '/foundations/zone' && method === 'DELETE') return handleZoneDelete(req, site, principal, cors);"));
  ok('pin: /foundations/zone/records registered for POST/PUT/DELETE', idx.includes("route === '/foundations/zone/records'") && idx.includes('handleZoneRecords(req, method, site, principal, cors)'));
  // the shipped guided surface stays EXACTLY as it was
  ok('pin: guided /foundations/dns GET untouched', idx.includes("if (route === '/foundations/dns' && method === 'GET') return handleDnsGet(jwt, site, cors);"));
  ok('pin: guided /foundations/dns PUT untouched', idx.includes("if (route === '/foundations/dns' && method === 'PUT') return handleDnsPut(req, site, principal, cors);"));
  ok('pin: /foundations/dns/rollback untouched', idx.includes("if (route === '/foundations/dns/rollback' && method === 'POST') return handleDnsRollback(req, site, principal, cors);"));
  ok('pin: /foundations GET untouched', idx.includes("if (route === '/foundations' && method === 'GET') return handleFoundationsGet(site, cors);"));
  ok('pin: /foundations/prepare untouched', idx.includes("if (route === '/foundations/prepare' && method === 'POST') return handleFoundationsPrepare(req, site, principal, cors);"));
}

// ═══ summary ═══
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
