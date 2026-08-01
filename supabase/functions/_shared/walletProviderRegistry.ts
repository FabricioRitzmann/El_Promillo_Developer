import { appleWalletProvider } from './appleWalletProvider.ts';
import { googleWalletProvider } from './googleWalletProvider.ts';
import { samsungWalletProvider } from './samsungWalletProvider.ts';
import { normalizeTemplateType } from './templateFeatures.ts';

type Row = Record<string, any>;

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function firstBusiness(template: Row = {}) {
  return Array.isArray(template.businesses) ? template.businesses[0] : template.businesses;
}

function configuredHttpsUrl(value: unknown) {
  const text = stringValue(value);
  return /^https:\/\//i.test(text) ? text : '';
}

function hasSamsungDeviceHint(userAgent = '') {
  const text = stringValue(userAgent).toLowerCase();

  return ['samsung', 'sm-', 'samsungbrowser', 'galaxy'].some((hint) => text.includes(hint));
}

function providerPrepared(provider: string, action: string, reason: string) {
  return {
    ok: false,
    provider,
    action,
    status: 'prepared',
    error_code: `${provider.toUpperCase()}_${action.toUpperCase()}_CONTEXT_REQUIRED`,
    error_message: `${provider} ${action} braucht zusätzlichen serverseitigen Kontext.`,
    error_reason: reason
  };
}

export function walletCardModel(template: Row = {}, cardInstance: Row = {}) {
  const business = firstBusiness(template) || {};
  const customer = cardInstance.customer_cards || {};
  const metadata = {
    ...(customer.metadata && typeof customer.metadata === 'object' ? customer.metadata : {}),
    ...(cardInstance.metadata && typeof cardInstance.metadata === 'object' ? cardInstance.metadata : {})
  };
  const settings = template.settings && typeof template.settings === 'object' ? template.settings : {};
  const cardCode = stringValue(
    cardInstance.card_instance_number
    || customer.card_instance_number
    || cardInstance.customer_code
    || customer.customer_code
    || cardInstance.ref_id
  );
  const balanceCents = numberValue(cardInstance.balance_cents ?? customer.balance_cents ?? metadata.balance_cents);
  const currency = stringValue(cardInstance.currency || customer.currency || settings.currency || 'CHF');

  return {
    business: {
      id: stringValue(template.business_id || cardInstance.business_id),
      name: stringValue(business.name || business.company_name || template.business_name || 'El Promillo')
    },
    customer: {
      id: stringValue(cardInstance.customer_id || customer.id),
      memberId: cardCode
    },
    card: {
      id: stringValue(cardInstance.id || customer.id),
      providerId: stringValue(cardInstance.wallet_object_id || cardInstance.apple_serial_number || cardInstance.google_object_id || cardInstance.ref_id),
      serialNumber: stringValue(cardInstance.wallet_serial_number || customer.wallet_serial_number || customer.pass_serial_number || cardInstance.ref_id),
      status: stringValue(cardInstance.status || customer.status || cardInstance.card_status || 'active'),
      expiration: stringValue(cardInstance.expires_at || customer.expires_at || metadata.expires_at || settings.expirationDate)
    },
    template: {
      id: stringValue(template.id || cardInstance.template_id),
      type: normalizeTemplateType(template),
      title: stringValue(template.card_name || template.name || 'Kundenkarte'),
      subtitle: stringValue(template.card_type || template.template_type),
      description: stringValue(template.description)
    },
    branding: {
      logo: stringValue(business.logo_url || business.company_logo_url || template.business_logo_url || template.company_logo_url || template.logo_url),
      heroImage: stringValue(template.hero_image_url || settings.heroImageUrl),
      thumbnail: stringValue(template.thumbnail_url || settings.thumbnailUrl),
      primaryColor: stringValue(template.primary_color || '#fffaf2'),
      secondaryColor: stringValue(settings.secondaryColor || '#d6b889'),
      textColor: stringValue(template.text_color || '#5b3423'),
      background: stringValue(template.background || settings.background || template.primary_color || '#fffaf2'),
      title: stringValue(template.card_name || template.name || 'Kundenkarte'),
      subtitle: stringValue(business.name || business.company_name || template.business_name),
      description: stringValue(template.description)
    },
    codes: {
      barcode: cardCode,
      qrCode: cardCode,
      pdf417: stringValue(metadata.pdf417),
      aztec: stringValue(metadata.aztec)
    },
    loyalty: {
      points: numberValue(cardInstance.loyalty_points ?? customer.loyalty_points ?? metadata.loyalty_points),
      balance: {
        cents: balanceCents,
        currency
      },
      coupons: Array.isArray(metadata.coupons) ? metadata.coupons : [],
      stampCounter: numberValue(cardInstance.current_stamps ?? customer.stamp_count ?? metadata.stamp_count),
      streakCounter: numberValue(cardInstance.current_streak ?? customer.streak_count ?? metadata.streak_count),
      rewards: stringValue(template.reward_text || settings.rewardText || settings.reward_text),
      membershipLevel: stringValue(cardInstance.vip_level || customer.vip_status || template.vip_tier || settings.vipDefaultTier)
    },
    notifications: {
      pushEnabled: Boolean(cardInstance.push_enabled ?? true),
      lastNotificationAt: stringValue(cardInstance.last_notification_at)
    },
    geoLocations: Array.isArray(settings.locations) ? settings.locations : [],
    dynamicFields: metadata.dynamic_fields || {},
    customFields: metadata.custom_fields || settings.customFields || {}
  };
}

function supportFromUserAgent(provider: string, userAgent = '') {
  const text = stringValue(userAgent).toLowerCase();

  if (provider === 'apple') {
    return {
      provider,
      supported: /iphone|ipad|ipod/.test(text),
      reason: /iphone|ipad|ipod/.test(text) ? 'apple_mobile' : 'manual_choice_required'
    };
  }

  if (provider === 'google') {
    return {
      provider,
      supported: text.includes('android') && !hasSamsungDeviceHint(text),
      reason: text.includes('android') && !hasSamsungDeviceHint(text) ? 'android_device_detected' : 'manual_choice_required'
    };
  }

  return samsungWalletProvider.detectSupport(userAgent);
}

export const walletProviders = {
  apple: {
    async create(template: Row, instance: Row, options: Row = {}) {
      if (!options.supabaseAdmin) {
        return providerPrepared('apple', 'create', 'Apple Pass-Erzeugung braucht den Supabase Admin Client, damit Pass-Versionen und Auth-Token serverseitig gespeichert werden.');
      }

      return appleWalletProvider.issuePass(options.supabaseAdmin, template, instance);
    },

    async update(instance: Row, fields: Row = {}, options: Row = {}) {
      if (!options.supabaseAdmin || !options.template) {
        return providerPrepared('apple', 'update', 'Apple Pass-Updates brauchen Supabase Admin Client und Template-Kontext.');
      }

      return appleWalletProvider.updatePassFields(options.supabaseAdmin, instance, options.template, fields, {
        reason: 'wallet_provider_registry_update'
      });
    },

    async delete(_instance: Row, _options: Row = {}) {
      return providerPrepared('apple', 'delete', 'Apple Wallet löscht installierte Pässe nicht serverseitig; Geräte deregistrieren sich über den Apple Wallet Web Service.');
    },

    async revoke(_instance: Row, _options: Row = {}) {
      return providerPrepared('apple', 'revoke', 'Apple-Revoke wird als Pass-Statusänderung plus Push-Update umgesetzt, nicht als separater Provider-Delete-Call.');
    },

    generateAddLink(_template: Row, _instance: Row, options: Row = {}) {
      return {
        ok: Boolean(configuredHttpsUrl(options.claimUrl)),
        provider: 'apple',
        action: 'generateAddLink',
        addUrl: configuredHttpsUrl(options.claimUrl),
        error_code: configuredHttpsUrl(options.claimUrl) ? null : 'APPLE_CLAIM_URL_REQUIRED'
      };
    },

    generateQRCode(template: Row, instance: Row, options: Row = {}) {
      const link = this.generateAddLink(template, instance, options);
      return link.ok ? { ...link, qrData: link.addUrl } : link;
    },

    detectSupport(userAgent = '') {
      return supportFromUserAgent('apple', userAgent);
    },

    serialize(value: Row = {}) {
      return JSON.stringify(value);
    },

    deserialize(value: string) {
      try {
        return JSON.parse(value);
      } catch (_error) {
        return {};
      }
    },

    mapping(template: Row, instance: Row) {
      return walletCardModel(template, instance);
    }
  },

  google: {
    create(template: Row, instance: Row) {
      return googleWalletProvider.createObject(template, instance);
    },

    update(instance: Row, fields: Row = {}, options: Row = {}) {
      const objectType = stringValue(options.objectType || googleWalletProvider.objectTypeForTemplate(options.template || {}));
      const objectId = stringValue(options.objectId || instance.google_object_id || instance.wallet_object_id);

      if (!objectType || !objectId) {
        return providerPrepared('google', 'update', 'Google Updates brauchen objectType und objectId aus google_wallet_objects oder card_instances.');
      }

      return googleWalletProvider.updateObject(objectType, objectId, fields);
    },

    async delete(_instance: Row, _options: Row = {}) {
      return providerPrepared('google', 'delete', 'Google Wallet Objects werden im MVP nicht direkt geloescht; Statusaenderungen laufen ueber updateObject.');
    },

    async revoke(_instance: Row, _options: Row = {}) {
      return providerPrepared('google', 'revoke', 'Google Revoke wird im MVP als Object-Status-/Message-Update modelliert.');
    },

    generateAddLink(template: Row, instance: Row) {
      return googleWalletProvider.generateSaveLink(template, instance);
    },

    async generateQRCode(template: Row, instance: Row) {
      const link = await googleWalletProvider.generateSaveLink(template, instance);
      return link.ok ? { ...link, qrData: link.saveUrl } : link;
    },

    detectSupport(userAgent = '') {
      return supportFromUserAgent('google', userAgent);
    },

    serialize(value: Row = {}) {
      return JSON.stringify(value);
    },

    deserialize(value: string) {
      try {
        return JSON.parse(value);
      } catch (_error) {
        return {};
      }
    },

    mapping(template: Row, instance: Row) {
      return walletCardModel(template, instance);
    }
  },

  samsung: {
    ...samsungWalletProvider,

    mapping(template: Row, instance: Row) {
      return walletCardModel(template, instance);
    },

    providerMapping(template: Row, instance: Row, options: Row = {}) {
      return samsungWalletProvider.mapping(template, instance, options);
    },

    cardDataForInstance(template: Row, instance: Row, options: Row = {}) {
      return samsungWalletProvider.cardDataForInstance(template, instance, options);
    }
  }
};

export function walletProviderFor(provider: string) {
  return walletProviders[provider as keyof typeof walletProviders] || null;
}
