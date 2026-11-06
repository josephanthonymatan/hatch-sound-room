import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, selectImagePalette } from '../src/components/image-palette.ts';

function image(pixel, width = 100, height = 100) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(pixel(i % width, Math.floor(i / width), i), i * 4);
  return [data, width, height];
}
const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16));

test('character preserves a small red subject and blue sky in a largely beige photograph', () => {
  const input = image((x, y, i) => {
    const base = y < 3 ? [175, 35, 40] : y < 8 ? [65, 132, 184] : [193 + y / 6, 177 + y / 7, 151 + y / 8];
    return [...base.map(value => value + (i * 17 % 9) - 4), 255];
  });
  const analysis = analyzeImage(...input), colors = selectImagePalette(analysis, 5);
  const values = colors.map(color => rgb(color.hex));
  assert.ok(values.some(([r,g,b]) => r > g * 1.7 && r > b * 1.7), JSON.stringify(colors));
  assert.ok(values.some(([r,g,b]) => b > r * 1.5 && b > g), JSON.stringify(colors));
  assert.ok(colors[0].share > .5, 'The background remains the anchor');
  assert.deepEqual(analyzeImage(...input), analysis, 'Extraction is deterministic');
});

test('solid, white and monochrome images stay honest rather than fabricating swatches', () => {
  for (const value of [0, 128, 255]) {
    const colors = selectImagePalette(analyzeImage(...image(() => [value, value, value, 255])), 7);
    assert.equal(colors.length, 1);
    assert.deepEqual(rgb(colors[0].hex), [value, value, value]);
    assert.ok(Math.abs(colors[0].share - 1) < .00001);
  }
  const colors = selectImagePalette(analyzeImage(...image((x, y) => [y * 2.55, y * 2.55, y * 2.55, 255])), 5);
  assert.ok(colors.length >= 3);
  assert.ok(colors.every(color => Math.max(...rgb(color.hex)) - Math.min(...rgb(color.hex)) < 12));
});

test('transparent pixels never become the palette, including hidden RGB values', () => {
  const colors = analyzeImage(...image((x, y) => y < 95 ? [255, 0, 0, 0] : [20, 100, 60, 255]));
  assert.equal(colors.length, 1);
  assert.equal(colors[0].hex, '#14643c');
  assert.throws(() => analyzeImage(...image(() => [255, 20, 0, 0])), /transparent/);
  assert.throws(() => analyzeImage(new Uint8ClampedArray(4), 1000, 1000), /sampled/);
});

test('near duplicates merge, tiny noise is rejected, and palette size is a maximum', () => {
  const colors = analyzeImage(...image((x, y, i) => i < 4 ? [0, 255, 0, 255] : [180 + i % 3, 160, 140, 255]));
  assert.equal(selectImagePalette(colors, 7).length, 1);
});

test('character protects distinct accents that population-only selection omits', () => {
  const candidates = [
    {hex:'#999999',share:.48,lab:[.65,0,0]},
    {hex:'#555555',share:.24,lab:[.42,0,0]},
    {hex:'#dddddd',share:.25,lab:[.90,0,0]},
    {hex:'#cf3542',share:.03,lab:[.6,.21,.08]},
  ];
  assert.ok(selectImagePalette(candidates, 3, 'character').some(c => c.hex === '#cf3542'));
  assert.ok(!selectImagePalette(candidates, 3, 'dominant').some(c => c.hex === '#cf3542'));
  for (const count of [3,5,7]) assert.ok(selectImagePalette(candidates, count).length <= count);
});

test('a small isolated color family survives many shades of foliage and sky', () => {
  const candidates = [
    {hex:'#455639',share:.25,lab:[.43,-.034,.037]},
    {hex:'#233817',share:.20,lab:[.31,-.043,.043]},
    {hex:'#3f681f',share:.18,lab:[.47,-.078,.081]},
    {hex:'#67befc',share:.17,lab:[.77,-.058,-.108]},
    {hex:'#62a7f9',share:.14,lab:[.72,-.039,-.134]},
    {hex:'#ded5cb',share:.054,lab:[.87,.006,.016]},
    {hex:'#992a3d',share:.006,lab:[.46,.141,.039]},
  ];
  assert.ok(selectImagePalette(candidates, 5).some(color => color.hex === '#992a3d'));
});
