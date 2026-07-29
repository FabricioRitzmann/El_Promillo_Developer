const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '20minutemail.com',
  '33mail.com',
  'anonaddy.com',
  'dispostable.com',
  'example.com',
  'example.net',
  'example.org',
  'fakeinbox.com',
  'guerrillamail.com',
  'mailinator.com',
  'maildrop.cc',
  'moakt.com',
  'sharklasers.com',
  'tempmail.com',
  'tempmail.net',
  'trashmail.com',
  'yopmail.com'
]);

export function normalizeOperatorEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateOperatorEmail(value) {
  const email = normalizeOperatorEmail(value);
  const parts = email.split('@');
  const domain = parts[1] || '';
  const labels = domain.split('.');
  const tld = labels[labels.length - 1] || '';

  if (!email) {
    return {
      ok: false,
      email,
      message: 'Bitte gib eine echte geschäftliche E-Mail-Adresse ein.'
    };
  }

  if (
    parts.length !== 2
    || email.length > 254
    || /\s/.test(email)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)
    || labels.some((label) => !label || label.startsWith('-') || label.endsWith('-'))
    || tld.length < 2
  ) {
    return {
      ok: false,
      email,
      message: 'Bitte verwende eine echte, erreichbare E-Mail-Adresse.'
    };
  }

  if (
    domain === 'localhost'
    || domain.endsWith('.local')
    || domain.endsWith('.invalid')
    || DISPOSABLE_EMAIL_DOMAINS.has(domain)
  ) {
    return {
      ok: false,
      email,
      message: 'Bitte verwende keine Test-, Wegwerf- oder Platzhalter-Adresse.'
    };
  }

  return {
    ok: true,
    email,
    message: ''
  };
}
