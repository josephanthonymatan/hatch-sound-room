// Only runs against the disposable fake-device preview.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base='http://127.0.0.1:4183', evidence=new URL('../../private/shimmer-qa/',import.meta.url).pathname;
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:393,height:852},permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage(), errors=[], sequences=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('request',r=>{if(r.url().endsWith('/api/hatch/light-sequence')&&r.method()==='POST')sequences.push(r.postDataJSON());});
const light=()=>page.locator('.light-color-layer').evaluate(n=>n.style.getPropertyValue('--light'));
try {
 await mkdir(evidence,{recursive:true});
 await context.request.post(base+'/auth/login',{headers:{Origin:base},data:{email:'preview@example.test',password:'preview-only'}});
 await page.goto(base+'/?tab=lights');
 await page.getByRole('button',{name:'Dynamic',exact:true}).click();
 await page.getByRole('button',{name:'Interlude',exact:true}).click();
 await page.getByRole('button',{name:'Shimmer',exact:true}).click();
 await expect(page.getByRole('button',{name:'Vivid',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('slider',{name:'Drift'})).toHaveValue('0.5');
 await expect(page.getByRole('slider',{name:'Layer'})).toHaveValue('0.6');
 // Preview animates and the color actually changes.
 await page.getByRole('button',{name:'Animate preview'}).click();
 const seen=new Set(); for(let i=0;i<12;i++){seen.add(await light());await page.waitForTimeout(250);}
 expect(seen.size).toBeGreaterThan(3);
 await page.getByRole('button',{name:'Compare',exact:true}).click();
 await expect(page.locator('.light-preview-label')).toHaveText('Without Effects');
 await page.getByRole('button',{name:'Compare',exact:true}).click();
 await expect(page.locator('.light-preview-label')).toHaveText('Preview');
 await page.getByRole('button',{name:'Pause preview'}).click();
 // Editing: keyboard on sliders, blend switch, bloom tint, breathing rhythm.
 await page.getByRole('slider',{name:'Bloom'}).focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('slider',{name:'Bloom'})).toHaveValue('0.25');
 await expect(page.getByRole('group',{name:'Bloom tint'})).toBeVisible();
 await page.getByRole('button',{name:'Spectrum',exact:true}).click();
 await page.getByRole('button',{name:'Breathe',exact:true}).click();
 await page.getByRole('button',{name:'Rhythm',exact:true}).click();
 await expect(page.getByRole('slider',{name:'Breath Length'})).toHaveValue('10');
 await page.getByRole('slider',{name:'Rest on Each Color'}).fill('0');
 await page.getByRole('button',{name:'Play on Hatch',exact:true}).click();
 await expect.poll(()=>sequences.length).toBe(1);
 expect(sequences[0].effects).toEqual({blend:'spectrum',drift:.5,layer:.6,bloom:.25,breath:{seconds:10,depth:.45,inhale:.38}});
 await expect(page.getByRole('button',{name:'Stop Motion',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Stop Motion',exact:true}).click();
 // Effects survive save and reload; Classic with everything off removes them.
 await page.getByRole('button',{name:'Save Preset',exact:true}).click();
 await page.getByRole('textbox',{name:'Preset Name'}).fill('Shimmer test'); await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.reload(); await page.getByRole('button',{name:'Shimmer test',exact:true}).click();
 await page.getByRole('button',{name:'Shimmer',exact:true}).click();
 await expect(page.getByRole('button',{name:'Spectrum',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('slider',{name:'Breath Length'})).toHaveValue('10');
 for (const width of [320,393,1280]) {
  await page.setViewportSize({width,height:852});
  for(const colorScheme of ['light','dark']) {
   await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
   await expect(page.getByRole('button',{name:'Animate preview'})).toBeDisabled();
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`${evidence}${width}-${colorScheme}.png`,fullPage:true});
  }
 }
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('button',{name:'Classic',exact:true}).click();
 await page.getByRole('button',{name:'Per Color',exact:true}).click();
 for (const name of ['Drift','Layer','Bloom']) await page.getByRole('slider',{name}).fill('0');
 await expect(page.getByRole('button',{name:'Compare',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Play on Hatch',exact:true}).click();
 await expect.poll(()=>sequences.length).toBe(2);
 expect(sequences[1].effects).toBeUndefined();
 await page.getByRole('button',{name:'Stop Motion',exact:true}).click();
 await page.getByRole('button',{name:'More Options',exact:true}).click();
 await page.getByRole('button',{name:'Copy Recipe',exact:true}).click();
 await expect(page.locator('.studio-message')).toHaveText('Recipe copied.');
 const copied=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
 expect(copied.title).toBe('Shimmer test'); expect(copied.stops).toHaveLength(5);
 expect(errors).toEqual([]);
 console.log('PASS Copy Recipe, catalog effects, animated preview color changes, Compare, keyboard sliders, blend/bloom/rhythm edits, effect payloads to fake device, save/reload, reduced motion, 320/393/1280 light/dark without overflow, clearing effects restores the classic payload, no page errors.');
} finally { await browser.close(); }
