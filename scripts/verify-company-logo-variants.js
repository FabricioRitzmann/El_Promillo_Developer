import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(source, values, label) {
  values.forEach((value) => assert(source.includes(value), `${label} fehlt: ${value}`));
}

const accountHtml = read('public/account.html');
const accountJs = read('public/js/account.js');
const editorHtml = read('public/editor.html');
const editorJs = read('public/js/editor.js');
const pickerJs = read('public/js/logoColorPicker.js');
const schema = read('supabase/schema.sql');
const migration = read('supabase/company-logo-variants.sql');

includesAll(accountHtml, ['value="removed"', 'value="original"', 'companyLogoColorPickerButton', 'companyLogoCardColor', 'companyLogoCardPreview'], 'Kontooberfläche');
includesAll(accountJs, [
  'logoFileToAppleSafePng(file, false)', 'logoFileToAppleSafePng(file, true)',
  'company_logo_original_url', 'company_logo_original_path',
  'company_logo_processed_url', 'company_logo_processed_path',
  'company_logo_background_mode', 'logoVariantForMode',
  'sampleImageColorFromPointer', 'logoPickerTransparent',
  'deleteStorageObjects(businessLogoBucket, obsoletePaths)'
], 'Logo-Variantenlogik');
includesAll(editorHtml, ['editorLogoColorPickerButton', 'editorLogoColorPickerPanel', 'editorLogoColorPickerImage'], 'Editor-Pipettenoberfläche');
includesAll(editorJs, ['company_logo_card_color', 'toggleEditorLogoColorPicker', 'pickEditorLogoColor', "setTemplateField('primary_color', result.color.hex)", 'updateConditionalTemplateFields()'], 'Editor-Pipettenlogik');
includesAll(pickerJs, ['Math.min(width / naturalWidth, height / naturalHeight)', 'relativeX < 0', 'alpha <= alphaThreshold', 'context.getImageData(0, 0, 1, 1)', 'sampleImageColorFromPointer'], 'Pipettenkoordinaten und Transparenz');

for (const source of [schema, migration]) {
  includesAll(source, [
    'company_logo_original_url', 'company_logo_processed_url',
    'company_logo_background_mode', 'company_logo_card_color',
    "company_logo_background_mode in ('removed', 'original')",
    "company_logo_card_color ~ '^#[0-9A-Fa-f]{6}$'"
  ], 'Datenmodell');
}

const picker = await import(pathToFileURL(path.join(rootDir, 'public/js/logoColorPicker.js')));
assert(picker.rgbToHex(255, 16, 0) === '#ff1000', 'RGB muss exakt in Hex umgerechnet werden.');
assert(picker.normalizeHexColor('#ABCDEF') === '#abcdef', 'Hex-Farben müssen normalisiert werden.');

const centeredPoint = picker.containedImagePoint({ clientX: 150, clientY: 150, left: 0, top: 0, width: 300, height: 300, naturalWidth: 1000, naturalHeight: 500 });
assert(centeredPoint?.x === 500 && centeredPoint?.y === 250, 'Contain-Mittelpunkt muss korrekt abgebildet werden.');
const letterboxPoint = picker.containedImagePoint({ clientX: 150, clientY: 20, left: 0, top: 0, width: 300, height: 300, naturalWidth: 1000, naturalHeight: 500 });
assert(letterboxPoint === null, 'Leere object-fit-contain-Flächen dürfen keine Farbe liefern.');

console.log('Company logo variants verified.');
