// ── AWS Route 53 client (DNS one-stop shop, slice D1) ───────────────────────
// SigV4-signed calls to the Route 53 XML API from Deno — WebCrypto only, no
// dependencies (the repo vendors everything). This is the write-capable DNS
// backbone behind the platform contract's 'automatic' adapter slot
// (platform/contract.ts): reusable delegation set (branded nameservers),
// hosted-zone lifecycle, batched record changes, change polling.
//
// DORMANT + FAIL-CLOSED (the slice-6 Resend pattern): every operation checks
// the secrets at CALL TIME (never at module load) and returns an honest
// failure when AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are absent. Routes
// translate that to a 503 — nothing above ever half-works.
//
// Route 53 is a GLOBAL service: the endpoint is route53.amazonaws.com and
// SigV4 signing always uses region us-east-1 (an AWS rule, not a choice).
// AWS_REGION is still accepted as a secret for future regional services.

/* ── env (call-time reads so dormancy is testable and deploy-order safe) ── */
const env = (k: string): string => { try { return Deno.env.get(k) || ''; } catch { return ''; } };
export function route53Configured(): boolean {
  return !!(env('AWS_ACCESS_KEY_ID') && env('AWS_SECRET_ACCESS_KEY'));
}

const R53_HOST = 'route53.amazonaws.com';
const R53_VERSION = '2013-04-01';
const SIGNING_REGION = 'us-east-1';   // global-service rule (see header note)
const NOT_CONFIGURED = 'aws_not_configured';

/* ═══ SigV4 (pure given its inputs; exported for the known-vector test) ═══ */

const encoder = new TextEncoder();

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, encoder.encode(data) as unknown as ArrayBuffer);
}

/** AWS-style URI encoding (RFC 3986: encode everything except unreserved). */
const awsEncode = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export interface Sigv4Input {
  method: string;
  path: string;                          // already-canonical path (each segment URI-safe)
  query: Record<string, string>;
  headers: Record<string, string>;       // MUST include host; all provided headers are signed
  body: string;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  amzDate: string;                       // 20150830T123600Z
}
export interface Sigv4Parts {
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  authorization: string;
}

/** The full SigV4 derivation, exposed piecewise so tests can pin the official
 *  AWS example vector (iam ListUsers / AKIDEXAMPLE) end to end. */
export async function sigv4(input: Sigv4Input): Promise<Sigv4Parts> {
  const dateStamp = input.amzDate.slice(0, 8);
  const canonicalQuery = Object.keys(input.query).sort()
    .map((k) => `${awsEncode(k)}=${awsEncode(input.query[k])}`).join('&');
  const headerNames = Object.keys(input.headers).map((h) => h.toLowerCase()).sort();
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) lower[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const canonicalHeaders = headerNames.map((h) => `${h}:${lower[h]}\n`).join('');
  const signedHeaders = headerNames.join(';');
  const canonicalRequest = [
    input.method.toUpperCase(), input.path || '/', canonicalQuery,
    canonicalHeaders, signedHeaders, await sha256Hex(input.body),
  ].join('\n');
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  let key: ArrayBuffer = (encoder.encode('AWS4' + input.secretKey) as Uint8Array).buffer as ArrayBuffer;
  for (const part of [dateStamp, input.region, input.service, 'aws4_request']) key = await hmac(new Uint8Array(key), part);
  const signature = [...new Uint8Array(await hmac(new Uint8Array(key), stringToSign))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { canonicalRequest, stringToSign, signature, authorization };
}

const amzNow = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/* ═══ tiny XML helpers (regex-scoped to AWS's known response shapes) ═══ */

export const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const xmlUnescape = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** First <tag>…</tag> text inside `body` (non-greedy; no nesting of same tag in AWS shapes we read). */
export function xmlText(body: string, tag: string): string | null {
  const m = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? xmlUnescape(m[1]) : null;
}
/** Every <tag>…</tag> block (outer content returned raw for nested parsing). */
export function xmlBlocks(body: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

/* ═══ the signed request (fenced; never throws) ═══ */

interface R53Response { ok: boolean; status: number; body: string; error?: string }

async function r53(method: string, path: string, query: Record<string, string> = {}, xmlBody = ''): Promise<R53Response> {
  if (!route53Configured()) return { ok: false, status: 0, body: '', error: NOT_CONFIGURED };
  try {
    const amzDate = amzNow();
    const headers: Record<string, string> = { host: R53_HOST, 'x-amz-date': amzDate };
    if (xmlBody) headers['content-type'] = 'text/xml; charset=utf-8';
    const signed = await sigv4({
      method, path, query, headers, body: xmlBody,
      accessKey: env('AWS_ACCESS_KEY_ID'), secretKey: env('AWS_SECRET_ACCESS_KEY'),
      region: SIGNING_REGION, service: 'route53', amzDate,
    });
    const qs = Object.keys(query).length
      ? '?' + Object.keys(query).sort().map((k) => `${awsEncode(k)}=${awsEncode(query[k])}`).join('&') : '';
    const { host: _h, ...sendHeaders } = headers;  // fetch sets Host itself
    const r = await fetch(`https://${R53_HOST}${path}${qs}`, {
      method, headers: { ...sendHeaders, Authorization: signed.authorization },
      body: xmlBody || undefined, signal: AbortSignal.timeout(10000),
    });
    const body = await r.text();
    if (!r.ok) {
      const code = xmlText(body, 'Code') || `http_${r.status}`;
      const msg = xmlText(body, 'Message') || '';
      return { ok: false, status: r.status, body, error: `${code}${msg ? ': ' + msg.slice(0, 200) : ''}` };
    }
    return { ok: true, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: `network: ${String((e as Error)?.message || e).slice(0, 160)}` };
  }
}

/* ═══ operations ═══ */

export interface DelegationSet { id: string; callerReference: string; nameservers: string[] }
const stripId = (id: string): string => id.replace(/^\/(delegationset|hostedzone|change)\//, '');

function parseDelegationSet(block: string): DelegationSet {
  return {
    id: stripId(xmlText(block, 'Id') || ''),
    callerReference: xmlText(block, 'CallerReference') || '',
    nameservers: xmlBlocks(block, 'NameServer').map(xmlUnescape),
  };
}

export async function listReusableDelegationSets(): Promise<{ ok: boolean; sets: DelegationSet[]; error?: string }> {
  const r = await r53('GET', `/${R53_VERSION}/delegationset`, { maxitems: '100' });
  if (!r.ok) return { ok: false, sets: [], error: r.error };
  return { ok: true, sets: xmlBlocks(r.body, 'DelegationSet').map(parseDelegationSet) };
}

/** The ONE platform delegation set. Zero-storage idempotency: the fixed caller
 *  reference is the identity — list first, create only when absent, re-list on
 *  a create race (DelegationSetAlreadyCreated). Created ONCE, ever. */
export const DELEGATION_SET_CALLER_REF = 'studio-os-dds-delegation-v1';
export async function getOrCreateDelegationSet(): Promise<{ ok: boolean; set?: DelegationSet; error?: string }> {
  const list = await listReusableDelegationSets();
  if (!list.ok) return { ok: false, error: list.error };
  const existing = list.sets.find((s) => s.callerReference === DELEGATION_SET_CALLER_REF) || list.sets[0];
  if (existing) return { ok: true, set: existing };
  const xml = `<?xml version="1.0" encoding="UTF-8"?><CreateReusableDelegationSetRequest xmlns="https://route53.amazonaws.com/doc/${R53_VERSION}/"><CallerReference>${xmlEscape(DELEGATION_SET_CALLER_REF)}</CallerReference></CreateReusableDelegationSetRequest>`;
  const r = await r53('POST', `/${R53_VERSION}/delegationset`, {}, xml);
  if (r.ok) return { ok: true, set: parseDelegationSet(xmlBlocks(r.body, 'DelegationSet')[0] || r.body) };
  if (/DelegationSetAlreadyCreated|DelegationSetAlreadyReusable/.test(r.error || '')) {
    const again = await listReusableDelegationSets();
    const set = again.sets.find((s) => s.callerReference === DELEGATION_SET_CALLER_REF) || again.sets[0];
    if (set) return { ok: true, set };
  }
  return { ok: false, error: r.error };
}

export async function getReusableDelegationSet(id: string): Promise<{ ok: boolean; set?: DelegationSet; error?: string }> {
  const r = await r53('GET', `/${R53_VERSION}/delegationset/${encodeURIComponent(stripId(id))}`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, set: parseDelegationSet(r.body) };
}

export interface HostedZone { id: string; name: string; recordCount: number }

/** Find the hosted zone for an exact domain (zero-storage idempotency — the
 *  zone id is DERIVED from the domain on every use, never persisted). */
export async function findHostedZone(domain: string): Promise<{ ok: boolean; zone: HostedZone | null; error?: string }> {
  const dnsname = domain.toLowerCase().replace(/\.$/, '');
  const r = await r53('GET', `/${R53_VERSION}/hostedzonesbyname`, { dnsname, maxitems: '1' });
  if (!r.ok) return { ok: false, zone: null, error: r.error };
  const block = xmlBlocks(r.body, 'HostedZone')[0];
  if (!block) return { ok: true, zone: null };
  const name = (xmlText(block, 'Name') || '').replace(/\.$/, '');
  if (name.toLowerCase() !== dnsname) return { ok: true, zone: null };
  return { ok: true, zone: {
    id: stripId(xmlText(block, 'Id') || ''), name,
    recordCount: Number(xmlText(block, 'ResourceRecordSetCount') || 0),
  } };
}

export async function createHostedZone(domain: string, delegationSetId: string, callerReference: string):
  Promise<{ ok: boolean; zone?: HostedZone; nameservers?: string[]; changeId?: string; error?: string }> {
  const name = domain.toLowerCase().replace(/\.$/, '') + '.';
  const xml = `<?xml version="1.0" encoding="UTF-8"?><CreateHostedZoneRequest xmlns="https://route53.amazonaws.com/doc/${R53_VERSION}/"><Name>${xmlEscape(name)}</Name><CallerReference>${xmlEscape(callerReference)}</CallerReference><HostedZoneConfig><Comment>Managed by Studio OS</Comment></HostedZoneConfig><DelegationSetId>${xmlEscape(stripId(delegationSetId))}</DelegationSetId></CreateHostedZoneRequest>`;
  const r = await r53('POST', `/${R53_VERSION}/hostedzone`, {}, xml);
  if (!r.ok) return { ok: false, error: r.error };
  const zoneBlock = xmlBlocks(r.body, 'HostedZone')[0] || '';
  return {
    ok: true,
    zone: { id: stripId(xmlText(zoneBlock, 'Id') || ''), name: (xmlText(zoneBlock, 'Name') || '').replace(/\.$/, ''), recordCount: Number(xmlText(zoneBlock, 'ResourceRecordSetCount') || 2) },
    nameservers: xmlBlocks(r.body, 'NameServer').map(xmlUnescape),
    changeId: stripId(xmlText(xmlBlocks(r.body, 'ChangeInfo')[0] || '', 'Id') || ''),
  };
}

export async function deleteHostedZone(zoneId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await r53('DELETE', `/${R53_VERSION}/hostedzone/${encodeURIComponent(stripId(zoneId))}`);
  // NoSuchHostedZone counts as done — the zone is already gone
  return r.ok || /NoSuchHostedZone/.test(r.error || '') ? { ok: true } : { ok: false, error: r.error };
}

/** One Route 53 record set: a (name, type) with ALL its values. Changes are
 *  rrset-granular — an UPSERT replaces the whole set, so callers always send
 *  the complete desired value list (the adapter layer builds that). */
export interface Rrset { name: string; type: string; ttl: number; values: string[] }
export interface RrsetChange { action: 'UPSERT' | 'DELETE'; rrset: Rrset }

export async function listRrsets(zoneId: string): Promise<{ ok: boolean; rrsets: Rrset[]; error?: string }> {
  const out: Rrset[] = [];
  let query: Record<string, string> = { maxitems: '300' };
  for (let page = 0; page < 20; page++) {
    const r = await r53('GET', `/${R53_VERSION}/hostedzone/${encodeURIComponent(stripId(zoneId))}/rrset`, query);
    if (!r.ok) return { ok: false, rrsets: [], error: r.error };
    for (const block of xmlBlocks(r.body, 'ResourceRecordSet')) {
      out.push({
        name: xmlText(block, 'Name') || '', type: xmlText(block, 'Type') || '',
        ttl: Number(xmlText(block, 'TTL') || 300),
        values: xmlBlocks(block, 'ResourceRecord').map((rr) => xmlText(rr, 'Value') || ''),
      });
    }
    if (xmlText(r.body, 'IsTruncated') !== 'true') return { ok: true, rrsets: out };
    query = { maxitems: '300', name: xmlText(r.body, 'NextRecordName') || '', type: xmlText(r.body, 'NextRecordType') || '' };
  }
  return { ok: true, rrsets: out };  // bounded: 6000 records is beyond any customer zone
}

export function changeBatchXml(changes: RrsetChange[], comment: string): string {
  const body = changes.map((c) => `<Change><Action>${c.action}</Action><ResourceRecordSet><Name>${xmlEscape(c.rrset.name)}</Name><Type>${xmlEscape(c.rrset.type)}</Type><TTL>${Math.max(60, Math.round(c.rrset.ttl || 300))}</TTL><ResourceRecords>${c.rrset.values.map((v) => `<ResourceRecord><Value>${xmlEscape(v)}</Value></ResourceRecord>`).join('')}</ResourceRecords></ResourceRecordSet></Change>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/${R53_VERSION}/"><ChangeBatch><Comment>${xmlEscape(comment.slice(0, 250))}</Comment><Changes>${body}</Changes></ChangeBatch></ChangeResourceRecordSetsRequest>`;
}

export async function changeRrsets(zoneId: string, changes: RrsetChange[], comment = 'Studio OS'): Promise<{ ok: boolean; changeId?: string; error?: string }> {
  if (!changes.length) return { ok: true, changeId: '' };
  const r = await r53('POST', `/${R53_VERSION}/hostedzone/${encodeURIComponent(stripId(zoneId))}/rrset`, {}, changeBatchXml(changes, comment));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, changeId: stripId(xmlText(r.body, 'Id') || '') };
}

export async function getChange(changeId: string): Promise<{ ok: boolean; status?: 'PENDING' | 'INSYNC'; error?: string }> {
  const r = await r53('GET', `/${R53_VERSION}/change/${encodeURIComponent(stripId(changeId))}`);
  if (!r.ok) return { ok: false, error: r.error };
  const s = xmlText(r.body, 'Status');
  return { ok: true, status: s === 'INSYNC' ? 'INSYNC' : 'PENDING' };
}
