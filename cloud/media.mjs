import Busboy from 'busboy';
import { categoryName } from './categories.mjs';
import { createWriteStream, createReadStream, constants } from 'node:fs';
import { chmod, copyFile, mkdir, open, readFile, rename, stat, statfs, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capability, fail, HttpError, text } from './core.mjs';

const maxBytes = 50 * 1024 * 1024;
export const libraryQuota = 750 * 1024 * 1024;
const diskReserve = 128 * 1024 * 1024, maxNormalizedBytes = 32 * 1024 * 1024;
export async function checkStorage(store, directory, { includeInput = true, outputBytes = maxNormalizedBytes } = {}) {
  const used = (await Promise.all(store.value.tracks.map(async track => track.bytes ?? (await stat(mediaPath(directory, track.filename))).size))).reduce((sum, size) => sum + size, 0);
  if (used + outputBytes > libraryQuota) fail('The 750 MiB audio library quota is full. Remove unused uploads before adding another track.', 409);
  const filesystem = await statfs(directory);
  const available = filesystem.bavail * filesystem.bsize;
  if (available < diskReserve + outputBytes + (includeInput ? maxBytes : 0)) fail('Storage is low. Free space or increase the persistent disk; 128 MiB is reserved for durable alarms.', 409);
  return used;
}
export const publicTrack = track => Object.fromEntries(['id', 'title', 'kind', 'category', 'durationSeconds', 'source', 'license', 'tags', 'createdAt', 'cover'].filter(key => track[key] !== undefined).map(key => [key, track[key]]));
export function mediaPath(directory, filename) {
  if (!/^[a-f\d-]{36}\.mp3$/.test(filename)) throw new Error('Invalid stored media name.');
  return path.join(directory, 'media', filename);
}
async function syncMedia(filename, directory) {
  await chmod(filename, 0o600);
  const file = await open(filename, 'r');
  try { await file.sync(); } finally { await file.close(); }
  const folder = await open(path.join(directory, 'media'), 'r');
  try { await folder.sync(); } finally { await folder.close(); }
}
export async function seedLibrary(store, directory) {
  await mkdir(path.join(directory, 'media'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(directory, 'tmp'), { recursive: true, mode: 0o700 });
  if (store.value.tracks.some(track => track.id === 'bach-allemanda')) return;
  const metadata = JSON.parse(await readFile(new URL('../media/bach-partita2-allemanda.metadata.json', import.meta.url), 'utf8'));
  const filename = randomUUID() + '.mp3';
  await copyFile(fileURLToPath(new URL('../media/bach-partita2-allemanda-full.mp3', import.meta.url)), mediaPath(directory, filename), constants.COPYFILE_EXCL);
  await syncMedia(mediaPath(directory, filename), directory);
  store.change(state => state.tracks.push({
    id: 'bach-allemanda', title: metadata.title, kind: 'music', durationSeconds: metadata.full_preparation.duration_seconds,
    source: metadata.source_page, license: `${metadata.license}; ${metadata.license_url}`, tags: ['Bach', 'violin', 'classical'],
    createdAt: new Date().toISOString(), cover: 'bach', bytes: metadata.full_preparation.bytes, filename, audioCapability: capability(), seeded: true,
  }));
}
export function runProcess(executable, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'ignore'], shell: false });
    let output = '', settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new HttpError(422, 'Audio processing timed out; try a shorter file.')); }, timeout);
    child.stdout.on('data', part => { output += part; if (output.length > 524288) { child.kill('SIGKILL'); finish(new HttpError(422, 'Audio metadata exceeded the allowed size.')); } });
    child.on('error', () => finish(new HttpError(503, 'Audio processing is unavailable; install ffmpeg and ffprobe on the service.')));
    child.on('close', code => finish(code === 0 ? null : new HttpError(422, 'The audio file could not be decoded. Upload a valid MP3 or WAV file.'), output));
  });
}
export async function normalize(input, output, format) {
  const probe = JSON.parse(await runProcess('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', format, '-i', input, '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json']));
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration < 1 || duration > 1800 || !probe.streams?.some(stream => stream.codec_type === 'audio')) fail('Audio must be between 1 second and 30 minutes long.', 422);
  await runProcess('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', format, '-i', input, '-map', '0:a:0', '-vn', '-t', '1800', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', '-af', 'loudnorm=I=-24:TP=-6:LRA=7,afade=t=in:d=0.5', '-map_metadata', '-1', '-f', 'mp3', output]);
  return Math.round(duration * 1000) / 1000;
}
async function receiveUpload(request, directory) {
  if (Number(request.headers['content-length']) > maxBytes + 65536) fail('Upload exceeds the 50 MiB limit.', 413);
  let parser;
  try { parser = Busboy({ headers: request.headers, limits: { files: 1, fileSize: maxBytes, fields: 5, fieldSize: 4000, parts: 7 } }); }
  catch { fail('Use multipart/form-data with a file field.'); }
  const fields = {}, input = path.join(directory, 'tmp', randomUUID() + '.input');
  let fileSeen = false, format, failure, written = Promise.resolve();
  try {
    await new Promise((resolve, reject) => {
      const record = message => { failure ??= new HttpError(400, message); };
      parser.on('field', (name, value, info) => {
        if (!['title', 'kind', 'category', 'tags', 'license'].includes(name) || Object.hasOwn(fields, name) || info.valueTruncated || info.nameTruncated) record('Upload contains an invalid, duplicate, or oversized field.');
        else fields[name] = value;
      });
      parser.on('file', (name, stream, info) => {
        if (name !== 'file' || fileSeen) { stream.resume(); record('Upload exactly one file named file.'); return; }
        fileSeen = true;
        const extension = path.extname(info.filename ?? '').toLowerCase();
        if (!['.mp3', '.wav'].includes(extension)) { stream.resume(); record('Only MP3 and WAV files are supported.'); return; }
        format = extension.slice(1);
        stream.on('limit', () => { failure = new HttpError(413, 'Upload exceeds the 50 MiB limit.'); });
        written = pipeline(stream, createWriteStream(input, { flags: 'wx', mode: 0o600 })).catch(error => { failure ??= new HttpError(400, 'Upload did not finish successfully.'); });
      });
      for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit']) parser.on(event, () => record('Upload contains too many files or fields.'));
      parser.on('error', () => reject(new HttpError(400, 'Malformed multipart upload.')));
      request.once('aborted', () => { parser.destroy(); reject(new HttpError(400, 'Upload was interrupted.')); });
      parser.once('close', resolve);
      request.pipe(parser);
    });
    await written;
    if (failure) throw failure;
    if (!fileSeen || !format) fail('Upload an MP3 or WAV file in the file field.');
    return { input, format, fields };
  } catch (error) { await written; await unlink(input).catch(() => {}); throw error; }
}
export async function uploadTrack(request, store, directory, { normalizeAudio = normalize } = {}) {
  if (store.value.tracks.length >= 100) fail('The library is limited to 100 tracks. Remove an unused upload first.', 409);
  await checkStorage(store, directory);
  const { input, format, fields } = await receiveUpload(request, directory);
  const filename = randomUUID() + '.mp3', temporary = path.join(directory, 'tmp', filename), output = mediaPath(directory, filename);
  let committed = false;
  try {
    const title = text(fields.title, 'Title');
    const category = categoryName(fields.category, store.value);
    if (!['music', 'field-recording', 'generated'].includes(fields.kind)) fail('Kind must be music, field-recording, or generated.');
    const license = fields.license === undefined ? 'User supplied; rights not independently verified.' : text(fields.license, 'License', 1000);
    const tags = fields.tags === undefined ? [] : text(fields.tags, 'Tags', 1000, false).split(',').map(tag => tag.trim()).filter(Boolean);
    if (tags.length > 20 || tags.some(tag => tag.length > 60)) fail('Use at most 20 tags of 60 characters each.');
    await checkStorage(store, directory, { includeInput: false });
    const durationSeconds = await normalizeAudio(input, temporary, format);
    const bytes = (await stat(temporary)).size;
    const used = await checkStorage(store, directory, { includeInput: false, outputBytes: 0 });
    if (used + bytes > libraryQuota) fail('The normalized audio would exceed the 750 MiB library quota. Remove an unused upload first.', 409);
    await rename(temporary, output);
    await syncMedia(output, directory);
    const track = { id: randomUUID(), title, category, kind: fields.kind, durationSeconds, source: 'User upload', license, tags: [...new Set(tags)], createdAt: new Date().toISOString(), cover: fields.kind === 'music' ? 'music' : fields.kind === 'field-recording' ? 'recording' : 'noise', bytes, filename, audioCapability: capability() };
    store.change(state => state.tracks.push(track)); committed = true;
    return publicTrack(track);
  } finally {
    await Promise.all([input, temporary, ...(committed ? [] : [output])].map(file => unlink(file).catch(() => {})));
  }
}
export async function serveAudio(request, response, directory, filename) {
  const fullPath = mediaPath(directory, filename);
  let info;
  try { info = await stat(fullPath); } catch { fail('Audio file is unavailable.', 404); }
  let start = 0, end = info.size - 1, status = 200;
  const range = request.headers.range;
  if (range) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!parsed || (!parsed[1] && !parsed[2])) { response.writeHead(416, { 'content-range': `bytes */${info.size}` }); response.end(); return; }
    if (!parsed[1]) start = Math.max(0, info.size - Number(parsed[2]));
    else { start = Number(parsed[1]); if (parsed[2]) end = Math.min(end, Number(parsed[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { response.writeHead(416, { 'content-range': `bytes */${info.size}` }); response.end(); return; }
    status = 206;
  }
  response.writeHead(status, { 'content-type': 'audio/mpeg', 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}) });
  if (request.method === 'HEAD') return response.end();
  try { await pipeline(createReadStream(fullPath, { start, end }), response); } catch { response.destroy(); }
}
