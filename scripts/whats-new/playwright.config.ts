import base from '../../playwright.config';

// What's new's pictures (builder list item 128): the browser suite's own settings and static
// server, pointed at shoot.spec.ts here. WN_PORT picks another port when the suite's is busy.
//   WHATS_NEW_SHOOT=1 npx playwright test -c scripts/whats-new/playwright.config.ts
const port = Number(process.env.WN_PORT || 4173);
export default {
  ...base,
  testDir: '.',
  testMatch: /shoot\.spec\.ts$/,
  projects: [base.projects![0]],
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}`, video: 'off', trace: 'off' },
  webServer: { ...(base.webServer as object), cwd: '../..', command: `npx http-server . -p ${port} -c-1 --silent`, url: `http://127.0.0.1:${port}/today.html` },
};
