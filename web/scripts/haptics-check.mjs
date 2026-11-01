// Run only against cloud/test/preview.mjs: never the real controller.
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = 'http://127.0.0.1:4183';
const evidence = new URL('../../private/haptics/', import.meta.url);
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch();
try {
  for (const supported of [true, false]) {
    const context = await browser.newContext({viewport:{width:393,height:852}});
    await context.addInitScript(supported => {
      window.pulses = [];
      Object.defineProperty(navigator, 'vibrate', { configurable:true, value: supported ? pattern => { if (pattern !== 0) window.pulses.push(pattern); return true; } : undefined });
    }, supported);
    const page = await context.newPage();
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    const count=()=>page.evaluate(()=>window.pulses.length);
    const clear=()=>page.evaluate(()=>{window.pulses=[];});
    await page.goto(base);
    await page.getByLabel('Hatch Account Email', {exact:true}).fill('preview@example.test');
    await page.getByLabel('Password', {exact:true}).fill('preview-only');
    expect(await count()).toBe(0);
    await page.getByRole('button',{name:'Open Sound Room',exact:true}).click();
    await page.getByLabel('More Room Actions').waitFor();
    if(supported) expect(await count()).toBeGreaterThan(1);
    const open=async()=>{
      await page.getByLabel('More Room Actions').click();
      await page.getByRole('link',{name:'Touch Feedback',exact:true}).click();
      await page.getByRole('dialog').waitFor();
    };
    await open();
    await page.getByRole('button',{name:'Off',exact:true}).click();
    await clear();
    await expect(page.getByRole('button',{name:'Test Touch Feedback'})).toBeDisabled();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    expect(await count()).toBe(0);
    await page.reload();
    await open();
    await expect(page.getByRole('button',{name:'Off',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(await count()).toBe(0);
    await page.getByRole('button',{name:'Automatic',exact:true}).click();
    await page.emulateMedia({reducedMotion:'reduce'});
    await clear();
    await page.getByRole('button',{name:'Test Touch Feedback'}).click();
    expect(await count()).toBe(0);
    await page.getByRole('button',{name:'On',exact:true}).click();
    await clear();
    const test=page.getByRole('button',{name:'Test Touch Feedback'});
    await test.click();
    if(supported) expect(await count()).toBe(1);
    await page.waitForTimeout(180);
    await clear();
    await test.focus(); await page.keyboard.press('Enter');
    if(supported) expect(await count()).toBe(1);
    for(const [width,colorScheme] of [[320,'light'],[393,'dark'],[1280,'light']]) {
      await page.setViewportSize({width,height:852}); await page.emulateMedia({colorScheme});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:new URL(`${supported?'vibration':'fallback'}-${width}-${colorScheme}.png`,evidence).pathname});
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link',{name:'Light',exact:true}).click();
    await page.getByRole('button',{name:'Save Preset',exact:true}).click();
    await page.getByLabel('Preset Name').fill('Haptics fixture');
    await clear();
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.getByText('Preset saved.',{exact:true})).toBeVisible();
    if(supported) expect(await page.evaluate(()=>window.pulses.some(p=>p.length>2))).toBe(true);
    await clear();
    await page.getByRole('button',{name:'Apply Color',exact:true}).click();
    await expect(page.getByText('Color sent to Hatch.',{exact:true})).toBeVisible();
    if(supported) expect(await page.evaluate(()=>window.pulses.some(p=>p.length>2))).toBe(true);
    await expect(page.getByRole('button',{name:'Apply Color',exact:true})).toBeEnabled();
    await page.route('**/api/hatch/light', route=>route.fulfill({status:503,json:{error:'Fixture unavailable'}}));
    await clear();
    await page.getByRole('button',{name:'Apply Color',exact:true}).click();
    await expect(page.getByText(/The command’s result was uncertain/)).toBeVisible();
    if(supported) expect(await page.evaluate(()=>window.pulses.some(p=>p.length>5))).toBe(true);
    await page.waitForTimeout(180); await clear();
    await page.waitForTimeout(4200); // background state polling stays silent
    expect(await count()).toBe(0);
    expect(errors).toEqual([]);
    console.log(`PASS ${supported?'Vibration API':'fallback'}: auth, settings persistence, reduced motion, keyboard, modal, local save, fake-device success/error, silent polling, 320/393/1280px.`);
    await context.close();
  }
} finally {await browser.close();}
