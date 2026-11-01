import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightRecipes, parsePalette, previewFrame, validRecipe } from '../src/components/light-recipes.ts';

test('catalog recipes validate and imported presets reject malformed or excessive values', () => {
  for (const recipe of lightRecipes) assert.equal(validRecipe(recipe), true);
  for (const patch of [{stops:[]},{stops:[{color:'url(x)',seconds:4},{color:'#ffffff',seconds:3}]},{brightness:Infinity},{pace:0},{motion:'flash'},{title:'  '},{stops:Array(33).fill({color:'#ffffff',seconds:4})}]) assert.equal(validRecipe({...lightRecipes[0],...patch}), false);
});
test('flow crosses each stop boundary and loops without escaping the palette', () => {
  const recipe=lightRecipes[0];
  assert.equal(previewFrame(recipe,0).index,0);
  assert.equal(previewFrame(recipe,3).index,1);
  assert.equal(previewFrame(recipe,29).index,0);
  assert.equal(previewFrame({...recipe,pace:2},6).index,1);
  for(let t=0;t<90;t+=.13){const f=previewFrame(recipe,t);assert.ok(f.index>=0&&f.next<6);assert.ok(f.blend>=0&&f.blend<=1);assert.equal(f.intensity,.5);}
});
test('steady holds the first color; breathing stays within requested brightness',()=>{
  const recipe=lightRecipes[1];
  for(const t of [0,2,10,25]){const f=previewFrame({...recipe,motion:'steady'},t);assert.equal(f.index,0);assert.equal(f.blend,0);}
  for(let t=0;t<45;t+=.1){const f=previewFrame(recipe,t);assert.ok(f.intensity>=.35*.55&&f.intensity<=.35);}
});

test('fast custom presets still progress at the device timing floor', () => {
  const recipe={...lightRecipes[0],nativeLightId:undefined,pace:.5,stops:[{color:'#ff0000',seconds:1},{color:'#0000ff',seconds:1}]};
  assert.equal(previewFrame(recipe,0).index,0);
  assert.equal(previewFrame(recipe,2).blend,.5);
  assert.equal(previewFrame(recipe,4).index,1);
  assert.equal(previewFrame(recipe,8).index,0);
});

const sample = ['#334217','#2E2D1C','#9C8734','#DCC235','#C3A76D','#DDECF1','#B3C3C1','#196B96'];
test('palette import preserves all eight colors and order across spreadsheet and line separators', () => {
  for (const separator of [',', '\t', '\n', '\r\n', ',\t\n']) {
    const colors = parsePalette('  ' + sample.join(separator) + '\n');
    assert.deepEqual(colors, sample.map(s => s.toLowerCase()));
    assert.equal(validRecipe({...lightRecipes[0],stops:colors.map(color=>({color,seconds:6}))}), true);
  }
  assert.deepEqual(parsePalette('"#AbC", 123456, #abc'), ['#aabbcc','#123456','#aabbcc']);
  assert.equal(parsePalette(Array(32).fill('#ffffff').join(',')).length,32);
});
test('palette import rejects invalid, empty, single and over-limit lists without dropping invalid cells', () => {
  for (const input of ['', '#334217', '#334217,red', '#334217,#12345', '#334217,#12345678', '#334217,url(x)', Array(33).fill('#ffffff').join(',')]) assert.throws(()=>parsePalette(input));
});
