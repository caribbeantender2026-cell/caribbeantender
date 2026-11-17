/**
 * Back up or install the client's four private Word templates. See README.
 * Installation publishes the download button only after a byte-for-byte readback.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const templates = [
  ['business-requirements', 2, 'caribbeantender-tender-creation-form.docx'],
  ['supplier-proposal', 2, 'caribbeantender-bid-submission-form.docx'],
  ['business-registration', 1, 'caribbeantender-business-registration-form.docx'],
  ['supplier-registration', 1, 'caribbeantender-supplier-registration-form.docx'],
] as const;
const operation = process.argv[2];
if (operation !== 'export' && operation !== 'install') throw new Error('Choose export or install.');
const folder = process.argv[3] ?? 'backups/form-templates';
const url = process.env.TEMPLATE_SUPABASE_URL ?? (operation === 'export' ? process.env.PRODUCTION_SUPABASE_URL : undefined);
const key = process.env.TEMPLATE_SUPABASE_SECRET_KEY ?? (operation === 'export' ? process.env.PRODUCTION_SUPABASE_SECRET_KEY : undefined);
if (!url || !key) throw new Error('Set TEMPLATE_SUPABASE_URL and TEMPLATE_SUPABASE_SECRET_KEY for the intended project.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = client.storage.from('form-templates');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function download(name: string) {
  const file = await bucket.download(name);
  if (file.error) throw file.error;
  const bytes = Buffer.from(await file.data.arrayBuffer());
  if (bytes.readUInt32LE(0) !== 0x04034b50 || !bytes.includes(Buffer.from('word/document.xml'))) {
    throw new Error(`${name} is not a Word document.`);
  }
  return bytes;
}
if (operation === 'export') {
  await mkdir(folder, { recursive: true });
  const checksums: Record<string, string> = {};
  for (const [, , name] of templates) {
    const bytes = await download(name);
    await writeFile(join(folder, name), bytes);
    checksums[name] = digest(bytes);
  }
  await writeFile(join(folder, 'sha256.json'), JSON.stringify(checksums, null, 2));
} else {
  const checksums = JSON.parse(await readFile(join(folder, 'sha256.json'), 'utf8')) as Record<string, string>;
  for (const [key, version, name] of templates) {
    const bytes = await readFile(join(folder, name));
    if (digest(bytes) !== checksums[name]) throw new Error(`Backup checksum mismatch for ${name}.`);
    const uploaded = await bucket.upload(name, bytes, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    if (uploaded.error) throw uploaded.error;
    if (digest(await download(name)) !== checksums[name]) throw new Error(`Stored checksum mismatch for ${name}.`);
    const published = await client.from('form_definitions').update({ download_path: name }).match({ key, version }).select('key').single();
    if (published.error) throw published.error;
  }
}
console.log(`Verified all four Word templates (${operation}).`);
