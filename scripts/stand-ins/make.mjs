// ── Stand-in pictures, one per kind of business (builder list items 331 and 332) ──
//   node scripts/stand-ins/make.mjs            (needs the e2e devDependencies: npm ci)
// Writes thumbs/stand-ins/<family>.jpg, 1600 x 1000. Each is a plain, flat drawing made
// here (no outside picture, font or file), so it can ship with the app. A first draft in
// + New site opens with one until a real photo is swapped in (lib/stand_in.ts), and the
// template pictures in + New site and Templates use them where a photo goes, so a salon
// owner sees a salon. When real photos are approved they replace these files, same names.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const W = 1600, H = 1000;
const bg = (a, b) => `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`;
const SCENES = {
  // a table set for dinner under a lamp
  food: `${bg('#F3E3D3', '#E8CCB2')}
    <line x1="1000" y1="0" x2="1000" y2="190" stroke="#2F2A26" stroke-width="6"/>
    <path d="M880 300 Q1000 170 1120 300 Z" fill="#C8553D"/><rect x="972" y="300" width="56" height="18" rx="9" fill="#F7D9A8"/>
    <ellipse cx="1000" cy="330" rx="260" ry="40" fill="#F7D9A8" opacity=".35"/>
    <rect x="0" y="690" width="${W}" height="310" fill="#8A5A3B"/><rect x="0" y="690" width="${W}" height="22" fill="#A26C47"/>
    <ellipse cx="900" cy="700" rx="250" ry="70" fill="#000" opacity=".12"/>
    <ellipse cx="900" cy="680" rx="250" ry="70" fill="#FFFDF8"/><ellipse cx="900" cy="680" rx="190" ry="50" fill="#EADBC8"/>
    <ellipse cx="860" cy="668" rx="80" ry="26" fill="#6F8F4E"/><circle cx="930" cy="664" r="30" fill="#C8553D"/><circle cx="975" cy="680" r="22" fill="#E3A44B"/>
    <rect x="560" y="600" width="14" height="170" rx="7" fill="#C9B8A0"/><rect x="1225" y="600" width="14" height="170" rx="7" fill="#C9B8A0"/>
    <path d="M1300 470 h110 l-12 120 q-43 30 -86 0 z" fill="#FFFFFF" opacity=".75"/><path d="M1309 540 h92 l-6 50 q-40 26 -80 0 z" fill="#7A1F2B"/>
    <rect x="1349" y="600" width="12" height="80" fill="#FFFFFF" opacity=".75"/><ellipse cx="1355" cy="684" rx="48" ry="12" fill="#FFFFFF" opacity=".75"/>`,
  // a salon chair in front of a round mirror
  beauty: `${bg('#F6E1DC', '#EDCBC2')}
    <circle cx="980" cy="380" r="250" fill="#C99A7E"/><circle cx="980" cy="380" r="225" fill="#FBEFEA"/>
    <path d="M820 300 q60 -90 160 -110" stroke="#FFFFFF" stroke-width="18" stroke-linecap="round" fill="none" opacity=".8"/>
    <rect x="0" y="800" width="${W}" height="200" fill="#E2B9AE"/>
    <rect x="860" y="520" width="240" height="210" rx="40" fill="#7A3B55"/><rect x="830" y="640" width="300" height="80" rx="34" fill="#8E4A67"/>
    <rect x="968" y="720" width="24" height="90" fill="#3D2B33"/><ellipse cx="980" cy="818" rx="120" ry="20" fill="#3D2B33"/>
    <rect x="300" y="560" width="120" height="240" rx="16" fill="#E8D5C9"/>
    <path d="M360 560 C300 450 250 420 230 340 C300 370 340 430 360 560 Z" fill="#6F8F6B"/><path d="M360 560 C380 440 430 400 470 330 C470 420 420 470 360 560 Z" fill="#87A684"/>
    <path d="M1300 520 l60 -60 M1300 460 l60 60" stroke="#3D2B33" stroke-width="10" stroke-linecap="round"/><circle cx="1290" cy="530" r="16" fill="none" stroke="#3D2B33" stroke-width="8"/><circle cx="1290" cy="450" r="16" fill="none" stroke="#3D2B33" stroke-width="8"/>`,
  // a house, and the wrench that fixes it
  home: `${bg('#DCEBF5', '#C3DCEE')}
    <circle cx="1350" cy="190" r="80" fill="#F7E7B4"/>
    <rect x="0" y="780" width="${W}" height="220" fill="#7DA46B"/><rect x="0" y="780" width="${W}" height="16" fill="#6A9259"/>
    <path d="M520 470 L800 250 L1080 470 Z" fill="#2E4A62"/><rect x="580" y="470" width="440" height="320" fill="#F7F4EF"/>
    <rect x="760" y="600" width="80" height="190" rx="6" fill="#C46A2D"/><circle cx="822" cy="700" r="6" fill="#F7E7B4"/>
    <rect x="620" y="530" width="100" height="90" rx="6" fill="#9CC3DE"/><rect x="880" y="530" width="100" height="90" rx="6" fill="#9CC3DE"/>
    <rect x="667" y="530" width="6" height="90" fill="#F7F4EF"/><rect x="927" y="530" width="6" height="90" fill="#F7F4EF"/>
    <rect x="900" y="300" width="50" height="110" fill="#2E4A62"/>
    <g transform="rotate(-35 1240 560)"><rect x="1180" y="440" width="44" height="300" rx="22" fill="#2E3A44"/><path d="M1158 400 a44 44 0 1 1 88 0 l0 30 l-24 0 l0 -40 l-40 0 l0 40 l-24 0 z" fill="#2E3A44"/><rect x="1192" y="470" width="10" height="240" rx="5" fill="#5B6A75"/></g>`,
  // a calm clinic: a cross on a tile, a window, a plant
  health: `${bg('#E3F1F2', '#CDE5E8')}
    <rect x="980" y="160" width="420" height="420" rx="24" fill="#FFFFFF" opacity=".7"/><rect x="1180" y="160" width="20" height="420" fill="#CDE5E8"/><rect x="980" y="360" width="420" height="20" fill="#CDE5E8"/>
    <rect x="0" y="800" width="${W}" height="200" fill="#B9D9DC"/>
    <rect x="420" y="300" width="400" height="400" rx="90" fill="#FFFFFF"/><rect x="420" y="320" width="400" height="400" rx="90" fill="#000" opacity=".05"/>
    <rect x="575" y="380" width="90" height="240" rx="18" fill="#0E7C86"/><rect x="500" y="455" width="240" height="90" rx="18" fill="#0E7C86"/>
    <rect x="1080" y="620" width="120" height="180" rx="14" fill="#F2F7F7"/>
    <path d="M1140 620 C1100 540 1060 520 1040 450 C1100 480 1130 540 1140 620 Z" fill="#7BB49A"/><path d="M1140 620 C1160 530 1200 500 1240 440 C1240 520 1200 560 1140 620 Z" fill="#5E9C82"/>`,
  // a desk: laptop, notebook, coffee, lamp
  professional: `${bg('#E6E9EF', '#D3D9E3')}
    <rect x="200" y="180" width="300" height="380" rx="10" fill="#C5CEDC"/><rect x="230" y="210" width="240" height="40" rx="6" fill="#AEB9CB"/><rect x="230" y="270" width="240" height="40" rx="6" fill="#AEB9CB"/><rect x="230" y="330" width="240" height="40" rx="6" fill="#AEB9CB"/>
    <rect x="0" y="700" width="${W}" height="300" fill="#3B4A5E"/><rect x="0" y="700" width="${W}" height="20" fill="#4C5D74"/>
    <rect x="620" y="420" width="420" height="270" rx="16" fill="#1F2733"/><rect x="642" y="442" width="376" height="226" rx="8" fill="#8FA8C8"/>
    <rect x="560" y="690" width="540" height="26" rx="10" fill="#2A3442"/>
    <rect x="1170" y="600" width="210" height="110" rx="6" fill="#F2EEE6" transform="rotate(-6 1275 655)"/>
    <rect x="1420" y="610" width="80" height="96" rx="10" fill="#C9A45C"/><path d="M1500 630 a24 24 0 0 1 0 48" stroke="#C9A45C" stroke-width="10" fill="none"/>
    <path d="M330 690 L330 470 L420 400" stroke="#2B3442" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M380 360 l120 60 l-40 60 z" fill="#2B3442"/><ellipse cx="330" cy="694" rx="70" ry="14" fill="#2B3442"/>`,
  // a shopfront with a striped awning
  retail: `${bg('#F4ECE1', '#E8D7C0')}
    <rect x="0" y="830" width="${W}" height="170" fill="#C9B79C"/>
    <rect x="400" y="220" width="800" height="610" fill="#2F5D3A"/>
    <g>${Array.from({ length: 8 }, (_, i) => `<path d="M${380 + i * 105} 300 h105 v90 q-52 40 -105 0 z" fill="${i % 2 ? '#C8553D' : '#F7F2E8'}"/>`).join('')}</g>
    <rect x="470" y="440" width="380" height="300" rx="8" fill="#D9E7E2"/><rect x="900" y="440" width="230" height="390" rx="6" fill="#1F2A22"/><circle cx="1100" cy="640" r="9" fill="#C9A45C"/>
    <rect x="500" y="650" width="80" height="70" rx="6" fill="#C8553D"/><rect x="610" y="610" width="90" height="110" rx="6" fill="#E3A44B"/><rect x="730" y="660" width="90" height="60" rx="6" fill="#7A3B55"/>
    <rect x="300" y="700" width="80" height="130" rx="10" fill="#C46A2D"/><circle cx="340" cy="660" r="60" fill="#6F8F4E"/><circle cx="310" cy="690" r="40" fill="#87A684"/>
    <rect x="1220" y="700" width="80" height="130" rx="10" fill="#C46A2D"/><circle cx="1260" cy="660" r="60" fill="#6F8F4E"/><circle cx="1290" cy="690" r="40" fill="#87A684"/>`,
  // a gym floor: a dumbbell and a kettlebell
  fitness: `${bg('#F6E7DA', '#EFD0B8')}
    <rect x="980" y="140" width="460" height="360" rx="14" fill="#FFF4EA"/><rect x="1200" y="140" width="20" height="360" fill="#EFD0B8"/>
    <rect x="0" y="740" width="${W}" height="260" fill="#3A3A3A"/><rect x="0" y="740" width="${W}" height="16" fill="#4A4A4A"/>
    <ellipse cx="700" cy="780" rx="330" ry="30" fill="#000" opacity=".25"/>
    <rect x="470" y="660" width="460" height="40" rx="20" fill="#1E1E1E"/>
    <rect x="430" y="560" width="70" height="240" rx="18" fill="#FF5A1F"/><rect x="380" y="590" width="60" height="180" rx="16" fill="#E14A12"/>
    <rect x="900" y="560" width="70" height="240" rx="18" fill="#FF5A1F"/><rect x="960" y="590" width="60" height="180" rx="16" fill="#E14A12"/>
    <path d="M1180 520 a90 90 0 0 1 180 0" stroke="#2B2B2B" stroke-width="40" fill="none"/><circle cx="1270" cy="650" r="150" fill="#2B2B2B"/><ellipse cx="1220" cy="600" rx="40" ry="24" fill="#4A4A4A"/>`,
  // a camera
  creative: `${bg('#E9E4F0', '#D6CDE4')}
    <rect x="0" y="800" width="${W}" height="200" fill="#C7BBD8"/>
    <rect x="460" y="330" width="680" height="420" rx="50" fill="#1F1F24"/><rect x="560" y="270" width="200" height="90" rx="20" fill="#1F1F24"/>
    <rect x="1010" y="370" width="80" height="44" rx="10" fill="#F5F5F5"/><circle cx="560" cy="400" r="18" fill="#C8553D"/>
    <circle cx="800" cy="540" r="170" fill="#3A3A44"/><circle cx="800" cy="540" r="130" fill="#6B6B7A"/><circle cx="800" cy="540" r="96" fill="#2A3040"/><circle cx="800" cy="540" r="70" fill="#8FA6C8"/>
    <circle cx="770" cy="510" r="22" fill="#FFFFFF" opacity=".7"/>`,
  // people, and a heart
  community: `${bg('#F5EAD7', '#EDD8B4')}
    <path d="M1150 260 C1150 180 1250 150 1300 220 C1350 150 1450 180 1450 260 C1450 360 1300 430 1300 430 C1300 430 1150 360 1150 260 Z" fill="#C8553D"/>
    <rect x="0" y="820" width="${W}" height="180" fill="#D9BF95"/>
    <circle cx="560" cy="470" r="80" fill="#8A5A3B"/><path d="M420 820 q0 -220 140 -220 q140 0 140 220 z" fill="#2F5D3A"/>
    <circle cx="800" cy="430" r="90" fill="#D9A66B"/><path d="M640 820 q0 -250 160 -250 q160 0 160 250 z" fill="#C46A2D"/>
    <circle cx="1040" cy="480" r="76" fill="#5B3A29"/><path d="M910 820 q0 -210 130 -210 q130 0 130 210 z" fill="#13315C"/>`,
  // a door that's open for business
  other: `${bg('#ECEFE9', '#D9E1D5')}
    <rect x="0" y="810" width="${W}" height="190" fill="#B8C2B4"/>
    <rect x="560" y="200" width="480" height="610" rx="10" fill="#2F3E35"/><rect x="600" y="240" width="400" height="570" rx="6" fill="#6F8F6B"/>
    <rect x="640" y="290" width="320" height="200" rx="6" fill="#DCE7DA"/><circle cx="950" cy="600" r="14" fill="#C9A45C"/>
    <line x1="720" y1="490" x2="760" y2="560" stroke="#2F3E35" stroke-width="4"/><line x1="880" y1="490" x2="840" y2="560" stroke="#2F3E35" stroke-width="4"/><rect x="700" y="555" width="200" height="80" rx="10" fill="#F7F2E8"/>
    <rect x="1120" y="640" width="120" height="170" rx="12" fill="#C46A2D"/><path d="M1180 640 C1130 540 1080 520 1060 440 C1130 470 1160 540 1180 640 Z" fill="#4F7A4E"/><path d="M1180 640 C1200 530 1250 500 1290 430 C1290 520 1240 570 1180 640 Z" fill="#6F8F6B"/>
    <rect x="520" y="800" width="560" height="24" rx="6" fill="#9AA696"/>`,
};

const out = fileURLToPath(new URL('../../thumbs/stand-ins/', import.meta.url));   // a path with spaces stays one path
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const [family, scene] of Object.entries(SCENES)) {
  await page.setContent(`<!doctype html><html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${scene}</svg></body></html>`);
  await page.screenshot({ path: `${out}${family}.jpg`, type: 'jpeg', quality: 82 });
  console.log('wrote', family);
}
await browser.close();
