// Disposable preview only. Images are generated fixtures; no owner photo or Hatch connection.
import { chromium, webkit, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = 'http://127.0.0.1:4183';
const evidence = new URL('../../private/photo-palette-qa/', import.meta.url).pathname;
await mkdir(evidence, { recursive: true });

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], outgoing = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && (request.method() !== 'GET' || !request.url().startsWith(base))) outgoing.push(request.url()); });
  try {
    await context.request.post(base + '/auth/login', { headers: { Origin: base }, data: { email: 'preview@example.test', password: 'preview-only' } });
    await page.goto(base + '/?tab=lights');
    await page.getByRole('button', { name: 'More Options', exact: true }).click();
    const before = await page.locator('.light-palette input').evaluateAll(nodes => nodes.map(n => n.value));
    const makeImage = async (kind = 'photo') => Buffer.from(await page.evaluate(kind => {
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1000;
      const ctx = canvas.getContext('2d');
      if (kind === 'white') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,800,1000); }
      if (kind === 'photo') {
        const wall = ctx.createLinearGradient(0,0,800,1000); wall.addColorStop(0,'#e0c7a1'); wall.addColorStop(1,'#a99578');
        ctx.fillStyle = wall; ctx.fillRect(0,0,800,1000);
        ctx.fillStyle = '#579ac3'; ctx.fillRect(0,0,800,140);
        ctx.fillStyle = '#50483e'; ctx.fillRect(570,340,180,660);
        ctx.fillStyle = '#b72f40'; ctx.fillRect(220,590,120,200);
        ctx.fillStyle = '#ded3be'; ctx.fillRect(0,900,800,100);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, kind), 'base64');
    const photo = {name:'fixture.png',mimeType:'image/png',buffer:await makeImage()};
    const upload = page.locator('input[name="palette-photo"]');
    await upload.setInputFiles(photo);
    const use = page.getByRole('button', { name: 'Use Photo Colors', exact: true });
    await expect(use).toBeVisible();
    expect(await page.locator('.light-palette input').evaluateAll(nodes => nodes.map(n => n.value))).toEqual(before);
    expect(await page.locator('.photo-swatches li').count()).toBeGreaterThanOrEqual(3);
    expect(await page.locator('.photo-swatches li').count()).toBeLessThanOrEqual(5);
    for (const mode of ['Dominant', 'Character']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect(page.getByRole('button', { name: mode, exact: true })).toHaveAttribute('aria-pressed','true');
    }
    await page.getByRole('button', { name:'Up to 3 colors' }).click(); await expect(page.locator('.photo-swatches li')).toHaveCount(3);
    await page.getByRole('button', { name:'Up to 5 colors' }).click();
    for (const width of [320,393,1280]) {
      await page.setViewportSize({width,height:1000});
      for (const colorScheme of ['light','dark']) {
        await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.locator('.photo-palette').scrollIntoViewIfNeeded();
        await page.screenshot({path:`${evidence}${engine.name()}-${width}-${colorScheme}.png`});
      }
    }
    const colors = await page.locator('.photo-swatches li > span:last-child').allTextContents();
    await use.click();
    await expect(page.getByRole('button', { name:'Flow', exact:true })).toHaveAttribute('aria-pressed','true');
    expect(await page.locator('.light-palette input').evaluateAll(nodes => nodes.map(n => n.value))).toEqual(colors.map(c => c.toLowerCase()));
    await expect(page.locator('.light-editor')).toBeFocused();
    await page.getByRole('button', {name:'Save Preset',exact:true}).click();
    await page.getByRole('textbox', {name:'Preset Name'}).fill('Photo study');
    await page.getByRole('button', {name:'Save',exact:true}).click();
    expect(await page.evaluate(() => localStorage.getItem('sound-room-light-presets-v1'))).not.toMatch(/data:image|fixture\.png|thumbnail/);
    await page.reload(); await page.getByRole('button', {name:'Photo study',exact:true}).click();
    expect(await page.locator('.light-palette input').evaluateAll(nodes => nodes.map(n => n.value))).toEqual(colors.map(c => c.toLowerCase()));
    await page.getByRole('button', {name:'More Options',exact:true}).click();
    await upload.setInputFiles({name:'broken.heic',mimeType:'image/heic',buffer:Buffer.from('not an image')});
    await expect(page.getByRole('alert')).toContainText('could not open');
    await expect(use).toHaveCount(0);
    await upload.setInputFiles({name:'transparent.png',mimeType:'image/png',buffer:await makeImage('transparent')});
    await expect(page.getByRole('alert')).toContainText('transparent');
    expect(await page.locator('.light-palette input').evaluateAll(nodes => nodes.map(n => n.value))).toEqual(colors.map(c => c.toLowerCase()));
    await upload.setInputFiles({name:'large.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(25 * 1024 * 1024 + 1)});
    await expect(page.getByRole('alert')).toContainText('smaller than 25 MB');
    await upload.setInputFiles(photo); await expect(use).toBeVisible();
    await page.getByRole('button', {name:'Remove photo'}).click(); await expect(upload).toBeFocused();
    await expect(use).toHaveCount(0);
    await upload.setInputFiles({name:'white.png',mimeType:'image/png',buffer:await makeImage('white')});
    await expect(page.locator('.photo-swatches li')).toHaveCount(1); await use.click();
    await expect(page.getByRole('group', {name:'Light movement'}).getByRole('button', {name:'Solid',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.light-palette input')).toHaveValue('#ffffff');
    // Cancel while the worker script is still loading, then pick a new image. Old work cannot apply later.
    let stalled;
    await page.route('**/image-palette.worker-*.js', route => { stalled = route; });
    await upload.setInputFiles(photo);
    await expect.poll(() => Boolean(stalled)).toBe(true);
    await page.getByRole('button', {name:'Cancel photo'}).click();
    await expect(upload).toBeFocused(); await expect(use).toHaveCount(0);
    await page.unroute('**/image-palette.worker-*.js');
    await stalled.abort().catch(() => {});
    await upload.setInputFiles({name:'white.png',mimeType:'image/png',buffer:await makeImage('white')});
    await expect(page.locator('.photo-swatches li')).toHaveCount(1);
    await page.getByRole('button', {name:'Remove photo'}).click();
    expect(outgoing).toEqual([]); // File, pixel data, and choosing colors never issue network writes.
    expect(errors).toEqual([]);
    console.log(`PASS ${engine.name()}: selection, preview, accents, size, apply, single-color, invalid/oversized/transparent, cancel/retry/remove, focus, local save/reload, no photo writes or external requests, responsive light/dark screenshots.`);
  } finally { await browser.close(); }
}
