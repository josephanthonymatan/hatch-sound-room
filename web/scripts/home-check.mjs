// Only the disposable preview: npm run preview --prefix cloud.
import { chromium, webkit, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = 'http://127.0.0.1:4183', headers = { Origin: base };
const evidence = fileURLToPath(new URL('../../private/home-qa/', import.meta.url));
await mkdir(evidence, { recursive: true });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
    const page = await context.newPage(), errors = [], lightWrites = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith('/api/hatch/light')) lightWrites.push(request.postDataJSON()); });
    const login = await context.request.post(base + '/auth/login', { headers, data: { email: 'preview@example.test', password: 'preview-only' } });
    expect(login.status(), 'Restart only the fake preview if its sign-in limit was reached').toBe(200);
    const state = async () => (await context.request.get(base + '/api/hatch/state')).json();
    await context.request.patch(base + '/api/hatch/light', { headers, data: { color: '#ff8800', brightness: 40 } });
    await page.goto(base);
    const home = page.locator('.room-grid');
    await expect(home).toBeVisible();
    expect((await page.locator('.sleeve').boundingBox()).height).toBeLessThan(300);
    await expect(page.locator('.sleeve').getByText(/Hatch Sound|Until stopped|Save Current Sound|Stops sound and light/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Turn Off Hatch', exact: true })).toBeVisible();
    await expect(page.locator('.sleeve').getByRole('button', { name: 'Turn Off Hatch' })).toHaveCount(0);
    await expect(page.getByText('On Your Hatch', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Hold the top for about/)).toHaveCount(0);

    // Home light controls send one deliberate color change and preserve the sound/volume.
    const before = await state();
    await page.getByLabel('Light color', { exact: true }).fill('#67befc');
    expect(lightWrites).toEqual([]);
    await page.getByRole('button', { name: 'Apply Color', exact: true }).click();
    await expect.poll(async () => (await state()).light.color).toBe('#67befc');
    await expect(page.getByRole('button', { name: 'Apply Color', exact: true })).toHaveCount(0);
    expect(lightWrites).toEqual([{ color: '#67befc' }]);
    await expect(page.locator('#room-brightness')).toBeEnabled();
    await page.locator('#room-brightness').focus(); await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await state()).light.brightness).toBe(41);
    const after = await state();
    expect(after.playback.active).toBe(before.playback.active);
    expect(after.playback.trackId).toBe(before.playback.trackId);
    expect(after.playback.volume).toBe(before.playback.volume);
    expect(new URL(page.url()).searchParams.get('tab')).toBeNull();
    const power = page.getByRole('switch', { name: 'Light power' });
    await expect(power).toBeEnabled(); await power.click();
    await expect.poll(async () => (await state()).light.on).toBe(false);
    await expect(power).toBeEnabled(); await power.click();
    await expect.poll(async () => (await state()).light.on).toBe(true);

    // Help is reachable, deep-linked and dismissible without permanent home copy.
    await page.getByLabel('More Room Actions').click();
    await page.getByRole('link', { name: 'Using Your Hatch' }).click();
    await expect(page.getByRole('dialog')).toContainText('Hold the top for about');
    expect(new URL(page.url()).searchParams.get('panel')).toBe('help');
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('More Room Actions')).toBeFocused();
    await page.getByRole('link', { name: 'New Alarm', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    // A selection in Sounds promotes that sound onto the home deck; counts survive reload.
    const target = (await state()).library.find(track => track.id === 'hatch-sound-10519');
    const initialCount = target.playCount;
    await page.goto(base + '/?tab=sounds&q=' + encodeURIComponent(target.title));
    await page.getByRole('button', { name: `Play ${target.title} on Hatch`, exact: true }).click();
    await expect.poll(async () => (await state()).library.find(track => track.id === target.id).playCount).toBe(initialCount + 1);
    await page.getByRole('link', { name: 'Room', exact: true }).click();
    const firstCard = page.locator('.deck-card').first();
    await expect(firstCard).toHaveAttribute('aria-label', `Play ${target.title} on Hatch`);
    await expect(firstCard).toBeEnabled(); await firstCard.click();
    await expect.poll(async () => (await state()).library.find(track => track.id === target.id).playCount).toBe(initialCount + 2);
    await page.reload(); await expect(firstCard).toHaveAttribute('aria-label', `Play ${target.title} on Hatch`);
    await page.route('**/api/hatch/play', route => route.fulfill({ status: 409, json: { error: 'Fixture rejected this selection.' } }));
    await firstCard.click(); await expect(page.getByText('Fixture rejected this selection.')).toBeVisible();
    expect((await state()).library.find(track => track.id === target.id).playCount).toBe(initialCount + 2);
    await page.unroute('**/api/hatch/play');
    await page.getByRole('button', { name: 'Dismiss Message' }).click();

    for (const width of [320, 393, 1280]) for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.evaluate(() => scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('#room-volume')).toBeVisible();
      await expect(page.locator('#room-brightness')).toBeVisible();
      const ink = colorScheme === 'dark' ? 'rgb(238, 237, 232)' : 'rgb(22, 22, 22)';
      for (const selector of ['.brand', '.page-head h1', '#room-light-title a', '#deck-title', '.deck-section .pill-link']) {
        await expect(page.locator(selector)).toHaveCSS('color', ink);
      }
      await page.screenshot({ path: `${evidence}${engine.name()}-${width}-${colorScheme}.png`, fullPage: true });
    }
    // Color-draft layout also fits the narrowest phone.
    await page.setViewportSize({ width: 320, height: 900 });
    await page.getByLabel('Light color', { exact: true }).fill('#ff5265');
    await expect(page.getByRole('button', { name: 'Apply Color', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}${engine.name()}-color-draft.png`, fullPage: true });
    expect(errors).toEqual([]);
    await context.close();
    console.log(`PASS ${engine.name()}: compact home, global power, inline light preserves audio, hidden help, alarm entry, durable usage ordering, failed-selection handling, responsive light/dark and color draft.`);
  } finally { await browser.close(); }
}
