// Sales item 106, the to-do half of its pipeline template: a deal's to-dos saved as a
// named list, then added to another deal in one go, each due as many days after it is
// added as it was on the deal it came from. The to-dos it makes are plain deal to-dos.
//   deno run --allow-read --allow-env tests/presence/todo_templates_test.mjs
import { todoListFromTasks, savedTodoLists, todosFromList, todoListSummary, MAX_TODO_LISTS, MAX_TODO_LIST_ITEMS } from '../../supabase/functions/presence/lib/todo_templates.ts';
import { RESERVED_NAMES } from '../../supabase/functions/presence/lib/reserved_store.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const ID = '11111111-2222-4333-8444-555555555555';

// ═══ 1. a deal's to-dos become a list ═══
{
  const list = todoListFromTasks({ id: ID, name: 'Website kickoff', now: '2026-11-11T12:00:00Z', tasks: [
    { title: 'Book the kickoff call', due_date: '2026-11-15', created_at: '2026-11-10T09:00:00Z' },
    { title: 'Send the contract', due_date: '2026-11-03', created_at: '2026-11-01T09:00:00Z' },
    { title: 'Collect the logins', due_date: null, created_at: '2026-11-02T09:00:00Z' },
    { title: 'An old one', due_date: '2026-11-04', created_at: '2026-11-02T10:00:00Z', deleted_at: '2026-11-05T00:00:00Z' },
    { title: '   ', due_date: null, created_at: '2026-11-03T00:00:00Z' },
    { title: 'Late on purpose', due_date: '2026-10-01', created_at: '2026-11-04T00:00:00Z' },
  ] });
  ok('in the order they were added; removed and blank ones left out', list.items.map((i) => i.title).join(' | ') === 'Send the contract | Collect the logins | Late on purpose | Book the kickoff call', list.items.map((i) => i.title).join(' | '));
  ok('each due as many days after it was added; no date stays none', JSON.stringify(list.items.map((i) => i.days)) === JSON.stringify([2, null, 0, 5]), JSON.stringify(list.items.map((i) => i.days)));
  ok('the list keeps its name, id and when it was saved', list.name === 'Website kickoff' && list.id === ID && list.created_at === '2026-11-11T12:00:00Z');
  const many = todoListFromTasks({ id: ID, name: 'Big', now: '', tasks: Array.from({ length: 40 }, (_, i) => ({ title: 'Step ' + i, created_at: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T00:00:${String(i).padStart(2, '0')}Z` })) });
  ok(`at most ${MAX_TODO_LIST_ITEMS} to-dos in a list`, many.items.length === MAX_TODO_LIST_ITEMS);
  ok('titles are cleaned and capped', todoListFromTasks({ id: ID, name: 'x', now: '', tasks: [{ title: 'Call\n\tthem   back' + 'x'.repeat(300), created_at: '2026-11-01T00:00:00Z' }] }).items[0].title.startsWith('Call them back') && todoListFromTasks({ id: ID, name: 'x', now: '', tasks: [{ title: 'y'.repeat(300) }] }).items[0].title.length === 200);
}

// ═══ 2. what the stored row holds is checked on the way out ═══
{
  const good = { id: ID, name: 'Website kickoff', items: [{ title: 'Send the contract', days: 2 }, { title: 'Collect the logins', days: null }], created_at: '2026-11-11T00:00:00Z' };
  ok('a good list reads back as saved', JSON.stringify(savedTodoLists([good])) === JSON.stringify([good]));
  const bad = [null, 'x', { id: 'not-a-uuid', name: 'A', items: [{ title: 'a' }] }, { id: ID, name: '', items: [{ title: 'a' }] }, { id: ID, name: 'Empty', items: [] }, { id: ID, name: 'Junk', items: [null, { title: '' }] }];
  ok('anything malformed is dropped, never thrown', savedTodoLists(bad).length === 0 && savedTodoLists(null).length === 0 && savedTodoLists({}).length === 0);
  ok('days must be a whole number of days from 0 to 365, else none', JSON.stringify(savedTodoLists([{ ...good, items: [{ title: 'a', days: -1 }, { title: 'b', days: 2.5 }, { title: 'c', days: 400 }, { title: 'd', days: '3' }, { title: 'e', days: 365 }] }])[0].items.map((i) => i.days)) === JSON.stringify([null, null, null, null, 365]));
  ok(`at most ${MAX_TODO_LISTS} lists`, savedTodoLists(Array.from({ length: 30 }, () => good)).length === MAX_TODO_LISTS);
  ok('the page gets the name, the count and each to-do', JSON.stringify(todoListSummary(good)) === JSON.stringify({ id: ID, name: 'Website kickoff', count: 2, items: good.items, created_at: good.created_at }));
}

// ═══ 3. adding a list dates its to-dos from the caller's own day ═══
{
  const list = { id: ID, name: 'Website kickoff', items: [{ title: 'Send the contract', days: 2 }, { title: 'Collect the logins', days: null }, { title: 'Same day', days: 0 }, { title: 'Into next year', days: 45 }], created_at: '' };
  const todos = todosFromList(list, '2026-11-20');
  ok('each due that many days after today; no date stays none', JSON.stringify(todos.map((t) => t.due_date)) === JSON.stringify(['2026-11-22', null, '2026-11-20', '2027-01-04']), JSON.stringify(todos.map((t) => t.due_date)));
  ok('the titles come across as saved', todos.map((t) => t.title).join(',') === 'Send the contract,Collect the logins,Same day,Into next year');
  ok('a day that isn’t a day dates nothing rather than guess', todosFromList(list, 'soon').every((t) => t.due_date === null));
}

// ═══ 4. the routes ═══
{
  const route = read('supabase/functions/presence/routes/todo_templates.ts');
  ok('saving reads the deal’s own live to-dos, oldest first, after checking the deal is this studio’s', /if \(!\(await dealHere\(site\.id, dealId\)\)\) return json\(\{ error: 'not_found'/.test(route) && /presence_deal_tasks\?site_id=eq\.\$\{site\.id\}&deal_id=eq\.\$\{dealId\}&deleted_at=is\.null&select=title,due_date,created_at&order=created_at\.asc/.test(route));
  ok('a deal with no to-dos says so; a full shelf says how many', /This deal has no to-dos to save yet\./.test(route) && /You can keep up to \$\{MAX_TODO_LISTS\} to-do lists\. Remove one first\./.test(route));
  ok('the lists are one reserved row, changed with the compare-and-swap writer', /updateReservedJson\(site\.id, RESERVED_NAMES\.todoLists,/.test(route) && RESERVED_NAMES.todoLists === '__todo_lists__');
  ok('adding a list makes plain deal to-dos, in one insert, dated from ?today=', /callerToday\(new URL\(req\.url\)\.searchParams\.get\('today'\), new Date\(\)\.toISOString\(\)\)/.test(route) && /body: JSON\.stringify\(todos\.map\(\(t\) => \(\{ site_id: site\.id, deal_id: dealId, title: t\.title, due_date: t\.due_date, status: 'open' \}\)\)\)/.test(route));
  ok('a list that has gone, or a deal that isn’t here, is not found', /That list isn’t here any more\./.test(route) && (route.match(/That deal isn’t here\./g) || []).length === 2);
  const idx = read('supabase/functions/presence/index.ts');
  ok('index: the three routes', idx.includes("if (route === '/sales/todo-templates') return (await import('./routes/todo_templates.ts')).handleTodoTemplates(req, site, principal, null, cors);") && /sales\\\/todo-templates\\\/\(\[0-9a-f-\]\{36\}\)\$\/\);\n\s*if \(m\) return \(await import\('\.\/routes\/todo_templates\.ts'\)\)\.handleTodoTemplates\(req, site, principal, m\[1\], cors\);/.test(idx) && idx.includes("if (m && method === 'POST') return (await import('./routes/todo_templates.ts')).handleDealTasksFromTemplate(req, site, principal, m[1], cors);"));
  const roles = read('supabase/functions/presence/lib/site_roles.ts');
  ok('roles: saving and adding are edit, removing is delete', roles.includes("'POST /sales/todo-templates',") && roles.includes('`POST /sales/deals/${ID}/tasks/from-template`,') && roles.includes('`DELETE /sales/todo-templates/${ID}`,'));
}

// ═══ 5. the deal's To-dos card ═══
{
  const pipe = read('pipeline.html');
  ok('the card offers the saved lists and Save these as a list', pipe.includes('<select id="dt-list" aria-label="Add a saved list of to-dos"') && pipe.includes('<button class="btn ghost" id="dt-list-save">Save these as a list</button>'));
  ok('wired as the deal opens, beside its to-dos', /loadDealTasks\(id\);\n\s*wireTodoLists\(id\);/.test(pipe));
  ok('adding sends the list and the caller’s day, then reloads the to-dos', pipe.includes("api('/sales/deals/'+id+'/tasks/from-template?today='+localYmd(),'POST',{template_id:L.id})") && /toast\('Added '\+todoCount\([^;]*;sel\.value='';pick\.hidden=true;loadDealTasks\(id\);/.test(pipe));
  ok('saving sends the name and this deal', pipe.includes("api('/sales/todo-templates','POST',{name:v.name,from_deal_id:id})"));
  ok('removing takes two taps and is marked for delete', pipe.includes('data-needs="delete" data-del-ttpl="${esc(L.id)}"') && /if\(b\.dataset\.armed!=='1'\)\{b\.dataset\.armed='1';b\.textContent='Tap again to remove';return;\}b\.disabled=true;try\{await api\('\/sales\/todo-templates\/'\+b\.dataset\.delTtpl,'DELETE'\)/.test(pipe));
  ok('a slow read never paints into a deal the drawer has left', /if\(CURRENT_DEAL!==id\|\|sel!==\$\('dt-list'\)\)return;/.test(pipe));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SAVED TO-DO LISTS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
