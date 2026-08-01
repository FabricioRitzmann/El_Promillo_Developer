import QRCode from 'qrcode';
import zlib from 'node:zlib';
import {
  cardFeatureRows,
  featureEnabled,
  normalizeTemplateType,
  templateFeatureSummary,
  templateSettings,
  templateTypeLabel
} from '../public/js/templateFeatures.js';

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

function roundedRect(x, y, width, height, radius, color, operator = 'f') {
  const r = Math.min(radius, width / 2, height / 2);
  const k = 0.5522847498;
  const c = r * k;
  return [
    `${color.map((value) => value.toFixed(3)).join(' ')} rg`,
    `${(x + r).toFixed(2)} ${y.toFixed(2)} m`,
    `${(x + width - r).toFixed(2)} ${y.toFixed(2)} l`,
    `${(x + width - r + c).toFixed(2)} ${y.toFixed(2)} ${(x + width).toFixed(2)} ${(y + r - c).toFixed(2)} ${(x + width).toFixed(2)} ${(y + r).toFixed(2)} c`,
    `${(x + width).toFixed(2)} ${(y + height - r).toFixed(2)} l`,
    `${(x + width).toFixed(2)} ${(y + height - r + c).toFixed(2)} ${(x + width - r + c).toFixed(2)} ${(y + height).toFixed(2)} ${(x + width - r).toFixed(2)} ${(y + height).toFixed(2)} c`,
    `${(x + r).toFixed(2)} ${(y + height).toFixed(2)} l`,
    `${(x + r - c).toFixed(2)} ${(y + height).toFixed(2)} ${x.toFixed(2)} ${(y + height - r + c).toFixed(2)} ${x.toFixed(2)} ${(y + height - r).toFixed(2)} c`,
    `${x.toFixed(2)} ${(y + r).toFixed(2)} l`,
    `${x.toFixed(2)} ${(y + r - c).toFixed(2)} ${(x + r - c).toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)} c`,
    `h ${operator}`
  ].join('\n');
}

function line(x1, y1, x2, y2, color = [0.85, 0.78, 0.67], width = 1) {
  return [
    `${color.map((value) => value.toFixed(3)).join(' ')} RG`,
    `${width.toFixed(2)} w`,
    `${x1.toFixed(2)} ${y1.toFixed(2)} m`,
    `${x2.toFixed(2)} ${y2.toFixed(2)} l S`
  ].join('\n');
}

function templateBusiness(template) {
  return Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;
}

function businessNameForTemplate(template) {
  const business = templateBusiness(template);
  return String(
    business?.name
      || business?.company_name
      || template.business_name
      || 'Mein Unternehmen'
  ).trim() || 'Mein Unternehmen';
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
    roundedRect(x, y, size, size, size * 0.22, background),
    textLine(businessInitials(template), x + (size * 0.24), y + (size * 0.35), size * 0.34, foreground)
  ].join('\n');
}

function paethPredictor(left, above, upperLeft) {
  const p = left + above - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - above);
  const pc = Math.abs(p - upperLeft);

  if (pa <= pb && pa <= pc) {
    return left;
  }

  return pb <= pc ? above : upperLeft;
}

function parsePng(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset += length + 12;
  }

  const channelsByColorType = {
    0: 1,
    2: 3,
    4: 2,
    6: 4
  };
  const channels = channelsByColorType[colorType];

  if (!width || !height || bitDepth !== 8 || !channels || !idat.length) {
    return null;
  }

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const raw = Buffer.alloc(width * height * channels);
  const bytesPerPixel = channels;
  let sourceOffset = 0;
  let targetOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const current = Buffer.alloc(stride);

    for (let index = 0; index < stride; index += 1) {
      const value = inflated[sourceOffset + index];
      const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0;
      const above = previous[index] || 0;
      const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] || 0 : 0;

      if (filter === 0) {
        current[index] = value;
      } else if (filter === 1) {
        current[index] = (value + left) & 0xff;
      } else if (filter === 2) {
        current[index] = (value + above) & 0xff;
      } else if (filter === 3) {
        current[index] = (value + Math.floor((left + above) / 2)) & 0xff;
      } else if (filter === 4) {
        current[index] = (value + paethPredictor(left, above, upperLeft)) & 0xff;
      } else {
        return null;
      }
    }

    current.copy(raw, targetOffset);
    sourceOffset += stride;
    targetOffset += stride;
    previous = current;
  }

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = colorType === 4 || colorType === 6
    ? Buffer.alloc(width * height)
    : null;
  let hasTransparency = false;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 3;

    if (colorType === 0 || colorType === 4) {
      rgb[target] = raw[source];
      rgb[target + 1] = raw[source];
      rgb[target + 2] = raw[source];
    } else {
      rgb[target] = raw[source];
      rgb[target + 1] = raw[source + 1];
      rgb[target + 2] = raw[source + 2];
    }

    if (alpha) {
      const alphaValue = raw[source + channels - 1];
      alpha[pixel] = alphaValue;
      hasTransparency = hasTransparency || alphaValue < 255;
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
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const length = buffer.readUInt16BE(offset);
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

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

function pdfImageResource(name, image) {
  if (!image) {
    return null;
  }

  return { name, image };
}

function fitImage(image, x, y, maxWidth, maxHeight, align = 'left') {
  if (!image?.width || !image?.height) {
    return { x, y, width: 0, height: 0 };
  }

  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const imageX = align === 'right' ? x + maxWidth - width : x;
  const imageY = y + ((maxHeight - height) / 2);

  return { x: imageX, y: imageY, width, height };
}

function imageCommand(name, box, opacityName = '') {
  if (!box?.width || !box?.height) {
    return '';
  }

  return [
    'q',
    opacityName ? `/${opacityName} gs` : '',
    `${box.width.toFixed(2)} 0 0 ${box.height.toFixed(2)} ${box.x.toFixed(2)} ${box.y.toFixed(2)} cm`,
    `/${name} Do`,
    'Q'
  ].filter(Boolean).join('\n');
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

function rewardVisible(template) {
  const settings = templateSettings(template);
  return Boolean(
    template.reward_text
      || settings.rewardText
      || settings.couponTitle
      || settings.discountValue
  );
}

function buildWalletFields(template) {
  const rows = cardFeatureRows(template);
  const primaryRow = rows[0] || {
    label: 'Status',
    value: 'Aktiv'
  };
  const auxiliaryRows = rows.slice(1, 5);
  const settings = templateSettings(template);

  if (rewardVisible(template)) {
    auxiliaryRows.push({
      label: 'Belohnung',
      value: template.reward_text || settings.rewardText || settings.discountValue || 'Bereit'
    });
  }

  return {
    header: primaryRow,
    auxiliary: auxiliaryRows.slice(0, 4)
  };
}

function buildWalletPreview(template, claimUrl, assets, x, y, width) {
  const height = width * 0.64;
  const primary = hexToRgb01(template.primary_color, '#fffdf9');
  const foreground = hexToRgb01(template.text_color, '#8b4f2f');
  const businessName = businessNameForTemplate(template);
  const cardName = String(template.card_name || 'Kundenkarte');
  const fields = buildWalletFields(template);
  const cardNumber = 'Wird beim Claim erzeugt';
  const businessLogoBox = assets.businessLogo
    ? fitImage(assets.businessLogo, x + 18, y + height - 40, 24, 24)
    : null;
  const settings = templateSettings(template);
  const isEventCard = normalizeTemplateType(template) === 'event_card';
  const background = isEventCard && featureEnabled(template, 'eventBackgroundImage') && assets.eventBackgroundImage
    ? [
      roundedRect(x, y, width, height, 20, primary),
      imageCommand('EventBackgroundImage', fitImage(assets.eventBackgroundImage, x, y, width, height), ''),
      rect(x, y, width, height, [0.36, 0.2, 0.13], 'f')
    ].join('\n')
    : roundedRect(x, y, width, height, 20, primary);

  const visibleAuxiliary = fields.auxiliary.slice(0, 2);
  const auxiliaryLines = visibleAuxiliary.map((row, index) => {
    const maxValueLength = visibleAuxiliary.length === 1 ? 36 : 22;

    return [
      textLine(String(row.label || '').slice(0, 18), x + 18 + (index * (width / 2 - 8)), y + 65, 6, foreground),
      textLine(String(row.value || '').slice(0, maxValueLength), x + 18 + (index * (width / 2 - 8)), y + 54, 7.5, foreground)
    ].join('\n');
  });

  const qrSize = 28;

  return [
    background,
    assets.businessLogo
      ? imageCommand('BusinessLogo', businessLogoBox)
      : logoMark(template, x + 18, y + height - 40, 24, [1, 1, 1], primary),
    textLine(businessName.slice(0, 28), x + 48, y + height - 25, 10, foreground),
    textLine(String(fields.header.label || 'Status').slice(0, 16), x + width - 86, y + height - 20, 6.5, foreground),
    textLine(String(fields.header.value || 'Aktiv').slice(0, 16), x + width - 86, y + height - 32, 10, foreground),
    textLine(businessName.slice(0, 24), x + 18, y + height - 68, 7, foreground),
    textLine(cardName.slice(0, 27), x + 18, y + height - 87, 17, foreground),
    ...auxiliaryLines,
    roundedRect(x + 14, y + 9, width - 28, 40, 8, [1, 1, 1]),
    drawQr(claimUrl, x + 23, y + 15, qrSize),
    textLine(cardNumber, x + 62, y + 33, 8, [0.11, 0.13, 0.17]),
    textLine(templateTypeLabel(template), x + 62, y + 20, 7.5, [0.35, 0.39, 0.47]),
    line(x + 16, y + 73, x + width - 16, y + 73, [1, 1, 1], 0.6),
    settings.eventName ? textLine(String(settings.eventName).slice(0, 30), x + 18, y + 74, 8.5, foreground) : ''
  ].filter(Boolean).join('\n');
}

function buildContent(template, claimUrl, pageWidth, pageHeight, assets = {}) {
  const margin = pageWidth < 500 ? 34 : 52;
  const cardWidth = pageWidth < 500 ? 176 : 270;
  const cardX = margin;
  const cardY = pageHeight - margin - (pageWidth < 500 ? 260 : 300);
  const qrSize = pageWidth < 500 ? 142 : 196;
  const qrX = pageWidth - margin - qrSize;
  const qrY = cardY + ((cardWidth * 0.64) - qrSize) / 2;
  const primary = hexToRgb01(template.primary_color, '#fffdf9');
  const foreground = hexToRgb01(template.text_color, '#8b4f2f');
  const businessName = businessNameForTemplate(template);
  const now = new Date().toLocaleDateString('de-CH');
  const headerLogoBox = assets.businessLogo
    ? fitImage(assets.businessLogo, margin, pageHeight - margin - 32, 32, 32)
    : null;
  const brandLogoBox = assets.brandLogo
    ? fitImage(assets.brandLogo, pageWidth - margin - (pageWidth < 500 ? 128 : 170), pageHeight - margin - 40, pageWidth < 500 ? 128 : 170, 48, 'right')
    : null;
  const pageTitleY = pageHeight - margin - 72;

  return [
    rect(0, 0, pageWidth, pageHeight, [1, 0.992, 0.976]),
    assets.businessLogo
      ? imageCommand('BusinessLogo', headerLogoBox)
      : logoMark(template, margin, pageHeight - margin - 32, 32, primary, foreground),
    textLine(businessName, margin + 42, pageHeight - margin - 11, 16, [0.23, 0.15, 0.11]),
    assets.brandLogo
      ? imageCommand('BrandLogo', brandLogoBox, 'GSBrand')
      : textLine('El Promillo', pageWidth - margin - 96, pageHeight - margin - 12, 16, [0.54, 0.31, 0.18]),
    line(margin, pageHeight - margin - 48, pageWidth - margin, pageHeight - margin - 48, [0.82, 0.72, 0.55], 0.8),
    textLine(template.card_name || 'Karte', margin, pageTitleY, pageWidth < 500 ? 24 : 30, [0.22, 0.13, 0.09]),
    textLine('Apple-Wallet-Vorschau mit Claim-QR-Code', margin, pageTitleY - 24, 12, [0.37, 0.31, 0.27]),
    buildWalletPreview(template, claimUrl, assets, cardX, cardY, cardWidth),
    textLine('Apple Wallet Karte', cardX, cardY + (cardWidth * 0.64) + 18, 11, [0.37, 0.31, 0.27]),
    roundedRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 58, 16, [1, 1, 1]),
    drawQr(claimUrl, qrX, qrY, qrSize),
    textLine('Claim QR-Code', qrX, qrY + qrSize + 20, 11, [0.37, 0.31, 0.27]),
    textLine(claimUrl.slice(0, 50), qrX - 8, qrY - 30, 7, [0.35, 0.39, 0.47]),
    textLine(templateFeatureSummary(template).slice(0, 72), margin, margin + 38, 9, [0.35, 0.39, 0.47]),
    textLine(`Template-ID: ${template.id}`, margin, margin + 24, 8, [0.35, 0.39, 0.47]),
    textLine(`Erstellt: ${now}`, margin, margin + 12, 8, [0.35, 0.39, 0.47])
  ].join('\n');
}

function textObject(content) {
  return Buffer.from(`${content}\n`, 'utf8');
}

function streamObject(header, stream) {
  return Buffer.concat([
    Buffer.from(`${header}\nstream\n`, 'utf8'),
    stream,
    Buffer.from('\nendstream\nendobj\n', 'utf8')
  ]);
}

function imageObjects(images) {
  const objects = [];

  for (const item of images) {
    const image = item.image;
    const colorSpace = image.kind === 'jpeg' && image.components === 1
      ? '/DeviceGray'
      : '/DeviceRGB';

    objects.push(streamObject(
      `${item.objectNumber} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter ${image.kind === 'jpeg' ? '/DCTDecode' : '/FlateDecode'}${item.alphaObjectNumber ? ` /SMask ${item.alphaObjectNumber} 0 R` : ''} /Length ${image.data.length} >>`,
      image.data
    ));

    if (image.alpha && item.alphaObjectNumber) {
      objects.push(streamObject(
        `${item.alphaObjectNumber} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.alpha.length} >>`,
        image.alpha
      ));
    }
  }

  return objects;
}

export function buildTemplateQrPdf({ template, claimUrl, format = 'a4', assets = {} }) {
  const normalizedFormat = String(format || 'a4').toLowerCase() === 'a5' ? 'a5' : 'a4';
  const [pageWidth, pageHeight] = pageSizes[normalizedFormat];
  const imageResources = [
    pdfImageResource('BusinessLogo', assets.businessLogo),
    pdfImageResource('BrandLogo', assets.brandLogo),
    pdfImageResource('EventBackgroundImage', assets.eventBackgroundImage)
  ].filter(Boolean);
  let nextObjectNumber = 6;
  const preparedImages = imageResources.map((resource) => {
    const objectNumber = nextObjectNumber;
    nextObjectNumber += 1;
    const alphaObjectNumber = resource.image.alpha ? nextObjectNumber : null;

    if (alphaObjectNumber) {
      nextObjectNumber += 1;
    }

    return {
      ...resource,
      objectNumber,
      alphaObjectNumber
    };
  });
  const content = buildContent(template, claimUrl, pageWidth, pageHeight, assets);
  const stream = Buffer.from(content, 'utf8');
  const xObjectResource = preparedImages.length
    ? `/XObject << ${preparedImages.map((image) => `/${image.name} ${image.objectNumber} 0 R`).join(' ')} >>`
    : '';
  const objects = [
    textObject('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'),
    textObject('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj'),
    textObject(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 4 0 R >> ${xObjectResource} /ExtGState << /GSBrand << /Type /ExtGState /ca 0.5 /CA 0.5 >> >> >> /Contents 5 0 R >>\nendobj`),
    textObject('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj'),
    streamObject(`5 0 obj\n<< /Length ${stream.length} >>`, stream),
    ...imageObjects(preparedImages)
  ];
  const chunks = [Buffer.from('%PDF-1.4\n', 'utf8')];
  const offsets = [0];

  for (const pdfObject of objects) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(pdfObject);
  }

  const xrefOffset = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n`, 'utf8'));
  chunks.push(Buffer.from('0000000000 65535 f \n', 'utf8'));
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(Buffer.from(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`, 'utf8'));
  }
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'utf8'));

  return Buffer.concat(chunks);
}
