const defaultMaxSourceFileBytes = 25 * 1024 * 1024;
const allowedImageMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp'
]);

function fileFromPngBlob(blob, filename) {
  if (typeof File === 'function') {
    return new File([blob], filename, { type: 'image/png' });
  }

  return blob;
}

function imageElementFromFile(file, errorMessage) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(errorMessage));
    };
    image.src = objectUrl;
  });
}

function imageFromFile(file, errorMessage) {
  if (window.createImageBitmap) {
    return createImageBitmap(file).catch(() => imageElementFromFile(file, errorMessage));
  }

  return imageElementFromFile(file, errorMessage);
}

function canvasToPngBlob(canvas, errorMessage) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error(errorMessage));
      }
    }, 'image/png');
  });
}

function validateImageFile(file, options) {
  if (!file) {
    throw new Error(options.emptyMessage);
  }

  const mimeType = String(file.type || '').toLowerCase();

  if (!allowedImageMimeTypes.has(mimeType)) {
    throw new Error(options.typeMessage);
  }

  if (file.size > options.maxSourceBytes) {
    throw new Error(options.sourceTooLargeMessage);
  }
}

function scaleStepsForImage(width, height, maxSideCandidates) {
  const maxSide = Math.max(width, height);
  const scales = [
    1,
    ...maxSideCandidates.map((maxSideCandidate) => Math.min(1, maxSideCandidate / maxSide))
  ];

  return [...new Set(scales.map((scale) => Number(scale.toFixed(4))))]
    .filter((scale) => scale > 0 && scale <= 1)
    .sort((a, b) => b - a);
}

function normalizedPositiveInteger(value) {
  const numberValue = Math.round(Number(value) || 0);

  return numberValue > 0 ? numberValue : 0;
}

function edgePixelIndexes(width, height) {
  const indexes = [];

  for (let x = 0; x < width; x += 1) {
    indexes.push(x, ((height - 1) * width) + x);
  }

  for (let y = 1; y < height - 1; y += 1) {
    indexes.push(y * width, (y * width) + width - 1);
  }

  return indexes;
}

function dominantEdgeColor(data, width, height, alphaThreshold) {
  const colorBuckets = new Map();
  let opaqueEdgePixels = 0;

  for (const pixelIndex of edgePixelIndexes(width, height)) {
    const offset = pixelIndex * 4;

    if (data[offset + 3] <= alphaThreshold) {
      continue;
    }

    opaqueEdgePixels += 1;
    const key = `${data[offset] >> 5}:${data[offset + 1] >> 5}:${data[offset + 2] >> 5}`;
    const bucket = colorBuckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += data[offset];
    bucket.green += data[offset + 1];
    bucket.blue += data[offset + 2];
    colorBuckets.set(key, bucket);
  }

  const dominantBucket = [...colorBuckets.values()]
    .sort((left, right) => right.count - left.count)[0];

  if (!dominantBucket || !opaqueEdgePixels) {
    return null;
  }

  return {
    red: dominantBucket.red / dominantBucket.count,
    green: dominantBucket.green / dominantBucket.count,
    blue: dominantBucket.blue / dominantBucket.count,
    edgeShare: dominantBucket.count / opaqueEdgePixels
  };
}

function colorDistanceSquared(data, offset, color) {
  const redDistance = data[offset] - color.red;
  const greenDistance = data[offset + 1] - color.green;
  const blueDistance = data[offset + 2] - color.blue;

  return (redDistance ** 2) + (greenDistance ** 2) + (blueDistance ** 2);
}

export function removeEdgeConnectedBackground(imageData, width, height, options = {}) {
  const source = imageData?.data || imageData;
  const output = new Uint8ClampedArray(source || []);
  const alphaThreshold = Number(options.alphaThreshold ?? 16);
  const minimumEdgeShare = Number(options.minimumEdgeShare ?? 0.3);
  const tolerance = Math.max(1, Number(options.tolerance ?? 48));
  const featherTolerance = Math.max(tolerance, Number(options.featherTolerance ?? tolerance + 24));

  if (!width || !height || output.length !== width * height * 4) {
    return { data: output, removedPixelCount: 0, backgroundColor: null };
  }

  const backgroundColor = dominantEdgeColor(output, width, height, alphaThreshold);

  if (!backgroundColor || backgroundColor.edgeShare < minimumEdgeShare) {
    return { data: output, removedPixelCount: 0, backgroundColor: null };
  }

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const toleranceSquared = tolerance ** 2;
  const featherToleranceSquared = featherTolerance ** 2;
  let queueStart = 0;
  let queueEnd = 0;
  let removedPixelCount = 0;

  function addMatchingPixel(pixelIndex) {
    if (visited[pixelIndex]) {
      return;
    }

    const offset = pixelIndex * 4;
    const alpha = output[offset + 3];
    const distanceSquared = colorDistanceSquared(output, offset, backgroundColor);

    if (alpha > alphaThreshold && distanceSquared > featherToleranceSquared) {
      return;
    }

    visited[pixelIndex] = 1;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;

    if (alpha <= alphaThreshold || distanceSquared <= toleranceSquared) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 0;
      removedPixelCount += 1;
      return;
    }

    const distance = Math.sqrt(distanceSquared);
    const retainedShare = (distance - tolerance) / (featherTolerance - tolerance || 1);
    output[offset + 3] = Math.round(alpha * retainedShare);
  }

  for (const pixelIndex of edgePixelIndexes(width, height)) {
    addMatchingPixel(pixelIndex);
  }

  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    queueStart += 1;

    if (x > 0) addMatchingPixel(pixelIndex - 1);
    if (x + 1 < width) addMatchingPixel(pixelIndex + 1);
    if (y > 0) addMatchingPixel(pixelIndex - width);
    if (y + 1 < height) addMatchingPixel(pixelIndex + width);
  }

  return { data: output, removedPixelCount, backgroundColor };
}

function imageWithTransparentEdgeBackground(image, width, height, settings) {
  if (!settings.removeBackground) {
    return { image, width, height };
  }

  const maximumSide = normalizedPositiveInteger(settings.backgroundRemovalMaxSide) || 1600;
  const scale = Math.min(1, maximumSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error(settings.prepareErrorMessage);
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const transparentPixels = removeEdgeConnectedBackground(pixels, canvas.width, canvas.height, {
    minimumEdgeShare: settings.backgroundRemovalMinimumEdgeShare,
    tolerance: settings.backgroundRemovalTolerance,
    featherTolerance: settings.backgroundRemovalFeatherTolerance
  });
  pixels.data.set(transparentPixels.data);
  context.putImageData(pixels, 0, 0);

  return { image: canvas, width: canvas.width, height: canvas.height };
}

function canvasPlansForImage(width, height, settings) {
  const targetWidth = normalizedPositiveInteger(settings.targetWidth);
  const targetHeight = normalizedPositiveInteger(settings.targetHeight);

  if (targetWidth && targetHeight) {
    return scaleStepsForImage(targetWidth, targetHeight, settings.maxSideCandidates)
      .map((scale) => ({
        width: Math.max(1, Math.round(targetWidth * scale)),
        height: Math.max(1, Math.round(targetHeight * scale))
      }));
  }

  return scaleStepsForImage(width, height, settings.maxSideCandidates)
    .map((scale) => ({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    }));
}

function drawImageContained(context, image, imageWidth, imageHeight, canvasWidth, canvasHeight) {
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const drawWidth = Math.max(1, Math.round(imageWidth * scale));
  const drawHeight = Math.max(1, Math.round(imageHeight * scale));
  const drawX = Math.round((canvasWidth - drawWidth) / 2);
  const drawY = Math.round((canvasHeight - drawHeight) / 2);

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

export async function imageFileToPngUnderLimit(file, options = {}) {
  const settings = {
    maxBytes: 2 * 1024 * 1024,
    maxSourceBytes: defaultMaxSourceFileBytes,
    filename: 'upload-image.png',
    preserveSmallPng: false,
    targetWidth: 0,
    targetHeight: 0,
    backgroundColor: 'transparent',
    removeBackground: false,
    backgroundRemovalMaxSide: 1600,
    backgroundRemovalMinimumEdgeShare: 0.3,
    backgroundRemovalTolerance: 48,
    backgroundRemovalFeatherTolerance: 72,
    maxSideCandidates: [1600, 1400, 1200, 1000, 900, 800, 700, 600, 500, 420, 360, 300, 240],
    emptyMessage: 'Bitte eine Bilddatei auswählen.',
    typeMessage: 'Bitte ein PNG-, JPEG- oder WebP-Bild auswählen.',
    sourceTooLargeMessage: 'Die Originaldatei ist zu gross. Bitte maximal 25 MB auswählen.',
    readErrorMessage: 'Bild konnte nicht gelesen werden.',
    prepareErrorMessage: 'Bild konnte nicht vorbereitet werden.',
    outputTooLargeMessage: 'Bild konnte nicht klein genug vorbereitet werden. Bitte ein weniger detailreiches Bild verwenden.',
    ...options
  };

  validateImageFile(file, settings);

  if (
    settings.preserveSmallPng
    && !normalizedPositiveInteger(settings.targetWidth)
    && !normalizedPositiveInteger(settings.targetHeight)
    && String(file.type || '').toLowerCase() === 'image/png'
    && file.size <= settings.maxBytes
  ) {
    return file;
  }

  const image = await imageFromFile(file, settings.readErrorMessage);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) {
    if (typeof image.close === 'function') {
      image.close();
    }

    throw new Error(settings.readErrorMessage);
  }

  try {
    const preparedImage = imageWithTransparentEdgeBackground(image, width, height, settings);

    for (const canvasPlan of canvasPlansForImage(width, height, settings)) {
      const canvas = document.createElement('canvas');
      canvas.width = canvasPlan.width;
      canvas.height = canvasPlan.height;

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error(settings.prepareErrorMessage);
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      if (settings.backgroundColor && settings.backgroundColor !== 'transparent') {
        context.fillStyle = settings.backgroundColor;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      drawImageContained(
        context,
        preparedImage.image,
        preparedImage.width,
        preparedImage.height,
        canvas.width,
        canvas.height
      );

      const pngBlob = await canvasToPngBlob(canvas, settings.prepareErrorMessage);

      if (pngBlob.size <= settings.maxBytes) {
        return fileFromPngBlob(pngBlob, settings.filename);
      }
    }
  } finally {
    if (typeof image.close === 'function') {
      image.close();
    }
  }

  throw new Error(settings.outputTooLargeMessage);
}
