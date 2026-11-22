// ── "Remind them if it isn't paid?" asked once (sales item 166, Nov 22 2026 review) ──
// Invoice reminders start off for every studio, and nothing ever suggested switching
// them on. The first time a studio sends an invoice with reminders off, the send's
// answer carries ask_reminders: true and the page asks once; the answer, either way,
// sets presence_settings.invoice_reminders_asked (migration 0246). Before the column
// exists the read is refused and nothing is asked. Best-effort: never throws.
import { svc } from './db.ts';

export async function shouldAskReminders(siteId: string): Promise<boolean> {
  try {
    const r = await svc(`presence_settings?site_id=eq.${siteId}&select=invoice_reminders,invoice_reminders_asked&limit=1`);
    if (!r.ok) return false;
    const row = Array.isArray(r.json) ? r.json[0] : null;
    if (!row) return true;   // no settings row yet: reminders are off and nobody has been asked
    return row.invoice_reminders !== true && row.invoice_reminders_asked !== true;
  } catch { return false; }
}
