import QRCode from 'qrcode';
import zlib from 'node:zlib';
import { activeFeatureLabels, cardFeatureRows, templateFeatureSummary, templateTypeLabel } from '../public/js/templateFeatures.js';

const pageSizes = {
  a4: [595.28, 841.89],
  a5: [419.53, 595.28]
};

function pdfText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

function hexToRgb01(hexColor, fallback = '#111827') {
  const value = String(hexColor || fallback).replace('#', '').trim();
  const safeValue = /^[0-9a-fA-F]{6}$/.test(value)
    ? value
    : fallback.replace('#', '');

  return [
    parseInt(safeValue.slice(0, 2), 16) / 255,
    parseInt(safeValue.slice(2, 4), 16) / 255,
    parseInt(safeValue.slice(4, 6), 16) / 255
  ];
}

function textLine(text, x, y, size = 11, color = [0.1, 0.1, 0.1]) {
  return [
    'BT',
    `/F1 ${size} Tf`,
    `${color.map((value) => value.toFixed(3)).join(' ')} rg`,
    `${x.toFixed(2)} ${y.toFixed(2)} Td`,
    `(${pdfText(text)}) Tj`,
    'ET'
  ].join('\n');
}

function rect(x, y, width, height, color, operator = 'f') {
  return [
    `${color.map((value) => value.toFixed(3)).join(' ')} rg`,
    `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${operator}`
  ].join('\n');
}

function templateBusiness(template) {
  return Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;
}

function businessNameForTemplate(template) {
  const business = templateBusiness(template);
  return String(business?.name || template.business_name || 'Business').trim() || 'Business';
}

function businessInitials(template) {
  return businessNameForTemplate(template)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'B';
}

function logoMark(template, x, y, size, background, foreground) {
  return [
    rect(x, y, size, size, background),
    textLine(businessInitials(template), x + (size * 0.25), y + (size * 0.35), size * 0.34, foreground)
  ].join('\n');
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }

  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function parsePng(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressedChunks = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;

    if (chunkEnd > buffer.length) {
      return null;
    }

    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      compressedChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = chunkEnd;
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];

  if (!width || !height || bitDepth !== 8 || !channels || !compressedChunks.length) {
    return null;
  }

  const inflated = zlib.inflateSync(Buffer.concat(compressedChunks));
  const stride = width * channels;
  const raw = Buffer.alloc(width * height * channels);
  let sourceOffset = 0;
  let targetOffset = 0;
  let previousRow = Buffer.alloc(stride);

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const currentRow = Buffer.alloc(stride);

    for (let index = 0; index < stride; index += 1) {
      const value = inflated[sourceOffset + index];
      const left = index >= channels ? currentRow[index - channels] : 0;
      const above = previousRow[index] || 0;
      const upperLeft = index >= channels ? previousRow[index - channels] || 0 : 0;
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? above
            : filter === 3
              ? Math.floor((left + above) / 2)
              : filter === 4
                ? paethPredictor(left, above, upperLeft)
                : null;

      if (predictor == null) {
        return null;
      }

      currentRow[index] = (value + predictor) & 0xff;
    }

    currentRow.copy(raw, targetOffset);
    sourceOffset += stride;
    targetOffset += stride;
    previousRow = currentRow;
  }

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = colorType === 4 || colorType === 6 ? Buffer.alloc(width * height) : null;
  let hasTransparency = false;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 3;
    const grayscale = colorType === 0 || colorType === 4;
    rgb[target] = raw[source];
    rgb[target + 1] = grayscale ? raw[source] : raw[source + 1];
    rgb[target + 2] = grayscale ? raw[source] : raw[source + 2];

    if (alpha) {
      alpha[pixel] = raw[source + channels - 1];
      hasTransparency ||= alpha[pixel] < 255;
    }
  }

  return {
    kind: 'png',
    width,
    height,
    data: zlib.deflateSync(rgb),
    alpha: alpha && hasTransparency ? zlib.deflateSync(alpha) : null
  };
}

function parseJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda || offset + 2 > buffer.length) {
      break;
    }

    const length = buffer.readUInt16BE(offset);

    if (length < 2 || offset + length > buffer.length) {
      return null;
    }

    if (frameMarkers.has(marker)) {
      return {
        kind: 'jpeg',
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
        components: buffer[offset + 7],
        data: buffer
      };
    }

    offset += length;
  }

  return null;
}

export function loadPdfImageFromBuffer(buffer) {
  const source = Buffer.from(buffer || []);
  return parsePng(source) || parseJpeg(source);
}

function drawQr(content, x, y, size) {
  const qr = QRCode.create(content, { errorCorrectionLevel: 'M' });
  const quietZone = 4;
  const moduleCount = qr.modules.size + (quietZone * 2);
  const moduleSize = size / moduleCount;
  const commands = [rect(x, y, size, size, [1, 1, 1])];

  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (!qr.modules.get(row, column)) {
        continue;
      }

      const moduleX = x + ((column + quietZone) * moduleSize);
      const moduleY = y + size - ((row + quietZone + 1) * moduleSize);
      commands.push(rect(moduleX, moduleY, moduleSize + 0.01, moduleSize + 0.01, [0.07, 0.09, 0.15]));
    }
  }

  return commands.join('\n');
}

function buildContent(template, claimUrl, pageWidth, pageHeight) {
  const margin = pageWidth < 500 ? 34 : 52;
  const cardWidth = pageWidth < 500 ? 158 : 210;
  const cardHeight = cardWidth * 0.64;
  const cardX = margin;
  const cardY = pageHeight - margin - 210;
  const qrSize = pageWidth < 500 ? 158 : 210;
  const qrX = pageWidth - margin - qrSize;
  const qrY = cardY;
  const primary = hexToRgb01(template.primary_color, '#fffaf2');
  const foreground = hexToRgb01(template.text_color, '#5b3423');
  const businessName = businessNameForTemplate(template);
  const now = new Date().toLocaleDateString('de-CH');
  const description = String(template.description || templateTypeLabel(template)).slice(0, 90);
  const featureRows = cardFeatureRows(template).slice(0, 3);
  const activeFeatures = activeFeatureLabels(template, { includeBaseFallback: false });
  const featureLines = featureRows.map((row, index) => (
    textLine(`${row.label}: ${row.value}`.slice(0, 36), cardX + 18, cardY + cardHeight - 106 - (index * 14), 8, foreground)
  ));
  const activeFeatureLines = activeFeatures.slice(0, 6).map((label, index) => (
    textLine(`- ${label}`.slice(0, 32), qrX, qrY - 72 - (index * 14), 9, [0.25, 0.29, 0.36])
  ));

  return [
    logoMark(template, margin, pageHeight - margin - 16, 28, primary, foreground),
    textLine(businessName, margin + 38, pageHeight - margin, 20),
    textLine(template.card_name || 'Karte', margin, pageHeight - margin - 26, 28),
    textLine('Scannen und Karte zum Wallet hinzufügen', margin, pageHeight - margin - 58, 13, [0.25, 0.29, 0.36]),
    rect(cardX, cardY, cardWidth, cardHeight, primary),
    logoMark(template, cardX + 18, cardY + cardHeight - 36, 18, [1, 1, 1], primary),
    textLine(businessName, cardX + 42, cardY + cardHeight - 28, 11, foreground),
    textLine(template.card_name || 'Karte', cardX + 18, cardY + cardHeight - 58, 19, foreground),
    textLine(description, cardX + 18, cardY + cardHeight - 82, 9, foreground),
    ...featureLines,
    textLine(templateTypeLabel(template), cardX + 18, cardY + 32, 9, foreground),
    textLine(templateFeatureSummary(template).slice(0, 36), cardX + cardWidth - 90, cardY + 32, 9, foreground),
    textLine('Karten-ID wird beim Hinzufügen erzeugt', cardX + 18, cardY + 16, 7, foreground),
    rect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, [0.95, 0.96, 0.98]),
    drawQr(claimUrl, qrX, qrY, qrSize),
    textLine('Claim-Link', qrX, qrY - 26, 10, [0.25, 0.29, 0.36]),
    textLine(claimUrl.slice(0, 74), qrX, qrY - 42, 8, [0.25, 0.29, 0.36]),
    ...(activeFeatureLines.length ? [
      textLine('Aktivierte Funktionen', qrX, qrY - 58, 10, [0.25, 0.29, 0.36]),
      ...activeFeatureLines
    ] : []),
    textLine(`Template-ID: ${template.id}`, margin, margin + 36, 9, [0.35, 0.39, 0.47]),
    textLine(`Erstellt: ${now}`, margin, margin + 20, 9, [0.35, 0.39, 0.47])
  ].join('\n');
}

function object(content) {
  return `${content}\n`;
}

export function buildTemplateQrPdf({ template, claimUrl, format = 'a4' }) {
  const normalizedFormat = String(format || 'a4').toLowerCase() === 'a5' ? 'a5' : 'a4';
  const [pageWidth, pageHeight] = pageSizes[normalizedFormat];
  const content = buildContent(template, claimUrl, pageWidth, pageHeight);
  const stream = Buffer.from(content, 'utf8');
  const objects = [
    object('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'),
    object('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj'),
    object(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj`),
    object('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj'),
    object(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${content}\nendstream\nendobj`)
  ];
  const header = '%PDF-1.4\n';
  let body = header;
  const offsets = [0];

  for (const pdfObject of objects) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += pdfObject;
  }

  const xrefOffset = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, 'utf8');
}
