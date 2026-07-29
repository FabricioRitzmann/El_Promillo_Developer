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

export async function imageFileToPngUnderLimit(file, options = {}) {
  const settings = {
    maxBytes: 2 * 1024 * 1024,
    maxSourceBytes: defaultMaxSourceFileBytes,
    filename: 'upload-image.png',
    preserveSmallPng: false,
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
    for (const scale of scaleStepsForImage(width, height, settings.maxSideCandidates)) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error(settings.prepareErrorMessage);
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

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
