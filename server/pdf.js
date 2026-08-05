import QRCode from 'qrcode';
import zlib from 'node:zlib';
import { cardFeatureRows, templateFeatureSummary, templateTypeLabel } from '../public/js/templateFeatures.js';
import { pdfBrandLogo } from './pdfBrandLogoData.js';

const pageSizes = {
  a4: [841.89, 595.28],
  a5: [595.28, 419.53],
  a6: [419.53, 297.64]
};

const designSize = {
  width: 841.89,
  height: 595.28
};

const googleWalletPlayStoreUrl = 'https://play.google.com/store/apps/details?id=com.google.android.apps.walletnfcrel';

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

function textLine(text, x, y, size = 11, color = [0.1, 0.1, 0.1], font = 'F1') {
  return [
    'BT',
    `/${font} ${size} Tf`,
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

function line(x1, y1, x2, y2, color, width = 1) {
  return [
    `${color.map((value) => value.toFixed(3)).join(' ')} RG`,
    `${width.toFixed(2)} w`,
    `${x1.toFixed(2)} ${y1.toFixed(2)} m`,
    `${x2.toFixed(2)} ${y2.toFixed(2)} l S`
  ].join('\n');
}

function imageXObject(name, x, y, width, height) {
  return [
    'q',
    `${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`,
    `/${name} Do`,
    'Q'
  ].join('\n');
}

function roundedRect(x, y, width, height, radius, fill, stroke, strokeWidth = 1) {
  const right = x + width;
  const top = y + height;
  const control = radius * 0.5522847498;
  const commands = [
    `${fill.map((value) => value.toFixed(3)).join(' ')} rg`,
    ...(stroke ? [
      `${stroke.map((value) => value.toFixed(3)).join(' ')} RG`,
      `${strokeWidth.toFixed(2)} w`
    ] : []),
    `${(x + radius).toFixed(2)} ${y.toFixed(2)} m`,
    `${(right - radius).toFixed(2)} ${y.toFixed(2)} l`,
    `${(right - radius + control).toFixed(2)} ${y.toFixed(2)} ${right.toFixed(2)} ${(y + radius - control).toFixed(2)} ${right.toFixed(2)} ${(y + radius).toFixed(2)} c`,
    `${right.toFixed(2)} ${(top - radius).toFixed(2)} l`,
    `${right.toFixed(2)} ${(top - radius + control).toFixed(2)} ${(right - radius + control).toFixed(2)} ${top.toFixed(2)} ${(right - radius).toFixed(2)} ${top.toFixed(2)} c`,
    `${(x + radius).toFixed(2)} ${top.toFixed(2)} l`,
    `${(x + radius - control).toFixed(2)} ${top.toFixed(2)} ${x.toFixed(2)} ${(top - radius + control).toFixed(2)} ${x.toFixed(2)} ${(top - radius).toFixed(2)} c`,
    `${x.toFixed(2)} ${(y + radius).toFixed(2)} l`,
    `${x.toFixed(2)} ${(y + radius - control).toFixed(2)} ${(x + radius - control).toFixed(2)} ${y.toFixed(2)} ${(x + radius).toFixed(2)} ${y.toFixed(2)} c`,
    stroke ? 'B' : 'f'
  ];

  return commands.join('\n');
}

function clippedText(text, maxChars) {
  const normalized = pdfText(text).trim();

  return normalized.length > maxChars ? `${normalized.slice(0, Math.max(0, maxChars - 3))}...` : normalized;
}

function wrappedText(text, x, y, maxWidth, size = 11, color = [0.1, 0.1, 0.1], leading = 14, maxLines = 3, font = 'F1') {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const maxChars = Math.max(12, Math.floor(maxWidth / (size * 0.52)));
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const nextLine = [currentLine, word].filter(Boolean).join(' ');

    if (nextLine.length <= maxChars) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, maxLines).map((lineText, index) => (
    textLine(lineText, x, y - (index * leading), size, color, font)
  )).join('\n');
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

function cardFunctionText(template) {
  const type = templateTypeLabel(template);
  cardFeatureRows(template);
  const summary = templateFeatureSummary(template);

  if (summary === 'Basiskarte' || summary.toLowerCase().startsWith(type.toLowerCase())) {
    return summary === 'Basiskarte' ? type : summary;
  }

  return `${type} - ${summary}`;
}

function brandLockup(x, y) {
  const height = 78;
  const width = height * (pdfBrandLogo.width / pdfBrandLogo.height);

  return [
    imageXObject('ImBrandLogo', x, y - 8, width, height)
  ].join('\n');
}

function qrTile(x, y, width, height, title, subtitle, qrContent, titleColor) {
  const qrSize = 112;
  const qrX = x + width - qrSize - 18;
  const qrY = y + ((height - qrSize) / 2) - 2;

  return [
    roundedRect(x, y, width, height, 18, [1, 1, 1], [0.92, 0.86, 0.78], 1),
    textLine(title, x + 18, y + height - 31, 13, titleColor, 'F2'),
    wrappedText(subtitle, x + 18, y + height - 49, qrX - x - 34, 9.2, [0.55, 0.38, 0.28], 12, 2),
    line(x + 18, y + 44, qrX - 12, y + 44, [0.82, 0.63, 0.36], 2),
    roundedRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 15, [1, 1, 1], [0.93, 0.88, 0.82], 1),
    drawQr(qrContent, qrX, qrY, qrSize)
  ].join('\n');
}

function buildContent(template, claimUrl, pageWidth, pageHeight) {
  const scale = Math.min(pageWidth / designSize.width, pageHeight / designSize.height);
  const offsetX = (pageWidth - (designSize.width * scale)) / 2;
  const offsetY = (pageHeight - (designSize.height * scale)) / 2;
  const margin = 48;
  const leftX = margin;
  const leftY = 120;
  const leftWidth = 438;
  const leftHeight = 328;
  const rightX = leftX + leftWidth + 28;
  const now = new Date().toLocaleDateString('de-CH');
  const cardName = clippedText(template.card_name || 'Karte', 34);
  const functionText = clippedText(cardFunctionText(template), 72);
  const bodyText = 'Zum Hinzufuegen der Karte den Claim-QR scannen. Android- und Samsung-Nutzer koennen Google Wallet bei Bedarf ueber den zweiten QR herunterladen.';

  const design = [
    rect(0, 0, designSize.width, designSize.height, [1, 0.992, 0.976]),
    rect(0, designSize.height - 86, designSize.width, 86, [0.984, 0.945, 0.882]),
    rect(0, 0, designSize.width, 64, [1, 0.969, 0.925]),
    brandLockup(margin, designSize.height - 78),
    roundedRect(leftX, leftY, leftWidth, leftHeight, 24, [1, 0.976, 0.933], [0.92, 0.86, 0.78], 1.2),
    line(leftX + 28, leftY + leftHeight - 76, leftX + leftWidth - 28, leftY + leftHeight - 76, [0.82, 0.63, 0.36], 1.6),
    textLine('DIGITALE WALLET-KARTE', leftX + 30, leftY + leftHeight - 42, 10.5, [0.72, 0.43, 0.22], 'F2'),
    textLine(cardName, leftX + 30, leftY + leftHeight - 116, 41, [0.29, 0.15, 0.09], 'F3'),
    wrappedText(functionText, leftX + 32, leftY + leftHeight - 156, leftWidth - 64, 20, [0.55, 0.31, 0.18], 24, 2, 'F2'),
    wrappedText(bodyText, leftX + 32, leftY + leftHeight - 214, leftWidth - 64, 12.5, [0.55, 0.38, 0.28], 18, 4),
    qrTile(rightX, 324, 296, 148, 'Karte hinzufuegen', 'Claim-QR scannen', claimUrl, [0.55, 0.31, 0.18]),
    qrTile(rightX, 148, 296, 148, 'Google Wallet laden', 'Fuer Samsung und Android', googleWalletPlayStoreUrl, [0.72, 0.43, 0.22]),
    textLine('el-promillo.ch  |  Wallet & Loyalty Cards', designSize.width - margin - 150, 36, 8.6, [0.55, 0.38, 0.28]),
    textLine(`Template-ID: ${template.id}`, margin, 34, 8, [0.55, 0.38, 0.28]),
    textLine(`Erstellt: ${now}`, margin, 20, 8, [0.55, 0.38, 0.28])
  ].join('\n');

  return [
    'q',
    `${scale.toFixed(4)} 0 0 ${scale.toFixed(4)} ${offsetX.toFixed(2)} ${offsetY.toFixed(2)} cm`,
    design,
    'Q'
  ].join('\n');
}

function object(content) {
  return `${content}\n`;
}

function brandLogoObject(objectId) {
  const stream = `${pdfBrandLogo.hex}>`;

  return object(`${objectId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pdfBrandLogo.width} /Height ${pdfBrandLogo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`);
}

function normalizePdfFormat(format) {
  const value = String(format || 'a4').toLowerCase();
  return ['a4', 'a5', 'a6'].includes(value) ? value : 'a4';
}

export function buildTemplateQrPdf({ template, claimUrl, format = 'a4' }) {
  const normalizedFormat = normalizePdfFormat(format);
  const [pageWidth, pageHeight] = pageSizes[normalizedFormat];
  const content = buildContent(template, claimUrl, pageWidth, pageHeight);
  const stream = Buffer.from(content, 'utf8');
  const objects = [
    object('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'),
    object('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj'),
    object(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> /XObject << /ImBrandLogo 8 0 R >> >> /Contents 7 0 R >>\nendobj`),
    object('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj'),
    object('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj'),
    object('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-BoldItalic >>\nendobj'),
    object(`7 0 obj\n<< /Length ${stream.length} >>\nstream\n${content}\nendstream\nendobj`),
    brandLogoObject(8)
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
