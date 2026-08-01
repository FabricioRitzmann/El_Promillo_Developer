import { cardFeatureRows, featureEnabled, normalizeTemplateType, templateTypeLabel, templateSettings } from './templateFeatures.js';
import { cardEmblemImageUrl, cardEmblemMeta } from './cardEmblems.js';
import { assetPath } from './path.js';

const appBrandMarkUrl = assetPath('assets/el-promillo-emblem-cutout.png');

export function byId(id) {
  return document.getElementById(id);
}

export function setText(id, value) {
  const element = byId(id);

  if (element) {
    element.textContent = value ?? '';
  }
}

export function showMessage(element, message, type = 'info') {
  if (!element) {
    return;
  }

  element.textContent = message || '';
  element.className = `message ${type}`;
  element.hidden = !message;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function businessDisplayName(business = {}, fallback = 'Mein Unternehmen') {
  return String(
    business?.name
      || business?.company_name
      || business?.business_name
      || business?.businesses?.name
      || fallback
  ).trim() || fallback;
}

export function businessLogoUrl(business = {}) {
  return String(
    business?.logo_url
      || business?.company_logo_url
      || business?.business_logo_url
      || business?.businesses?.logo_url
      || ''
  ).trim();
}

export function businessInitials(name = 'Mein Unternehmen') {
  const parts = String(name || 'Mein Unternehmen')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return 'MU';
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'MU';
}

export function businessLogoMarkup(business = {}, className = 'business-logo-fallback') {
  const name = businessDisplayName(business);
  const logoUrl = businessLogoUrl(business);

  if (logoUrl) {
    return `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(name)}">`;
  }

  return `<span class="${escapeHtml(className)}">${escapeHtml(businessInitials(name))}</span>`;
}

export function renderBusinessHeader(business = {}) {
  const name = businessDisplayName(business);
  const logoUrl = businessLogoUrl(business);

  document.querySelectorAll('[data-business-name]').forEach((element) => {
    element.textContent = name;
  });

  document.querySelectorAll('[data-business-logo]').forEach((element) => {
    element.textContent = '';
    element.classList.toggle('has-image', Boolean(logoUrl));

    if (logoUrl) {
      const image = document.createElement('img');
      image.src = logoUrl;
      image.alt = name;
      image.addEventListener('error', () => {
        element.classList.remove('has-image');
        element.textContent = businessInitials(name);
      }, { once: true });
      element.append(image);
      return;
    }

    element.textContent = businessInitials(name);
  });
}

export function normalizeCode(value) {
  const rawValue = String(value || '').trim();

  try {
    const parsedUrl = new URL(rawValue);
    return parsedUrl.searchParams.get('code')
      || parsedUrl.searchParams.get('customer_code')
      || parsedUrl.searchParams.get('card')
      || rawValue;
  } catch {
    return rawValue;
  }
}

export function cardTypeLabel(type) {
  return templateTypeLabel(type);
}

function featureIconHtml(url, label, { brand = false } = {}) {
  if (url) {
    return `<img class="wallet-feature-icon ${brand ? 'wallet-feature-brand-icon' : ''}" src="${escapeHtml(url)}" alt="">`;
  }

  return `<span class="wallet-feature-icon wallet-feature-fallback">${escapeHtml(label)}</span>`;
}

function stampSlotsHtml(stampValue, stampsRequired, iconUrl = appBrandMarkUrl) {
  const total = Math.max(1, Math.round(Number(stampsRequired) || 10));
  const activeCount = Math.max(0, Math.min(total, Math.round(Number(stampValue) || 0)));

  return `
    <div class="wallet-stamp-strip" aria-label="${escapeHtml(`${activeCount} von ${total} Stempeln`)}">
      ${Array.from({ length: total }, (_, index) => {
        const isActive = index < activeCount;

        return `
          <span class="wallet-stamp-slot ${isActive ? 'is-active' : 'is-open'}">
            <img src="${escapeHtml(iconUrl)}" alt="">
          </span>
        `;
      }).join('')}
    </div>
  `;
}

function escapeCssUrl(value) {
  return String(value || '').replace(/["'()\\\n\r]/g, '');
}

function compactWalletText(value) {
  return String(value ?? '').trim();
}

function compactWalletPreviewText(value, maxLength = 64) {
  const text = compactWalletText(value).replace(/\s+/g, ' ');

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}

function walletPreviewStatusLabel(value) {
  const status = compactWalletText(value).toLowerCase();

  return {
    active: 'Aktiv',
    issued: 'Aktiv',
    redeemed: 'Eingeloest',
    blocked: 'Gesperrt',
    paused: 'Pausiert'
  }[status] || compactWalletText(value || 'Aktiv');
}

function walletPreviewPassFields(template, card, business) {
  const settings = templateSettings(template);
  const featureRows = cardFeatureRows(template, card);
  const cardInstanceNumber = card?.card_instance_number
    || card?.metadata?.card_instance_number
    || card?.customer_code
    || 'Karten-ID';
  const latestMessage = compactWalletText(card?.metadata?.latest_wallet_message || card?.latest_wallet_message);
  const latestMessagePreview = compactWalletPreviewText(latestMessage);
  const headerField = latestMessage
    ? {
      key: 'latestMessage',
      label: 'Update',
      value: latestMessagePreview || 'Neue Nachricht'
    }
    : {
      key: 'currentProgress',
      label: featureRows[0]?.label || 'Status',
      value: featureRows[0]?.value || walletPreviewStatusLabel(card?.customer_cards?.status || card?.status)
    };
  const auxiliaryRows = latestMessage ? featureRows : featureRows.slice(1);
  const templateType = normalizeTemplateType(template);
  const stampValue = Number(card?.stamp_count || card?.current_stamps || 0);
  const streakValue = Number(card?.streak_count || card?.current_streak || 0);
  const stampsRequired = Number(template.stamps_required || 10);
  const streakGoal = Number(template.streak_goal || settings.streakGoal || 0);
  const stampComplete = featureEnabled(template, 'stamps') && card && stampValue >= stampsRequired;
  const streakComplete = featureEnabled(template, 'streak') && card && streakGoal > 0 && streakValue >= streakGoal;
  const rewardVisible = Boolean(template.reward_text) && (
    !card
    || templateType === 'generic_card'
    || featureEnabled(template, 'vip')
    || featureEnabled(template, 'redemption')
    || featureEnabled(template, 'membership')
    || stampComplete
    || streakComplete
  );
  const auxiliaryFields = auxiliaryRows.map((row) => ({
    key: row.key || row.feature || row.label,
    label: row.label,
    value: row.value
  }));

  if (rewardVisible) {
    auxiliaryFields.push({
      key: 'reward',
      label: 'Belohnung',
      value: template.reward_text
    });
  }

  return {
    headerFields: [headerField],
    primaryFields: [
      {
        key: 'cardName',
        label: businessDisplayName(business, 'Business'),
        value: compactWalletText(template.card_name || 'Kundenkarte')
      }
    ],
    secondaryFields: [
      {
        key: 'cardId',
        label: 'Karten-ID',
        value: cardInstanceNumber
      },
      {
        key: 'type',
        label: 'Typ',
        value: cardTypeLabel(template)
      }
    ],
    auxiliaryFields: auxiliaryFields.slice(0, 4),
    cardInstanceNumber
  };
}

function walletFieldHtml(field, className = '') {
  if (!field?.value) {
    return '';
  }

  return `
    <div class="wallet-pass-field ${escapeHtml(className)}">
      <span>${escapeHtml(field.label)}</span>
      <strong>${escapeHtml(field.value)}</strong>
    </div>
  `;
}

function walletFieldSetHtml(fields, className = '') {
  const visibleFields = fields.filter((field) => field?.value);

  if (!visibleFields.length) {
    return '';
  }

  return `
    <div class="${escapeHtml(className)}">
      ${visibleFields.map((field) => walletFieldHtml(field)).join('')}
    </div>
  `;
}

export function walletPreviewHtml(template, card = null) {
  const isEventCard = normalizeTemplateType(template) === 'event_card';
  const settings = templateSettings(template);
  const business = {
    name: template.business_name,
    business_name: template.business_name,
    logo_url: template.business_logo_url || template.logo_url,
    business_logo_url: template.business_logo_url || template.logo_url,
    company_logo_url: template.company_logo_url
  };
  const cardEmblemUrl = cardEmblemImageUrl(card || {}, { fallbackUrl: appBrandMarkUrl });
  const passFields = walletPreviewPassFields(template, card, business);
  const headerFieldsHtml = passFields.headerFields.map((field) => walletFieldHtml(field, 'wallet-pass-header-field')).join('');
  const primaryFieldsHtml = walletFieldSetHtml(passFields.primaryFields, 'wallet-pass-primary-fields');
  const secondaryFieldsHtml = walletFieldSetHtml(passFields.secondaryFields, 'wallet-pass-secondary-fields');
  const auxiliaryFieldsHtml = walletFieldSetHtml(passFields.auxiliaryFields, 'wallet-pass-auxiliary-fields');
  const eventBackgroundImageUrl = isEventCard && featureEnabled(template, 'eventBackgroundImage')
    ? settings.eventAppleBackgroundImageUrl || settings.eventGoogleHeroImageUrl || settings.eventBackgroundImageUrl
    : '';
  const eventBackgroundStyle = eventBackgroundImageUrl
    ? ` background-image: linear-gradient(rgba(91, 52, 35, 0.28), rgba(91, 52, 35, 0.28)), url('${escapeCssUrl(eventBackgroundImageUrl)}'); background-size: cover, contain; background-position: center; background-repeat: no-repeat;`
    : '';

  return `
    <div class="wallet-preview ${isEventCard ? 'wallet-preview-event' : ''}" style="--card-bg: ${escapeHtml(template.primary_color || '#fffaf2')}; --card-fg: ${escapeHtml(template.text_color || '#5b3423')}; --card-emblem: url('${escapeCssUrl(cardEmblemUrl)}');${eventBackgroundStyle}">
      <div class="wallet-top">
        <div class="wallet-brand-lockup ${isEventCard ? 'wallet-brand-lockup-event' : ''}">
          ${businessLogoMarkup(business, 'wallet-logo-placeholder')}
          <span>${escapeHtml(businessDisplayName(business, 'Business'))}</span>
        </div>
        <div class="wallet-header-fields">
          ${headerFieldsHtml}
        </div>
      </div>
      <div class="wallet-pass-main">
        ${primaryFieldsHtml}
        ${secondaryFieldsHtml}
        ${auxiliaryFieldsHtml}
      </div>
      <div class="wallet-pass-barcode" aria-label="${escapeHtml(`QR ${passFields.cardInstanceNumber}`)}">
        <div class="wallet-pass-qr" aria-hidden="true"></div>
        <strong>${escapeHtml(passFields.cardInstanceNumber)}</strong>
      </div>
    </div>
  `;
}
