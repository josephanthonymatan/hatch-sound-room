// Only runs against the disposable fake-device preview.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base='http://127.0.0.1:4183', evidence=new URL('../../private/palette-qa/',import.meta.url).pathname;
const colors=['#334217','#2E2D1C','#9C8734','#DCC235','#C3A76D','#DDECF1','#B3C3C1','#196B96'].map(s=>s.toLowerCase());
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:393,height:852},reducedMotion:'reduce'});
const page=await context.newPage(), errors=[], mutations=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.method()!=='GET')mutations.push(r.url());});
try {
 await mkdir(evidence,{recursive:true});
 await context.request.post(base+'/auth/login',{headers:{Origin:base},data:{email:'preview@example.test',password:'preview-only'}});
 await page.goto(base+'/?tab=lights');
 await page.getByRole('button',{name:'More Options',exact:true}).click();
 const input=page.getByRole('textbox',{name:'Paste Hex Colors'});
 for (const sep of ['\n',',','\t']) {
  await input.fill(colors.join(sep)); await page.getByRole('button',{name:'Use Colors',exact:true}).click();
  await expect(page.getByRole('button',{name:'Flow',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.locator('.light-palette input').evaluateAll(ns=>ns.map(n=>n.value))).toEqual(colors);
 }
 expect(mutations).toEqual([]);
 await input.fill('#334217, broken'); await page.getByRole('button',{name:'Use Colors',exact:true}).click();
 await expect(input).toBeFocused(); await expect(input).toHaveAttribute('aria-invalid','true');
 await expect(page.getByRole('alert')).toContainText('Color 2 is invalid');
 expect(await page.locator('.light-palette input').evaluateAll(ns=>ns.map(n=>n.value))).toEqual(colors);
 await input.fill(Array(33).fill('#ffffff').join(',')); await page.getByRole('button',{name:'Use Colors',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('2–32');
 await input.fill(colors.join('\n')); await page.getByRole('button',{name:'Use Colors',exact:true}).click();
 await page.getByRole('button',{name:'Save Preset',exact:true}).click();
 await page.getByRole('textbox',{name:'Preset Name'}).fill('Imported colors'); await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.reload(); await page.getByRole('button',{name:'Imported colors',exact:true}).click();
 expect(await page.locator('.light-palette input').evaluateAll(ns=>ns.map(n=>n.value))).toEqual(colors);
 await page.getByRole('button',{name:'More Options',exact:true}).click();
 await expect(page.getByRole('button',{name:'Animate preview'})).toBeDisabled();
 for (const width of [320,393,1280]) {
  await page.setViewportSize({width,height:852});
  for(const colorScheme of ['light','dark']) {
   await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`${evidence}${width}-${colorScheme}.png`,fullPage:true});
  }
 }
 await page.getByRole('textbox',{name:'Paste Hex Colors'}).fill(Array(32).fill('#334217').join('\t'));
 await page.getByRole('button',{name:'Use Colors',exact:true}).click();
 await expect(page.locator('.light-palette input')).toHaveCount(32);
 const request=page.waitForRequest(r=>r.url().endsWith('/api/hatch/light-sequence')&&r.method()==='POST');
 await page.getByRole('button',{name:'Play on Hatch',exact:true}).click();
 const sent=await request; expect(sent.postDataJSON().stops).toHaveLength(32);
 await expect(page.getByRole('button',{name:'Stop Motion',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Stop Motion',exact:true}).click();
 expect(errors).toEqual([]);
 console.log('PASS CSV/TSV/newline import, eight ordered swatches, Flow selection, inline errors with focus and palette preservation, 32-color fake playback, save/reload, light/dark layouts at 320/393/1280, reduced motion, no page errors; import sends no device commands.');
} finally { await browser.close(); }
