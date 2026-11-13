// Run against the disposable fake-device preview only: npm run preview --prefix cloud.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('../../private/fader-qa/', import.meta.url));
const base = 'http://127.0.0.1:4183';
const headers = { Origin: base };
const browser = await chromium.launch();
try {
  await mkdir(evidence, { recursive: true });
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await context.newPage();
    const errors = [], volumes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().endsWith('/api/hatch/volume')) volumes.push(request.postDataJSON().volume); });
    await context.request.post(base + '/auth/login', { headers, data: { email: 'preview@example.test', password: 'preview-only' } });
    await context.request.patch(base + '/api/hatch/volume', { headers, data: { volume: 40 } });
    await page.goto(base);
    const fader = page.locator('#room-volume');
    await expect(fader).toHaveValue('40');
    await page.screenshot({ path: `${evidence}room-${scheme}.png` });
    if (scheme === 'dark') { await context.close(); continue; }

    // Touch moves relative to the current level, without jumping to the finger.
    await page.locator('.sleeve .fader-track').scrollIntoViewIfNeeded();
    const box = await page.locator('.sleeve .fader-track').boundingBox();
    const cdp = await context.newCDPSession(page);
    const y = box.y + 24, x0 = box.x + box.width * 0.85;
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', x0);
    await expect(fader).toHaveValue('40');
    const report = (await page.locator('#room-volume').boundingBox()).width - 32;
    // The first sideways move engages the drag; later ones move it.
    await touch('touchMove', x0 - 8);
    for (let step = 1; step <= 8; step++) await touch('touchMove', x0 - 8 - step * report * 0.025);
    await expect(page.locator('.sleeve .fader')).toHaveAttribute('data-dragging', 'true');
    await touch('touchEnd');
    await expect(fader).toHaveValue('20');
    await expect.poll(() => volumes).toEqual([20]);
    console.log('PASS relative touch drag commits once');

    // A vertical swipe over the fader scrolls rather than moving it.
    await touch('touchStart', x0);
    for (let step = 1; step <= 4; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + 2, y: y - step * 12 }] });
    await touch('touchEnd');
    await expect(fader).toHaveValue('20');
    expect(volumes).toEqual([20]);
    console.log('PASS vertical swipe leaves volume');

    // A stale report cannot snap the chosen value back.
    const stale = await (await context.request.get(base + '/api/hatch/state')).json();
    const staleHandler = route => route.fulfill({ json: stale });
    await page.getByRole('button', { name: 'Raise Volume' }).click();
    await page.route('**/api/hatch/state', staleHandler);
    await expect.poll(() => volumes).toEqual([20, 25]);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(500);
    await expect(fader).toHaveValue('25');
    await expect(page.locator('.sleeve .fader')).toHaveAttribute('data-syncing', 'true');
    await page.unroute('**/api/hatch/state', staleHandler);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.sleeve .fader')).not.toHaveAttribute('data-syncing', 'true');
    await expect(fader).toHaveValue('25');
    console.log('PASS optimistic value survives a stale report');

    // Rapid step taps settle into one request.
    const raise = page.getByRole('button', { name: 'Raise Volume' });
    await raise.click(); await raise.click(); await raise.click();
    await expect(fader).toHaveValue('40');
    await expect.poll(() => volumes).toEqual([20, 25, 40]);
    console.log('PASS step taps coalesce');

    // Changes made while a request is out stay enabled and send only the newest.
    let release, entered;
    const wait = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    let held = false;
    const holdHandler = async route => { if (!held) { held = true; entered(); await wait; } await route.continue(); };
    await page.route('**/api/hatch/volume', holdHandler);
    await fader.focus();
    await page.keyboard.press('ArrowUp'); await started;
    await expect(fader).toBeEnabled();
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    await expect(fader).toHaveValue('44');
    release();
    await expect.poll(() => volumes).toEqual([20, 25, 40, 41, 44]);
    await page.unroute('**/api/hatch/volume', holdHandler);
    await expect(page.locator('.sleeve .fader')).not.toHaveAttribute('data-syncing', 'true');
    await expect(fader).toHaveValue('44');
    console.log('PASS in-flight changes queue and coalesce');

    // Mouse presses jump to the pointer and drag absolutely.
    const mouseContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const desk = await mouseContext.newPage();
    desk.on('pageerror', error => errors.push(error.message));
    await mouseContext.request.post(base + '/auth/login', { headers, data: { email: 'preview@example.test', password: 'preview-only' } });
    await desk.goto(base);
    const inputBox = await desk.locator('#room-volume').boundingBox();
    const at = value => inputBox.x + 16 + (inputBox.width - 32) * value / 100;
    await desk.mouse.move(at(70), inputBox.y + 24); await desk.mouse.down();
    await expect(desk.locator('#room-volume')).toHaveValue('70');
    await desk.mouse.move(at(30), inputBox.y + 24, { steps: 6 }); await desk.mouse.up();
    await expect(desk.locator('#room-volume')).toHaveValue('30');
    await desk.screenshot({ path: `${evidence}desktop.png` });
    await mouseContext.close();
    console.log('PASS mouse press and drag');

    expect(errors).toEqual([]);
    await context.close();
  }
  console.log('PASS fader: relative touch, scroll passthrough, optimistic hold, coalesced steps and queue, mouse, no page errors.');
} finally {
  await browser.close();
}
