export function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function normalizeHexColor(value, fallback = '#fffaf2') {
  const normalized = String(value || '').trim();

  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : fallback;
}

export function containedImagePoint({
  clientX,
  clientY,
  left,
  top,
  width,
  height,
  naturalWidth,
  naturalHeight
}) {
  if (!width || !height || !naturalWidth || !naturalHeight) {
    return null;
  }

  const scale = Math.min(width / naturalWidth, height / naturalHeight);
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  const renderedLeft = left + ((width - renderedWidth) / 2);
  const renderedTop = top + ((height - renderedHeight) / 2);
  const relativeX = clientX - renderedLeft;
  const relativeY = clientY - renderedTop;

  if (relativeX < 0 || relativeY < 0 || relativeX >= renderedWidth || relativeY >= renderedHeight) {
    return null;
  }

  return {
    x: Math.min(naturalWidth - 1, Math.max(0, Math.floor(relativeX / scale))),
    y: Math.min(naturalHeight - 1, Math.max(0, Math.floor(relativeY / scale)))
  };
}

export function imagePointFromPointer(image, event) {
  const rect = image.getBoundingClientRect();

  return containedImagePoint({
    clientX: event.clientX,
    clientY: event.clientY,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight
  });
}

export function sampleImagePixel(image, point, options = {}) {
  if (!point || !image?.naturalWidth || !image?.naturalHeight) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error(options.errorMessage || 'Die Farbpipette ist in diesem Browser nicht verfügbar.');
  }

  context.clearRect(0, 0, 1, 1);
  context.drawImage(image, point.x, point.y, 1, 1, 0, 0, 1, 1);

  let pixel;

  try {
    pixel = context.getImageData(0, 0, 1, 1).data;
  } catch (_error) {
    throw new Error(options.corsMessage || 'Die Logo-Farbe konnte wegen einer Bildfreigabe nicht gelesen werden.');
  }

  const alpha = pixel[3];
  const alphaThreshold = Number(options.alphaThreshold ?? 16);

  if (alpha <= alphaThreshold) {
    return null;
  }

  return {
    red: pixel[0],
    green: pixel[1],
    blue: pixel[2],
    alpha,
    hex: rgbToHex(pixel[0], pixel[1], pixel[2])
  };
}

export function sampleImageColorFromPointer(image, event, options = {}) {
  const point = imagePointFromPointer(image, event);

  if (!point) {
    return { outsideImage: true, color: null };
  }

  return {
    outsideImage: false,
    color: sampleImagePixel(image, point, options)
  };
}
