import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(rootDir, 'public/styles.css'), 'utf8');
const themes = ['promillo-standard', 'blue-white', 'green-white', 'violet-white', 'navy-lightgray', 'black-white', 'anthracite-gold'];

function blockFor(theme) {
  const selector = theme === 'promillo-standard' ? ':root' : `:root[data-app-theme="${theme}"]`;
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`CSS-Block für ${theme} fehlt.`);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

function token(block, name, fallbackBlock = '') {
  return block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
    || fallbackBlock.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (linear[0] * 0.2126) + (linear[1] * 0.7152) + (linear[2] * 0.0722);
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const standard = blockFor('promillo-standard');
for (const theme of themes) {
  const block = blockFor(theme);
  const values = Object.fromEntries([
    '--primary', '--primary-foreground', '--background', '--surface', '--text', '--text-muted'
  ].map((name) => [name, token(block, name, standard)]));

  for (const [name, value] of Object.entries(values)) {
    if (!value) throw new Error(`${theme}: ${name} ist keine feste prüfbare Farbe.`);
  }

  if (contrast(values['--primary'], values['--primary-foreground']) < 4.5) {
    throw new Error(`${theme}: Primärbutton unterschreitet WCAG-AA-Kontrast.`);
  }
  if (contrast(values['--text'], values['--background']) < 4.5 || contrast(values['--text'], values['--surface']) < 4.5) {
    throw new Error(`${theme}: Fließtext unterschreitet WCAG-AA-Kontrast.`);
  }
  if (contrast(values['--text-muted'], values['--background']) < 3) {
    throw new Error(`${theme}: Sekundärtext unterschreitet Mindestkontrast für größere UI-Beschriftungen.`);
  }
}

console.log('Alle sieben Themes erfüllen die definierten Kontrastgrenzen für Buttons, Text und UI-Beschriftungen.');
