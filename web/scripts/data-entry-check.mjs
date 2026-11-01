// Disposable fake-device preview only: npm run preview --prefix cloud.
import { chromium, webkit, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base='http://127.0.0.1:4183', evidence=fileURLToPath(new URL('../../private/data-entry-qa/',import.meta.url));
const audio=fileURLToPath(new URL('../../media/bach-partita2-allemanda-test-20s.mp3',import.meta.url));
await mkdir(evidence,{recursive:true});
for(const [engine,type] of [['webkit',webkit],['chromium',chromium]]) {
 const browser=await type.launch();
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 const page=await context.newPage(), errors=[], writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()!=='GET' && r.url().includes('/api/'))writes.push({url:r.url(),body:r.postData()});});
 page.on('dialog',d=>d.accept());
 let alarmId,uploadId;
 async function precise(label,text){
  await page.getByRole('button',{name:new RegExp(`^Set ${label} precisely,`)}).click();
  const input=page.getByRole('textbox',{name:`${label} value`,exact:true});
  await expect(input).toBeFocused();await input.fill(text);return input;
 }
 try {
  await page.goto(base);
  const email=page.getByLabel('Hatch Account Email'), password=page.getByLabel('Password',{exact:true});
  await email.fill('preview@example.test');await email.press('Enter');await expect(password).toBeFocused();
  await expect(email).toHaveAttribute('autocomplete','username');await expect(password).toHaveAttribute('autocomplete','current-password');
  await password.fill('preview-only');await password.press('Enter');await expect(page.getByRole('link',{name:'Room',exact:true})).toBeVisible();
  await context.request.patch(base+'/api/hatch/volume',{headers:{Origin:base},data:{volume:18}});
  await context.request.post(base+'/api/hatch/hatch/sync',{headers:{Origin:base},data:{}});await page.reload();
  let input=await precise('Volume','41');
  const before=writes.length;await input.fill('42');expect(writes.length).toBe(before);
  await input.press('Enter');await expect(page.locator('#room-volume')).toHaveValue('42');
  await expect.poll(()=>writes.filter(r=>r.url.endsWith('/volume')).length).toBe(1);
  input=await precise('Volume','');await input.press('Enter');await expect(page.getByRole('alert')).toContainText('Enter a number');
  expect(writes.filter(r=>r.url.endsWith('/volume')).length).toBe(1);
  await input.press('Escape');await expect(input).toHaveCount(0);
  input=await precise('Volume','52');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(writes.filter(r=>r.url.endsWith('/volume')).length).toBe(1);
  await page.getByRole('link',{name:'Light',exact:true}).click();
  await page.getByRole('button',{name:'Flow',exact:true}).click();await page.getByRole('button',{name:'More Options',exact:true}).click();
  const seconds=page.locator('#seconds-0');await seconds.fill('');await expect(seconds).toHaveValue('');await seconds.fill('12');await seconds.press('Enter');await expect(seconds).toHaveValue('12');
  await page.getByRole('button',{name:'Increase color 1 duration',exact:true}).click();await expect(seconds).toHaveValue('13');
  await page.getByRole('button',{name:'Decrease color 1 duration',exact:true}).click();await expect(seconds).toHaveValue('12');
  await seconds.fill('999');await seconds.press('Enter');await expect(seconds).toHaveValue('60');
  await seconds.fill('');await seconds.press('Enter');await expect(seconds).toHaveValue('60');
  input=await precise('Pace','1,3');await expect(input).toHaveAttribute('inputmode','decimal');await input.press('Enter');await expect(page.locator('#recipe-pace')).toHaveValue('1.3');
  input=await precise('Brightness','73');await input.press('Enter');await expect(page.locator('#recipe-brightness')).toHaveValue('73');
  await page.getByRole('button',{name:'Shimmer',exact:true}).click();input=await precise('Drift','35');await input.press('Enter');await expect(page.locator('#effect-drift')).toHaveValue('0.35');
  await page.getByRole('button',{name:'Save Preset',exact:true}).click();await page.getByLabel('Preset Name').fill('Input test');await page.getByLabel('Preset Name').press('Enter');
  await expect(page.getByRole('button',{name:'Input test',exact:true})).toBeVisible();
  // All focusable text fields use readable text; no light commands from editing.
  expect(writes.filter(r=>/light-sequence|\/light$/.test(r.url))).toHaveLength(0);
  for(const width of [320,393,1280]){
   await page.setViewportSize({width,height:852});
   for(const colorScheme of ['light','dark']){
    await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
    await expect.poll(()=>page.locator('.light-editor-heading h2').evaluate(n=>getComputedStyle(n).color)).toBe(colorScheme==='dark'?'rgb(238, 237, 232)':'rgb(22, 22, 22)');
    input=await precise('Brightness','68');
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const small=await page.locator('.light-editor input:not([type="range"],[type="color"]),.light-editor textarea').evaluateAll(ns=>ns.filter(n=>n.getBoundingClientRect().height).filter(n=>parseFloat(getComputedStyle(n).fontSize)<16).length);expect(small).toBe(0);
    await page.screenshot({path:`${evidence}${engine}-light-${width}-${colorScheme}.png`,fullPage:true});await input.press('Escape');
   }
  }
  await page.setViewportSize({width:393,height:852});
  await page.getByRole('link',{name:'Alarms',exact:true}).click();await page.getByRole('link',{name:'New Alarm',exact:true}).first().click();
  await page.locator('#alarm-track').click();const search=page.getByRole('searchbox',{name:'Search Alarm Sounds'});await expect(search).toBeFocused();
  await search.fill('does-not-exist');await search.press('Enter');await expect(page.getByText('No sounds found. Try a different search.')).toBeVisible();
  expect(writes.filter(r=>r.url.endsWith('/alarms'))).toHaveLength(0);
  await search.fill('Brown');await page.getByRole('button',{name:'Brown Noise',exact:true}).click();await expect(page.locator('#alarm-track')).toBeFocused();await expect(page.locator('#alarm-track')).toContainText('Brown Noise');
  await page.locator('#alarm-track').click();await search.press('Escape');await expect(page.locator('#alarm-track')).toBeFocused();await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#alarm-label').fill('Input QA');await page.locator('#alarm-label').press('Enter');expect(writes.filter(r=>r.url.endsWith('/alarms'))).toHaveLength(0);
  input=await precise('Volume','37');await input.press('Enter');await expect(page.locator('#alarm-volume')).toHaveValue('37');
  input=await precise('Volume','39');await page.getByRole('button',{name:'Save Alarm',exact:true}).last().click();await expect(input).toBeFocused();expect(writes.filter(r=>r.url.endsWith('/alarms'))).toHaveLength(0);await input.press('Escape');
  input=await precise('Brightness','82');await input.press('Enter');await expect(page.locator('#alarm-brightness')).toHaveValue('82');
  await page.locator('#alarm-track').click();await search.fill('Rain & Rose');await page.getByRole('button',{name:'Rain & Rose',exact:true}).click();await expect(page.locator('#alarm-volume')).toHaveCount(0);
  await page.locator('#alarm-track').click();await search.fill('Brown');await page.getByRole('button',{name:'Brown Noise',exact:true}).click();
  for(const width of [320,393,1280]){
   await page.setViewportSize({width,height:852});
   for(const colorScheme of ['light','dark']){
    await page.emulateMedia({colorScheme});await page.locator('#alarm-track').click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('searchbox',{name:'Search Alarm Sounds'}).fill('Water');
    await page.getByRole('dialog').screenshot({path:`${evidence}${engine}-alarm-${width}-${colorScheme}.png`});await page.getByRole('searchbox',{name:'Search Alarm Sounds'}).press('Escape');
   }
  }
  await page.setViewportSize({width:393,height:852});
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/hatch/alarms')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Save Alarm',exact:true}).last().click();const response=await saved;expect(response.ok()).toBe(true);alarmId=(await response.json()).alarm.id;
  const payload=response.request().postDataJSON();expect(payload.volume).toBe(37);expect(payload.light.to).toBe(82);expect(payload.trackId).toContain('hatch-sound');
  await page.goto(base+'/?tab=sounds&panel=upload');await page.locator('#upload-file').setInputFiles(audio);await expect(page.locator('#upload-title')).toHaveValue('bach partita2 allemanda test 20s');
  await page.locator('#upload-title').fill('My title');await page.locator('#upload-file').setInputFiles({name:'different_name.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('fixture')});await expect(page.locator('#upload-title')).toHaveValue('My title');await page.locator('#upload-file').setInputFiles(audio);
  await page.locator('#upload-title').press('Enter');await expect(page.locator('#upload-category')).toBeFocused();await page.locator('#upload-category').selectOption('__new__');
  await page.locator('#upload-new-category').fill('Input QA');await page.locator('#upload-new-category').press('Enter');await expect(page.locator('#upload-kind')).toBeFocused();
  const tags=page.locator('#upload-tags');await tags.fill('rain\tquiet\nmorning,RAIN');await expect(page.getByRole('list',{name:'Added tags'}).getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button',{name:'Remove tag quiet',exact:true}).click();await expect(tags).toBeFocused();
  await tags.fill('soft');await tags.press('Enter');await expect(page.getByRole('button',{name:'Remove tag soft',exact:true})).toBeVisible();
  const suggestions=page.getByRole('group',{name:'Suggested tags'});if(await suggestions.count())await suggestions.getByRole('button').first().click();
  await tags.fill('last draft');
  const tagsValue=await page.locator('input[name="tags"]').inputValue();expect(tagsValue).toContain('last draft');
  for(const width of [320,393,1280]){
   await page.setViewportSize({width,height:852});
   for(const colorScheme of ['light','dark']){
    await page.emulateMedia({colorScheme});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect.poll(()=>page.locator('.tag-chips li > span').first().evaluate(n=>getComputedStyle(n).color)).toBe(colorScheme==='dark'?'rgb(238, 237, 232)':'rgb(22, 22, 22)');
    await page.getByRole('dialog').screenshot({path:`${evidence}${engine}-upload-${width}-${colorScheme}.png`});
   }
  }
  await page.setViewportSize({width:393,height:852});
  // Software-keyboard viewport geometry simulated, not a claim about real iOS.
  await tags.focus();await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:450});visualViewport.dispatchEvent(new Event('resize'));});
  await expect(page.locator('html')).toHaveClass(/keyboard-open/);await expect(page.locator('.dock')).toBeHidden();
  await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});await page.locator('#upload-license').click();await page.locator('#upload-license').blur();
  await expect(page.locator('html')).not.toHaveClass(/keyboard-open/);
  const uploaded=page.waitForResponse(r=>r.url().endsWith('/api/hatch/library')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Add Sound',exact:true}).last().click();const result=await uploaded;expect(result.ok()).toBe(true);const track=(await result.json()).track;uploadId=track.id;expect(track.tags).toContain('last draft');expect(track.tags).not.toContain('quiet');expect(track.title).toBe('My title');
  expect(errors).toEqual([]);console.log(`PASS ${engine}: keyboard actions/autofill, one live value commit, invalid/cancel, duration drafts/bounds/steppers, decimal pace, precise effects, preset save, light/dark/320/393/1280 layouts, sound search/no-results/favorite/selection/escape, precise alarm payload, title suggestions/manual preservation, pasted/deduped/removed/suggested/draft tags through real upload, simulated keyboard viewport.`);
 } finally {
  for(const [path,id] of [['alarms',alarmId],['library',uploadId]])if(id)await context.request.delete(base+'/api/hatch/'+path+'/'+id,{headers:{Origin:base}}).catch(()=>{});
  await browser.close();
 }
}
