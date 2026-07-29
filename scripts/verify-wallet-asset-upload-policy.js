import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, needles, label) {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} fehlt: ${needle}`);
  }
}

function assertExcludes(source, needles, label) {
  for (const needle of needles) {
    assert(!source.includes(needle), `${label} darf nicht enthalten: ${needle}`);
  }
}

const editorSource = read('public/js/editor.js');
const schemaSource = read('supabase/schema.sql');
const readmeSource = read('README.md');

assertIncludes(editorSource, [
  'const maxAssetFileBytes = 2 * 1024 * 1024',
  'const maxAssetSourceFileBytes = 25 * 1024 * 1024',
  "import { imageFileToPngUnderLimit } from './imageUploadOptimizer.js';",
  'imageFileToPngUnderLimit(file',
  'maxBytes: maxAssetFileBytes',
  'maxSourceBytes: maxAssetSourceFileBytes',
  'assetUploadFrames',
  "'event-apple-background': { width: 1000, height: 1500",
  "'event-google-hero': { width: 1200, height: 400",
  "'stamp-icon': { width: 512, height: 512",
  "'streak-icon': { width: 512, height: 512",
  'targetWidth: uploadFrame.width',
  'targetHeight: uploadFrame.height',
  "filename: `${kind}.png`",
  'SVG und andere Dateitypen sind für Wallet-Assets deaktiviert'
], 'Editor-Asset-Upload muss Bildtypen validieren und Dateien vor dem Upload unter 2 MB vorbereiten');

const imageUploadOptimizerSource = read('public/js/imageUploadOptimizer.js');

assertIncludes(imageUploadOptimizerSource, [
  'image/png',
  'image/jpeg',
  'image/webp',
  'allowedImageMimeTypes.has(mimeType)',
  'file.size > options.maxSourceBytes',
  'drawImageContained',
  'Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight)',
  'Math.round((canvasWidth - drawWidth) / 2)',
  'Math.round((canvasHeight - drawHeight) / 2)',
  'pngBlob.size <= settings.maxBytes'
], 'Image-Upload-Optimizer muss Bildtypen begrenzen und PNGs unter der Zielgrösse erzeugen');

assertExcludes(editorSource, [
  "file.type.startsWith('image/')",
  'image/svg+xml'
], 'Editor-Asset-Upload darf keine allgemeinen image/* oder SVG-Uploads erlauben');

assertIncludes(schemaSource, [
  "insert into storage.buckets (id, name, public)",
  "values ('wallet-assets', 'wallet-assets', true)",
  "lower(name) ~ '\\.(png|jpg|jpeg|webp)$'",
  "coalesce(metadata->>'mimetype', '') in ('image/png', 'image/jpeg', 'image/webp')",
  "metadata ? 'size'",
  "(metadata->>'size') ~ '^[0-9]+$'",
  "(metadata->>'size')::bigint <= 2097152",
  'unlocked operators can upload own wallet assets',
  'unlocked operators can update own wallet assets'
], 'Storage-Policies müssen Wallet-Assets auf sichere Bildtypen und 2 MB begrenzen');

assertExcludes(schemaSource, [
  "not (metadata ? 'size')"
], 'Storage-Policies müssen Grössen-Metadaten für Wallet-Assets verlangen');

assertIncludes(readmeSource, [
  'PNG, JPEG oder WebP',
  'automatisch zentriert, ohne Beschnitt in den passenden Zielrahmen eingepasst und als PNG unter 2 MB vorbereitet',
  'SVG ist für Wallet-Assets bewusst deaktiviert'
], 'README muss die Wallet-Asset-Upload-Grenzen dokumentieren');

console.log('Wallet-Asset-Uploads werden clientseitig vorbereitet und serverseitig auf sichere Bildtypen, Betreiberordner und 2 MB begrenzt.');
