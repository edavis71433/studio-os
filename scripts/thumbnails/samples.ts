// ── Sample content for the section picker's pictures (list item 25) ─────────────
// One filled-in section of every type the picker offers, in the stored shape the
// builder saves. scripts/thumbnails/render.ts resolves them through the real
// serializer and renderer, with placeholder photos, and shoot.mjs photographs each.
// tests/presence/thumbnails_test.mjs checks every picker type is here and draws.

// Section photo ids must look like real ids (UUIDs) to survive the serializer.
let next = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
const ids = (n: number) => Array.from({ length: n }, uuid);
export const FILE_ID = 'ffffffff-0000-4000-8000-000000000001';

export const SAMPLE_BLOCKS: Record<string, Record<string, unknown>> = {
  features: { type: 'features', title: 'Why people choose us', items: [
    { title: 'Same-day service', text: 'Call before noon and we come today.', icon: '⏱️' },
    { title: 'Upfront pricing', text: 'You see the price before we start.', icon: '💬' },
    { title: 'Guaranteed work', text: 'If it isn’t right, we come back free.', icon: '✅' }] },
  stats: { type: 'stats', title: 'In numbers', items: [
    { value: '1,200+', label: 'Happy customers' }, { value: '15 yrs', label: 'In business' }, { value: '4.9★', label: 'Average rating' }] },
  team: { type: 'team', title: 'Meet the team', members: [
    { name: 'Maya Torres', role: 'Owner', media_id: uuid() }, { name: 'Sam Lee', role: 'Lead technician', media_id: uuid() }, { name: 'Ana Ruiz', role: 'Office manager', media_id: uuid() }] },
  process: { type: 'process', title: 'How it works', steps: [
    { step: 'Get in touch', detail: 'Call, text or book online.' }, { step: 'We make a plan', detail: 'A clear quote, no surprises.' }, { step: 'Job done', detail: 'Clean, on time, guaranteed.' }] },
  pricing: { type: 'pricing', title: 'Packages', tiers: [
    { name: 'Basic', price_text: '$49', features: ['Inspection', 'Written report'] },
    { name: 'Standard', price_text: '$129', features: ['Everything in Basic', 'One repair'] },
    { name: 'Complete', price_text: '$249', features: ['Everything in Standard', 'A year of check-ups'] }] },
  certifications: { type: 'certifications', title: 'Licensed and insured', items: [
    { name: 'State licensed', issuer: 'License #123456' }, { name: 'Fully insured', issuer: '$2M liability' }, { name: 'Background checked', issuer: 'Every technician' }] },
  service_areas: { type: 'service_areas', title: 'Areas we serve', areas: ['Burbank', 'Glendale', 'Pasadena', 'North Hollywood', 'Studio City', 'Toluca Lake'] },
  cta: { type: 'cta', text: 'Ready to get started? We answer every call.', button: 'Book a visit', url: 'https://example.com/book' },
  gallery: { type: 'gallery', title: 'Recent work', image_ids: ids(6) },
  before_after: { type: 'before_after', title: 'Before and after', items: [{ before_id: uuid(), after_id: uuid(), caption: 'Kitchen, start to finish' }] },
  video: { type: 'video', title: 'See us at work', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', poster_id: uuid() },
  partners: { type: 'partners', title: 'Trusted by', image_ids: ids(5) },
  reviews: { type: 'reviews', rating: 4.9, count: 128, url: 'https://example.com/reviews' },
  reviews_wall: { type: 'reviews_wall', title: 'What customers say', max: 6 },
  appointment: { type: 'appointment', title: 'Book a time', url: 'https://example.com/book', text: 'Pick a time that suits you.', button: 'See open times' },
  booking: { type: 'booking', title: 'Book online', intro: 'Choose a service and a time. You’ll get a confirmation by email.' },
  newsletter: { type: 'newsletter', title: 'Stay in the loop', url: 'https://example.com/subscribe', text: 'News and offers, once a month.', button: 'Sign up' },
  social: { type: 'social', title: 'Follow along', links: [
    { network: 'instagram', url: 'https://instagram.com/example' }, { network: 'facebook', url: 'https://facebook.com/example' }, { network: 'youtube', url: 'https://youtube.com/@example' }] },
  events: { type: 'events', title: 'Coming up', items: [
    { name: 'Spring open house', date: '2026-04-12', detail: 'Tours and free coffee, 10 to 2.' },
    { name: 'Community workshop', date: '2026-05-03', detail: 'Small fixes you can do yourself.' }] },
  map: { type: 'map', title: 'Find us', address: '123 Main Street, Burbank, CA', directions_url: 'https://maps.google.com/?q=123+Main+Street+Burbank', image_media_id: uuid() },
  richtext: { type: 'richtext', title: 'Our story', body: 'We started with one van and a promise: **show up on time and do it right**. Fifteen years later we still answer our own phone.\n\nEvery job gets the same care, big or small.' },
  image: { type: 'image', image_id: uuid(), caption: 'Our workshop in Burbank' },
  image_text: { type: 'image_text', title: 'Built to last', image_id: uuid(), body: 'We use parts we would put in our own homes, and we tell you why we chose them.', side: 'left', button: { label: 'See our services', url: 'https://example.com/services' } },
  accordion: { type: 'accordion', title: 'Questions', items: [
    { summary: 'Do you charge for estimates?', body: 'No. Estimates are always free.' },
    { summary: 'Are you insured?', body: 'Yes, fully licensed and insured.' },
    { summary: 'Do you work weekends?', body: 'Saturdays, by appointment.' }] },
  tabs: { type: 'tabs', title: 'What we do', tabs: [
    { label: 'Repairs', body: 'Leaks, clogs and breakdowns, fixed the same day.' },
    { label: 'Installs', body: 'New fixtures and appliances, fitted cleanly.' },
    { label: 'Upkeep', body: 'Yearly check-ups that prevent surprises.' }] },
  carousel: { type: 'carousel', title: 'Gallery', slides: [{ image_id: uuid(), caption: 'A recent project' }, { image_id: uuid() }, { image_id: uuid() }] },
  progress: { type: 'progress', title: 'What we’re known for', items: [
    { label: 'On time', percent: 98 }, { label: 'Repeat customers', percent: 85 }, { label: 'Five-star reviews', percent: 92 }] },
  buttons: { type: 'buttons', buttons: [
    { label: 'Book a visit', url: 'https://example.com/book', style: 'primary' }, { label: 'Call us', url: 'tel:+15555550100', style: 'secondary' }] },
  divider: { type: 'divider', style: 'line', size: 'medium' },
  columns: { type: 'columns', id: 'columns-thumb', title: 'Three ways to reach us', columns: [
    { body: '**Call**\n\nWe answer every call, 8 to 6.' }, { body: '**Text**\n\nSend a photo, get a quote.' }, { body: '**Visit**\n\nOur shop is open weekdays.' }] },
  cards: { type: 'cards', id: 'cards-thumb', title: 'Services', cards: [
    { heading: 'Repairs', text: 'Fixed the same day.', image_id: uuid() }, { heading: 'Installs', text: 'Fitted cleanly.', image_id: uuid() }, { heading: 'Upkeep', text: 'No surprises.', image_id: uuid() }] },
  download: { type: 'download', title: 'Our price list', file_id: FILE_ID, label: 'Download the price list (PDF)' },
  toc: { type: 'toc', title: 'On this page' },
  title: { type: 'title', title: 'A heading for your page', subtitle: 'A short line underneath it' },
  link_list: { type: 'link_list', title: 'Useful links', links: [
    { label: 'Price list', url: 'https://example.com/prices' }, { label: 'Warranty', url: 'https://example.com/warranty' }, { label: 'Careers', url: 'https://example.com/jobs' }] },
  table: { type: 'table', title: 'Opening hours', headers: ['Day', 'Hours'], rows: [['Monday to Friday', '8am to 6pm'], ['Saturday', '9am to 2pm'], ['Sunday', 'Closed']] },
  spotlight: { type: 'spotlight', title: 'Something worth highlighting', eyebrow: 'New this month', body: 'Free safety check with every repair, through the end of the month.', button: { label: 'Book yours', url: 'https://example.com/book' } },
};
