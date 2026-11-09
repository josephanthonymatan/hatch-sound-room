import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, selectImagePalette } from '../src/components/image-palette.ts';
import { rgbToOklch } from 'colorthief/internals';

function image(pixel, width = 100, height = 100) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(pixel(i % width, Math.floor(i / width), i), i * 4);
  return [data, width, height];
}
const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16));
const candidate = (hex, share) => {
  const { l, c, h } = rgbToOklch(...rgb(hex));
  return { hex, share, lab: [l, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)] };
};

test('character preserves a small red subject and blue sky in a largely beige photograph', () => {
  const input = image((x, y, i) => {
    const base = y < 3 ? [255, 82, 101] : y < 8 ? [87, 154, 195] : [225 + y / 12, 208 + y / 13, 180 + y / 14];
    return [...base.map(value => value + (i * 17 % 9) - 4), 255];
  });
  const analysis = analyzeImage(...input), colors = selectImagePalette(analysis, 5);
  const values = colors.map(color => rgb(color.hex));
  assert.ok(values.some(([r,g,b]) => r > g * 1.7 && r > b * 1.7), JSON.stringify(colors));
  assert.ok(values.some(([r,g,b]) => b > r * 1.5 && b > g), JSON.stringify(colors));
  assert.ok(colors[0].share > .5, 'The background remains the anchor');
  assert.deepEqual(analyzeImage(...input), analysis, 'Extraction is deterministic');
});

test('bright solid and monochrome images retain their tones without fabricating swatches', () => {
  for (const value of [160, 200, 255]) {
    const colors = selectImagePalette(analyzeImage(...image(() => [value, value, value, 255])), 7);
    assert.equal(colors.length, 1);
    assert.deepEqual(rgb(colors[0].hex), [value, value, value]);
    assert.ok(Math.abs(colors[0].share - 1) < .00001);
  }
  const colors = selectImagePalette(analyzeImage(...image((x, y) => [y * 2.55, y * 2.55, y * 2.55, 255])), 5);
  assert.ok(colors.length >= 3);
  assert.ok(colors.every(color => rgb(color.hex).every(value => value > 128)));
  assert.ok(colors.every(color => Math.max(...rgb(color.hex)) - Math.min(...rgb(color.hex)) < 12));
});

test('transparent pixels never become the palette, including hidden RGB values', () => {
  const colors = analyzeImage(...image((x, y) => y < 95 ? [255, 0, 0, 0] : [80, 210, 160, 255]));
  assert.equal(colors.length, 1);
  assert.equal(colors[0].hex, '#50d2a0');
  assert.throws(() => analyzeImage(...image(() => [255, 20, 0, 0])), /transparent/);
  assert.throws(() => analyzeImage(new Uint8ClampedArray(4), 1000, 1000), /sampled/);
});

test('near duplicates merge, tiny noise is rejected, and palette size is a maximum', () => {
  const colors = analyzeImage(...image((x, y, i) => i < 4 ? [0, 255, 0, 255] : [230 + i % 3, 215, 190, 255]));
  assert.equal(selectImagePalette(colors, 7).length, 1);
});

test('character protects distinct accents that population-only selection omits', () => {
  const candidates = [
    candidate('#aaaaaa', .48), candidate('#959595', .24),
    candidate('#ededed', .25), candidate('#ff5265', .03),
  ];
  assert.ok(selectImagePalette(candidates, 3, 'character').some(c => c.hex === '#ff5265'));
  assert.ok(!selectImagePalette(candidates, 3, 'dominant').some(c => c.hex === '#ff5265'));
  for (const count of [3,5,7]) assert.ok(selectImagePalette(candidates, count).length <= count);
});

test('a small bright color family survives many shades of foliage and sky', () => {
  const candidates = [
    candidate('#6caa51', .25), candidate('#90b075', .20), candidate('#aaca91', .18),
    candidate('#67befc', .17), candidate('#62a7f9', .14), candidate('#ded5cb', .054),
    candidate('#ff5265', .006),
  ];
  assert.ok(selectImagePalette(candidates, 5).some(color => color.hex === '#ff5265'));
});

const excluded = ['#000000','#101820','#404040','#808080','#000080','#202060','#234f80','#8b4513','#a0522d','#a52a2a','#b8860b','#cd853f','#c19a6b','#bc8f8f','#d2b48c','#deb887'];
test('black, navy, shadows and medium browns are excluded in both modes at every size', () => {
  for (const hex of excluded) assert.throws(() => analyzeImage(...image(() => [...rgb(hex),255])), /No bright colors/);
  const mixed = [...excluded.map(hex => candidate(hex, .95 / excluded.length)), candidate('#ff8800', .05)];
  for (const mode of ['character','dominant']) for (const count of [3,5,7]) {
    assert.deepEqual(selectImagePalette(mixed,count,mode).map(c => c.hex), ['#ff8800']);
  }
});

test('a tiny bright subject survives a photograph that is almost entirely shadow', () => {
  const colors = analyzeImage(...image((x,y,i) => i < 10 ? [255,136,0,255] : [...rgb(excluded[i % excluded.length]),255]));
  assert.equal(colors.length,1);
  assert.equal(colors[0].hex,'#ff8800');
  assert.ok(Math.abs(colors[0].share-1)<.00001);
});

test('bright oranges, reds, blues, greens, pastels and white stay available', () => {
  for (const hex of ['#ff8800','#ff0000','#ffbf00','#579ac3','#67befc','#50d2a0','#ff5265','#e0c7a1','#ffffff']) {
    const colors=analyzeImage(...image(() => [...rgb(hex),255]));
    assert.equal(colors[0].hex,hex);
    assert.equal(selectImagePalette(colors)[0].hex,hex);
  }
});
