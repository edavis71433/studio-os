// ── Phase 4: enquiry triage — the rules, and the source pins that keep the
// route, the migration and the page on the same vocabulary ──────────────────
const C = await import('../../supabase/functions/presence/lib/commercial.ts');
const R = await import('../../supabase/functions/presence/routes/commercial.ts');
const migration = await Deno.readTextFile(new URL('../../supabase/migrations/0129_enquiry_triage.sql', import.meta.url));
const route = await Deno.readTextFile(new URL('../../supabase/functions/presence/routes/commercial.ts', import.meta.url));
const leads = await Deno.readTextFile(new URL('../../leads.html', import.meta.url));
const workspace = await Deno.readTextFile(new URL('../../supabase/functions/presence/routes/workspace.ts', import.meta.url));
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };

// the nudge resolves on every mark except "still new"
ok('read resolves the follow-up nudge', C.leadFollowupResolvesOn('read'));
ok('replied resolves it', C.leadFollowupResolvesOn('replied'));
ok('not_a_fit resolves it', C.leadFollowupResolvesOn('not_a_fit'));
ok('archived (the old shelf) resolves it', C.leadFollowupResolvesOn('archived'));
ok('new does NOT resolve it', !C.leadFollowupResolvesOn('new'));
ok('converted is system-set and not a user mark here', !C.leadFollowupResolvesOn('converted'));

// the route accepts exactly the user-settable statuses
ok('ENQUIRY_STATUSES = new · read · replied · archived · not_a_fit', JSON.stringify(R.ENQUIRY_STATUSES) === JSON.stringify(['new', 'read', 'replied', 'archived', 'not_a_fit']));
ok('route: a spam flag is written to the boolean column', /patch\.spam = spamFlag/.test(route));
ok('route: marking spam resolves the nudge too', /spamFlag === true/.test(route));
// the migration widens the CHECK to the same set (+ converted)
for (const s of ['new', 'read', 'replied', 'archived', 'not_a_fit', 'converted']) ok(`migration 0129 allows '${s}'`, migration.includes(`'${s}'`));
// counting stays on status=new & spam=false — so every other mark drops off the bell
ok('bell/feed still count status=new & spam=false only', /spam=eq\.false&status=eq\.new/.test(workspace));
// the page offers the marks
ok('leads.html: Not a fit sends not_a_fit', /setStatus\(b\.getAttribute\('data-arch'\),'not_a_fit'\)/.test(leads));
ok('leads.html: Spam sends spam:true', /\{spam:true\}/.test(leads));
ok('leads.html: a reply marks Replied', /setStatus\(id,'replied',true\)/.test(leads));
ok('leads.html: Open hides not_a_fit', /l\.status!=='not_a_fit'/.test(leads));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) { console.log('FAILURES'); failed.forEach((f) => console.log(' -', f)); Deno.exit(1); }
