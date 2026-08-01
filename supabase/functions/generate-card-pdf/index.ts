// Supabase Edge Function: QR-/Karten-PDFs für A4/A5.
//
// Erzeugt eine druckbare PDF mit Wallet-Vorschau links und separatem Claim-QR
// rechts. Die Vorschau nutzt die zentrale Template-Feature-Matrix, damit nur
// Felder erscheinen, die zum Template gehören.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import QRCode from 'https://esm.sh/qrcode@1.5.4';
import { assertFeatureAllowed, featureEnabled, normalizeTemplateType } from '../_shared/templateFeatures.ts';

type Row = Record<string, any>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

const pageSizes: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  a5: [419.53, 595.28]
};

const templateTypeLabels: Record<string, string> = {
  stamp_card: 'Stempelkarte',
  streak_card: 'Streak-Karte',
  vip_card: 'VIP-/Memberkarte',
  balance_card: 'Aufladbare Guthabenkarte',
  cloakroom_card: 'Garderobenkarte',
  generic_card: 'Generische Basiskarte',
  event_card: 'Eventkarte',
  coupon_card: 'Couponkarte',
  membership_card: 'Mitgliedskarte',
  club_card: 'Clubkarte'
};

const featureLabels: Record<string, string> = {
  stamps: 'Stempel',
  streak: 'Streak',
  vip: 'VIP',
  balance: 'Guthaben',
  cloakroom: 'Garderobe',
  visit: 'Besuch',
  checkin: 'Check-in',
  redemption: 'Einlösung',
  coupon: 'Coupon',
  membership: 'Mitgliedschaft',
  customFields: 'Freifelder'
};

const pdfTemplateSelect = [
  'id',
  'owner_id',
  'business_id',
  'business_name',
  'card_name',
  'card_type',
  'template_type',
  'description',
  'primary_color',
  'text_color',
  'logo_url',
  'businesses(name,logo_url)',
  'reward_text',
  'stamps_required',
  'streak_goal',
  'vip_tier',
  'settings',
  'club_features',
  'club_settings',
  'public_claim_token',
  'is_active'
].join(',');

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

function createStructuredError(statusCode: number, errorCode: string, message: string, reason: string) {
  return {
    statusCode,
    error_code: errorCode,
    error_message: message,
    error_reason: reason
  };
}

function errorJson(error: any) {
  const status = Number(error?.statusCode || error?.status || 500);

  return json({
    error: error?.message || error?.error_message || 'Unbekannter Fehler',
    error_code: error?.error_code || 'PDF_GENERATION_ERROR',
    error_message: error?.error_message || error?.message || 'PDF konnte nicht erzeugt werden.',
    error_reason: error?.error_reason || 'Bitte prüfe Template und Konfiguration.'
  }, status);
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function pdfText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

function hexToRgb01(hexColor: unknown, fallback = '#111827') {
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

function textLine(text: unknown, x: number, y: number, size = 11, color = [0.1, 0.1, 0.1]) {
  return [
    'BT',
    `/F1 ${size} Tf`,
    `${color.map((value) => value.toFixed(3)).join(' ')} rg`,
    `${x.toFixed(2)} ${y.toFixed(2)} Td`,
    `(${pdfText(text)}) Tj`,
    'ET'
  ].join('\n');
}

function rect(x: number, y: number, width: number, height: number, color: number[]) {
  return [
    `${color.map((value) => value.toFixed(3)).join(' ')} rg`,
    `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`
  ].join('\n');
}

function templateBusiness(template: Row) {
  return Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;
}

function businessNameForTemplate(template: Row) {
  const business = templateBusiness(template);
  return stringValue(business?.name || template.business_name || 'Business') || 'Business';
}

function businessInitials(template: Row) {
  return businessNameForTemplate(template)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'B';
}

function logoMark(template: Row, x: number, y: number, size: number, background: number[], foreground: number[]) {
  return [
    rect(x, y, size, size, background),
    textLine(businessInitials(template), x + (size * 0.25), y + (size * 0.35), size * 0.34, foreground)
  ].join('\n');
}

function drawQr(content: string, x: number, y: number, size: number) {
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

function templateTypeLabel(template: Row) {
  return templateTypeLabels[normalizeTemplateType(template)] || 'Karte';
}

function featureLabel(featureName: string) {
  return featureLabels[featureName] || featureName;
}

function featureRows(template: Row) {
  const settings = template.settings && typeof template.settings === 'object' ? template.settings : {};
  const rows: Array<{ label: string; value: string }> = [];

  if (normalizeTemplateType(template) === 'club_card') {
    if (featureEnabled(template, 'membership')) {
      rows.push({ label: 'Mitgliedsnummer', value: settings.membershipNumber || settings.membershipStatus || 'Aktiv' });
    }

    if (featureEnabled(template, 'vip')) {
      rows.push({ label: featureLabel('vip'), value: template.vip_tier || settings.membershipStatus || 'Member' });
    }

    if (featureEnabled(template, 'balance')) {
      rows.push({ label: featureLabel('balance'), value: `0.00 ${settings.currency || 'CHF'}` });
    }

    if (featureEnabled(template, 'membership')) {
      rows.push({ label: 'Mitgliedsstatus', value: [settings.membershipStatus || 'Aktiv', settings.membershipExpiresAt ? `bis ${settings.membershipExpiresAt}` : ''].filter(Boolean).join(' ') });
    }

    if (featureEnabled(template, 'redemption')) {
      rows.push({ label: settings.couponTitle || 'Coupon', value: settings.discountValue || 'Offen' });
    }

    if (featureEnabled(template, 'cloakroom')) {
      rows.push({ label: featureLabel('cloakroom'), value: 'Bereit' });
    }

    if (featureEnabled(template, 'customFields') && settings.customFieldsText) {
      rows.push({ label: featureLabel('customFields'), value: String(settings.customFieldsText).slice(0, 34) });
    }

    return rows;
  }

  if (featureEnabled(template, 'stamps')) {
    rows.push({ label: featureLabel('stamps'), value: `0/${template.stamps_required || 10}` });
  }

  if (featureEnabled(template, 'streak')) {
    rows.push({ label: featureLabel('streak'), value: template.streak_goal || settings.streakGoal ? `0/${template.streak_goal || settings.streakGoal}` : '0' });
  }

  if (featureEnabled(template, 'vip')) {
    rows.push({ label: featureLabel('vip'), value: template.vip_tier || settings.membershipStatus || 'Member' });
  }

  if (featureEnabled(template, 'balance')) {
    rows.push({ label: featureLabel('balance'), value: `0.00 ${settings.currency || 'CHF'}` });
  }

  if (featureEnabled(template, 'cloakroom')) {
    rows.push({ label: featureLabel('cloakroom'), value: 'Bereit' });
  }

  if (featureEnabled(template, 'visit')) {
    rows.push({ label: featureLabel('visit'), value: '0' });
  }

  if (featureEnabled(template, 'checkin')) {
    rows.push({ label: featureLabel('checkin'), value: settings.eventName || 'Event' });
  }

  if (featureEnabled(template, 'redemption')) {
    rows.push({ label: featureLabel('redemption'), value: settings.couponTitle || settings.discountValue || 'Coupon' });
  }

  if (featureEnabled(template, 'membership')) {
    rows.push({ label: featureLabel('membership'), value: settings.membershipStatus || 'Aktiv' });
  }

  if (featureEnabled(template, 'customFields') && settings.customFieldsText) {
    rows.push({ label: featureLabel('customFields'), value: String(settings.customFieldsText).slice(0, 34) });
  }

  return rows;
}

function templateFeatureSummary(template: Row) {
  const rows = featureRows(template);
  return rows.length ? rows.map((row) => row.label).join(', ') : 'Basiskarte';
}

function buildPdfContent(template: Row, claimUrl: string, pageWidth: number, pageHeight: number) {
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
  const rows = featureRows(template).slice(0, 3);
  const activeFeatures = featureRows(template).map((row) => row.label);
  const rowLines = rows.map((row, index) => (
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
    ...rowLines,
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

function pdfObject(content: string) {
  return `${content}\n`;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function buildTemplateQrPdf(template: Row, claimUrl: string, format: string) {
  const normalizedFormat = String(format || 'a4').toLowerCase() === 'a5' ? 'a5' : 'a4';
  const [pageWidth, pageHeight] = pageSizes[normalizedFormat];
  const content = buildPdfContent(template, claimUrl, pageWidth, pageHeight);
  const streamLength = byteLength(content);
  const objects = [
    pdfObject('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'),
    pdfObject('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj'),
    pdfObject(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj`),
    pdfObject('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj'),
    pdfObject(`5 0 obj\n<< /Length ${streamLength} >>\nstream\n${content}\nendstream\nendobj`)
  ];
  const header = '%PDF-1.4\n';
  let body = header;
  const offsets = [0];

  for (const pdfObj of objects) {
    offsets.push(byteLength(body));
    body += pdfObj;
  }

  const xrefOffset = byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';

  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

async function requestBody(request: Request) {
  if (request.method !== 'POST') {
    return {};
  }

  return await request.json().catch(() => ({}));
}

function safeFileName(value: unknown) {
  return String(value || 'karte')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'karte';
}

function claimUrlForTemplate(template: Row, appBaseUrl: string) {
  const token = String(template.public_claim_token || '').trim();
  const path = /^[a-f0-9]{36}$/.test(token)
    ? `/claim.html?token=${encodeURIComponent(token)}`
    : `/claim.html?template=${encodeURIComponent(String(template.id || ''))}`;

  return `${appBaseUrl.replace(/\/$/, '')}${path}`;
}

async function requireAuthenticatedOperator(supabaseAdmin: any, request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    throw createStructuredError(
      401,
      'AUTH_REQUIRED',
      'Bitte erneut einloggen.',
      'Die PDF-Edge-Function braucht einen gültigen Betreiber-Login.'
    );
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !userData?.user) {
    throw createStructuredError(
      401,
      'AUTH_INVALID',
      'Bitte erneut einloggen.',
      'Der Login-Token konnte nicht verifiziert werden.'
    );
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('operator_profiles')
    .select('id, unlock')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError || !profile?.unlock) {
    throw createStructuredError(
      403,
      'OPERATOR_LOCKED',
      'Account nicht freigeschaltet.',
      'QR-PDFs können erst nach Unlock erzeugt werden.'
    );
  }

  return userData.user;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!['GET', 'POST'].includes(request.method)) {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur GET oder POST ist erlaubt.',
      error_reason: 'PDFs können per GET mit Query-Parametern oder per POST erzeugt werden.'
    }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw createStructuredError(
        500,
        'SUPABASE_EDGE_CONFIG_MISSING',
        'Supabase Edge Secrets fehlen.',
        'Setze SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY für diese Edge Function.'
      );
    }

    const url = new URL(request.url);
    const body = await requestBody(request) as Row;
    const templateId = stringValue(body.templateId || body.template_id || url.searchParams.get('templateId') || url.searchParams.get('template'));
    const format = stringValue(body.format || url.searchParams.get('format')) || 'a4';
    const appBaseUrl = stringValue(body.appBaseUrl || body.app_base_url || url.searchParams.get('appBaseUrl') || Deno.env.get('APP_BASE_URL')) || 'http://localhost:3000';

    if (!templateId) {
      throw createStructuredError(
        400,
        'TEMPLATE_ID_REQUIRED',
        'Template fehlt.',
        'Sende templateId oder template als Query-Parameter.'
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const user = await requireAuthenticatedOperator(supabaseAdmin, request);

    const { data: template, error: templateError } = await supabaseAdmin
      .from('card_templates')
      .select(pdfTemplateSelect)
      .eq('id', templateId)
      .eq('owner_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (templateError) {
      throw templateError;
    }

    if (!template) {
      throw createStructuredError(
        404,
        'TEMPLATE_NOT_FOUND',
        'Template nicht gefunden oder inaktiv.',
        'Für dieses Template kann kein QR-PDF erzeugt werden oder es gehört nicht zu deinem Betreiberkonto.'
      );
    }

    try {
      assertFeatureAllowed(template, 'qrPdf');
    } catch (error) {
      throw {
        ...(error as Row),
        statusCode: 403,
        template_type: normalizeTemplateType(template)
      };
    }

    const claimUrl = claimUrlForTemplate(template, appBaseUrl);
    const normalizedFormat = String(format).toLowerCase() === 'a5' ? 'a5' : 'a4';
    const pdf = buildTemplateQrPdf(template, claimUrl, normalizedFormat);
    const fileName = `qr-${safeFileName(template.card_name)}-${normalizedFormat}.pdf`;

    return new Response(pdf, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return errorJson(error);
  }
});
