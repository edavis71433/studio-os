// Builder item 98's tap-target walk borrows this spec's made-up fixtures, copied as they are from tests/e2e/sharing.spec.ts.
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// ── Sharing & access (sharing.html) ──────────────────────────────────────────
// Visual refresh (2026-10): breadcrumb, title + explainer, then (builder list item 53,
// Nov 2026) the People sheet the Sites page shares (people.js): the owner, the studio,
// and the people on their side with a role each, invited by role; then the "What a
// reviewer sees" rows, each a switch with a Visible/Hidden word beside it.
//   GET  /portal/members → { data: [seat…], owner, studio, transfer, transfer_ready, can_transfer }
//   POST /portal/members ← { email, role } · { email, resend: true } · { email, role, restore: true }
//   POST /portal/members/:id/role ← { role } · POST /portal/members/:id/revoke
//   POST /portal/transfer ← { email, keep_owner } · POST /portal/transfer/cancel
//   GET  /portal/shares  → { data: { shares: [{ surface, item_id, shared }] } }
//   POST /portal/shares  ← { surface, shared }
// Defaults: Overview · Analytics · Photos · Visitor and review numbers on; Drafts ·
// Images made for you · Documents · Internal notes (private by default) off.

const ME = { name: 'Sam Reyes', email: 'owner@example.com', signed_in: true, me: true };
const people = (over: Record<string, unknown> = {}) => ({ data: [], owner: ME, studio: null, transfer: null, transfer_ready: true, can_transfer: 'owner', ...over });
const MEMBERS_NONE = people();
const SHARES_NONE = { data: { shares: [] } };
const ON = ['Overview', 'Analytics', 'Photos', 'Visitor and review numbers'];   // item 136: named the way a client says them
const OFF = ['Drafts', 'Images made for you', 'Documents', 'Internal notes'];
const DANA = { id: 'm-1', email: 'dana@example.com', role: 'business_staff', role_words: 'Staff', status: 'active', created_at: '2026-10-14T00:00:00Z', joined: true };
const JO = { id: 'm-2', email: 'jo@example.com', role: 'client_reviewer', role_words: 'Reviewer', status: 'active', created_at: '2026-11-10T00:00:00Z', joined: false };
const GONE = { id: 'm-3', email: 'gone@example.com', role: 'developer', role_words: 'Developer', status: 'revoked', created_at: '2026-09-01T00:00:00Z', joined: false };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const peopleCard = (page: import('@playwright/test').Page) => page.locator('#peopleCard');

export const SHARING_98 = { '/portal/members': people({ data: [DANA, JO] }), '/portal/shares': SHARES_NONE };
