'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { UPLOAD_DIR, IS_VERCEL } = require('./paths');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/(?:rest|storage)\/v1$/i, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'pes-to-uploads';
const CLOUD = Boolean(SUPABASE_URL && SUPABASE_KEY);

let client = null;
function getClient() {
  if (!CLOUD) throw new Error('Supabase Storage is not configured.');
  if (!client) {
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

function assertConfigured() {
  if (IS_VERCEL && !CLOUD) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on Vercel.');
  }
}

function contentType(name) {
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/webp';
}

function safeName(name) {
  const base = path.basename(String(name || ''));
  if (!base || base !== String(name) || !/^[a-f0-9]{32}\.(webp|gif|jpe?g|png)$/.test(base)) return '';
  return base;
}

async function optimize(buffer, mimetype) {
  if (mimetype === 'image/gif') {
    return { buffer, contentType: 'image/gif', extension: '.gif' };
  }
  const output = await sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();
  return { buffer: output, contentType: 'image/webp', extension: '.webp' };
}

async function ensureBucket() {
  if (!CLOUD) return;
  const supabase = getClient();
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error('Storage bucket: ' + error.message);
  }
}

async function saveImage(file) {
  assertConfigured();
  const optimized = await optimize(file.buffer, file.mimetype);
  const name = crypto.randomBytes(16).toString('hex') + optimized.extension;
  if (CLOUD) {
    await ensureBucket();
    const { error } = await getClient().storage.from(BUCKET).upload(name, optimized.buffer, {
      contentType: optimized.contentType,
      upsert: false,
      cacheControl: '31536000'
    });
    if (error) throw new Error('Storage upload failed: ' + error.message);
  } else {
    await fs.writeFile(path.join(UPLOAD_DIR, name), optimized.buffer);
  }
  return { name, contentType: optimized.contentType };
}

async function readImage(name) {
  const safe = safeName(name);
  if (!safe) return null;
  if (CLOUD) {
    const { data, error } = await getClient().storage.from(BUCKET).download(safe);
    if (error || !data) return null;
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      contentType: contentType(safe)
    };
  }
  try {
    const buffer = await fs.readFile(path.join(UPLOAD_DIR, safe));
    return {
      buffer,
      contentType: contentType(safe)
    };
  } catch {
    return null;
  }
}

async function removeImage(name) {
  const safe = safeName(name);
  if (!safe) return;
  if (CLOUD) {
    await getClient().storage.from(BUCKET).remove([safe]);
  } else {
    await fs.unlink(path.join(UPLOAD_DIR, safe)).catch(() => {});
  }
}

module.exports = {
  BUCKET,
  CLOUD,
  assertConfigured,
  saveImage,
  readImage,
  removeImage,
  optimize
};
