// Run against the disposable fake-device preview only: npm run preview --prefix cloud.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('../../private/performance-qa/', import.meta.url));
const base = 'http://127.0.0.1:4183';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const headers = { Origin: base };
const ids = [];
function hold(path, status) {
  let release, entered;
  const wait = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const handler = async route => {
    entered(); await wait;
    if (status) await route.fulfill({ status, json: { error: 'Fixture rejected this change.' } });
    else await route.continue();
  };
  return page.route(`**${path}`, handler).then(() => ({ started, release, remove: () => page.unroute(`**${path}`, handler) }));
}
try {
  await mkdir(evidence, { recursive: true });
  await context.request.post(base + '/auth/login', { headers, data: { email: 'preview@example.test', password: 'preview-only' } });
  for (const label of ['First fixture', 'Second fixture']) {
    const response = await context.request.post(base + '/api/hatch/alarms', { headers, data: { label, trackId: 'hatch-sound-10514', localTime: '23:59', timeZone: 'America/Los_Angeles', enabled: false, volume: 30, light: { color: '#ff8800', from: 0, to: 75, rampSeconds: 15 } } });
    ids.push((await response.json()).alarm.id);
  }
  const startup = [];
  page.on('request', request => { const p = new URL(request.url()).pathname; if (p.startsWith('/auth/') || p.endsWith('/state')) startup.push(p); });
  await page.goto(base + '/?tab=alarms');
  const first = page.getByRole('switch', { name: /First fixture/ });
  const second = page.getByRole('switch', { name: /Second fixture/ });
  await expect(first).toBeVisible();
  expect(startup).toEqual(['/auth/bootstrap']);
  const one = await hold('/api/hatch/alarms/' + ids[0]);
  const two = await hold('/api/hatch/alarms/' + ids[1]);
  await first.click(); await one.started;
  await expect(first).toBeChecked(); await expect(second).toBeEnabled();
  await second.click(); await two.started; await expect(second).toBeChecked();
  two.release(); await expect(second).toBeEnabled();
  one.release(); await expect(first).toBeEnabled(); await one.remove(); await two.remove();
  const rejected = await hold('/api/hatch/alarms/' + ids[0], 409);
  await first.click(); await rejected.started; await expect(first).not.toBeChecked();
  rejected.release(); await expect(first).toBeChecked(); await expect(page.getByText('Fixture rejected this change.', { exact: true }).first()).toBeVisible(); await rejected.remove();
  console.log('PASS independent alarm switches and rejection rollback');
  // A GET begun before a write cannot undo that write when it arrives later.
  const oldState = await (await context.request.get(base + '/api/hatch/state')).json();
  let releaseOld, oldEntered;
  const oldWait = new Promise(resolve => { releaseOld = resolve; });
  const oldStarted = new Promise(resolve => { oldEntered = resolve; });
  const oldHandler = async route => { oldEntered(); await oldWait; await route.fulfill({ json: oldState }); };
  await page.route('**/api/hatch/state', oldHandler);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await oldStarted;
  await first.click(); await expect(first).not.toBeChecked(); await expect(first).toBeEnabled();
  const oldDelivered = page.waitForResponse(response => response.url().endsWith('/api/hatch/state'));
  releaseOld(); await oldDelivered;
  await expect(page.getByRole('switch', { name: /First fixture/ })).not.toBeChecked();
  await page.unroute('**/api/hatch/state', oldHandler);
  console.log('PASS stale-read exclusion');
  // Hardware intent changes immediately while the actual request is still held.
  await context.request.post(base + '/api/hatch/stop', { headers, data: {} });
  await page.goto(base + '/?tab=sounds');
  await page.getByRole('searchbox').fill('Pink Noise');
  const play = await hold('/api/hatch/play');
  await page.getByRole('button', { name: /^Play Pink Noise/ }).click(); await play.started;
  await page.getByRole('link', { name: 'Room', exact: true }).click();
  await expect(page.locator('#now-title')).toHaveText('Pink Noise');
  await expect(page.locator('.sleeve-kicker')).toHaveText('Sending…');
  await expect(page.locator('.record-player')).not.toHaveClass(/is-spinning/);
  await page.screenshot({ path: evidence + 'sound-sending.png', fullPage: true });
  const report = await hold('/api/hatch/state');
  play.release(); await report.started;
  await expect(page.locator('.sleeve-kicker')).toHaveText('Confirming…');
  await expect(page.getByRole('button', { name: /Turn Off Hatch/ })).toBeEnabled();
  report.release(); await expect(page.locator('.sleeve-kicker')).not.toHaveText(/Sending|Confirming/); await play.remove(); await report.remove();
  console.log('PASS immediate playback intent and acceptance boundary');
  // Volume target survives acceptance while its report is pending; rejected edit rolls back.
  const original = Number(await page.locator('#room-volume').inputValue());
  const volume = await hold('/api/hatch/volume');
  await page.locator('#room-volume').focus(); await page.keyboard.press('ArrowUp'); await volume.started;
  await expect(page.locator('#room-volume')).toHaveValue(String(original + 1));
  const volumeReport = await hold('/api/hatch/state'); volume.release(); await volumeReport.started;
  await expect(page.locator('#room-volume')).toHaveValue(String(original + 1));
  volumeReport.release(); await expect(page.locator('#room-volume')).toBeEnabled(); await volume.remove(); await volumeReport.remove();
  const failVolume = await hold('/api/hatch/volume', 409);
  await page.locator('#room-volume').focus(); await page.keyboard.press('ArrowUp'); await failVolume.started;
  failVolume.release(); await expect(page.locator('#room-volume')).toHaveValue(String(original + 1)); await failVolume.remove();
  await expect(page.locator('#room-volume')).toBeEnabled();
  const unknownVolume = await hold('/api/hatch/volume', 503);
  await page.locator('#room-volume').focus(); await page.keyboard.press('ArrowUp'); await unknownVolume.started;
  const unknownReport = await hold('/api/hatch/state');
  unknownVolume.release(); await unknownReport.started;
  await expect(page.locator('#room-volume')).toHaveValue(String(original + 2));
  unknownReport.release(); await expect(page.locator('#room-volume')).toBeEnabled();
  await expect(page.locator('#room-volume')).toHaveValue(String(original + 1));
  await expect(page.getByText(/The command’s result was uncertain/)).toBeVisible();
  await unknownVolume.remove(); await unknownReport.remove();
  console.log('PASS volume confirmation and rejection rollback');
  await page.getByRole('link', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Color', exact: true }).click();
  await expect(page.locator('.light-editor-heading [role="status"]')).toHaveText('Hatch · On');
  const off = await hold('/api/hatch/light');
  await page.getByRole('button', { name: 'Off', exact: true }).click(); await off.started;
  await expect(page.locator('.light-editor-heading [role="status"]')).toHaveText('Hatch · Sending…');
  await expect.poll(() => page.locator('.light-color-layer').evaluateAll(nodes => nodes.every(n => Number(n.style.opacity) === 0))).toBe(true);
  await page.screenshot({ path: evidence + 'light-sending.png', fullPage: true });
  off.release(); await expect(page.locator('.light-editor-heading [role="status"]')).toHaveText('Hatch · Off'); await off.remove();
  for (const width of [320, 393, 1280]) {
    await page.setViewportSize({ width, height: 852 });
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}light-${width}-${colorScheme}.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
  console.log('PASS one-request bootstrap, immediate independent alarm switches, rollback, stale-read exclusion, immediate sound/light intent, confirmation boundary, volume draft/rollback, no page errors.');
} finally {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  for (const id of ids) await context.request.delete(base + '/api/hatch/alarms/' + id, { headers }).catch(() => {});
  await browser.close();
}
