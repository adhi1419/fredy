/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Screenshots for the README: every surface, light + dark, desktop (1440) + mobile (390), against
// the local emulator stack. Signs in through the Firebase Auth emulator popup as dev@example.com.
// usage: FREDY_URL=http://127.0.0.1:5173 node scripts/screenshots/shoot.cjs doc/screenshots
// Needs playwright-core and a Chromium (PLAYWRIGHT_CHROMIUM, or the default playwright download).
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const BASE = process.env.FREDY_URL || 'http://127.0.0.1:5173';
const out = process.argv[2] || 'doc/screenshots';
fs.mkdirSync(out, { recursive: true });
const profile = path.join(os.tmpdir(), 'fredy-screenshot-profile');

// Each shot: name, how to get there (url + optional steps), and which viewports it is taken at.
const SHOTS = [
  { name: 'home-quiet-feed', url: '/#/dashboard', vps: ['desktop', 'mobile'] },
  { name: 'home-list-map', url: '/#/dashboard?view=map', vps: ['desktop', 'mobile'], settle: 5000 },
  { name: 'saved-searches', url: '/#/jobs', vps: ['desktop', 'mobile'] },
  { name: 'saved-search-step-1', url: '/#/jobs/edit/job-berlin', vps: ['desktop', 'mobile'] },
  { name: 'listing-detail', url: '/#/listings/listing/demo-1', vps: ['desktop', 'mobile'], settle: 5000 },
  { name: 'my-account', url: '/#/settings/preferences', vps: ['desktop', 'mobile'] },
];
const VP = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

async function login(ctx, page) {
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const loginBtn = page.getByRole('button', { name: /google|sign in|anmelden/i }).first();
  if (await loginBtn.count()) {
    const [popup] = await Promise.all([ctx.waitForEvent('page'), loginBtn.click()]);
    await popup.waitForLoadState('domcontentloaded');
    const existing = popup.getByText('dev@example.com').first();
    if (await existing.count()) await existing.click();
    else {
      await popup.getByRole('button', { name: /add new account/i }).click();
      await popup.getByLabel(/email/i).fill('dev@example.com');
      await popup.getByLabel(/display name/i).fill('Adhi Dev');
      await popup.getByRole('button', { name: /sign in with google/i }).click();
    }
    await page.waitForTimeout(3500);
  }
}

(async () => {
  const ctx = await chromium.launchPersistentContext(profile, {
    ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    viewport: VP.desktop,
    deviceScaleFactor: 1,
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
  await login(ctx, page);
  console.log('LOGGED IN:', (await page.innerText('body')).slice(0, 80).replace(/\s+/g, ' '));

  for (const theme of ['light', 'dark']) {
    // The theme is a user setting: flip it through the Preferences control the app itself uses.
    await page.setViewportSize(VP.desktop);
    await page.goto(BASE + '/#/settings/preferences', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.getByRole('radio', { name: new RegExp(theme, 'i') }).first().click({ force: true }).catch(async () => {
      await page.getByText(new RegExp(`^${theme}$`, 'i')).first().click();
    });
    await page.waitForTimeout(1500);
    const mode = await page.evaluate(() => document.body.getAttribute('theme-mode'));
    console.log('THEME', theme, '->', mode);

    for (const shot of SHOTS) {
      for (const vp of shot.vps) {
        await page.setViewportSize(VP[vp]);
        await page.goto(BASE + shot.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(shot.settle ?? 3000);
        const file = path.join(out, `${shot.name}-${vp}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log('shot', path.basename(file), page.url().replace(BASE, ''));
      }
    }
  }
  await ctx.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
