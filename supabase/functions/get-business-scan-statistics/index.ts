// Supabase Edge Function: get-business-scan-statistics.
// Liefert aggregierte, betreiberisolierte Besucherstatistiken aus scan_events.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Row = Record<string, any>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const clubFeatureNames = ['vip', 'balance', 'cloakroom', 'coupon', 'membership'];

function json(body: Row, status = 200) {
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
  return json({
    error: error?.message || error?.error_message || 'Unbekannter Fehler',
    error_code: error?.error_code || 'EDGE_FUNCTION_ERROR',
    error_message: error?.error_message || error?.message || 'Statistik konnte nicht geladen werden.',
    error_reason: error?.error_reason || 'Bitte prüfe die Anfrage und versuche es erneut.'
  }, Number(error?.statusCode || error?.status || 500));
}

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function dateOnly(value: unknown) {
  const text = stringValue(value);

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function numberOrNull(value: unknown) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeStatsFilters(input: Row = {}) {
  return {
    business_id: stringValue(input.business_id || input.businessId) || null,
    date_from: dateOnly(input.date_from || input.dateFrom),
    date_to: dateOnly(input.date_to || input.dateTo),
    template_type: stringValue(input.template_type || input.templateType || 'all') || 'all',
    club_feature: stringValue(input.club_feature || input.clubFeature || 'all') || 'all',
    gender: stringValue(input.gender || 'all') || 'all',
    age_group: stringValue(input.age_group || input.ageGroup || 'all') || 'all',
    scan_type: stringValue(input.scan_type || input.scanType || 'all') || 'all',
    action_type: stringValue(input.action_type || input.actionType || 'all') || 'all',
    hour_from: numberOrNull(input.hour_from ?? input.hourFrom),
    hour_to: numberOrNull(input.hour_to ?? input.hourTo)
  };
}

async function requireAuthenticatedOperator(supabaseAdmin: any, request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    throw createStructuredError(401, 'AUTH_REQUIRED', 'Bitte erneut einloggen.', 'Die Edge Function hat keinen Login-Token erhalten.');
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !userData?.user) {
    throw createStructuredError(401, 'AUTH_INVALID', 'Bitte erneut einloggen.', 'Der Login-Token konnte nicht verifiziert werden.');
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('operator_profiles')
    .select('id, unlock')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile?.unlock) {
    throw createStructuredError(403, 'OPERATOR_LOCKED', 'Account nicht freigeschaltet.', 'Statistiken sind nur für freigeschaltete Betreiber erlaubt.');
  }

  return userData.user;
}

function activeClubFeatureList(features: Row = {}) {
  return clubFeatureNames.filter((featureName) => Boolean(features?.[featureName]));
}

function matchesStatsFilters(row: Row, filters: Row) {
  if (filters.template_type !== 'all' && row.template_type !== filters.template_type) {
    return false;
  }

  if (filters.gender !== 'all' && row.customer_gender !== filters.gender) {
    return false;
  }

  if (filters.age_group !== 'all' && row.customer_age_group !== filters.age_group) {
    return false;
  }

  if (filters.scan_type === 'first_scan' && !row.is_first_scan) {
    return false;
  }

  if (filters.scan_type === 'repeat_scan' && row.is_first_scan) {
    return false;
  }

  if (filters.action_type !== 'all' && row.action_type !== filters.action_type) {
    return false;
  }

  if (filters.club_feature !== 'all') {
    const activeFeatures = activeClubFeatureList(row.active_club_features || {});

    if (row.template_type !== 'club_card') {
      return false;
    }

    if (filters.club_feature === 'multiple') {
      return activeFeatures.length > 1;
    }

    if (!activeFeatures.includes(filters.club_feature)) {
      return false;
    }
  }

  const scanHour = Number(row.scan_hour);

  if (filters.hour_from != null && scanHour < filters.hour_from) {
    return false;
  }

  if (filters.hour_to != null && scanHour >= filters.hour_to) {
    return false;
  }

  return true;
}

function countMap(rows: Row[], keyFn: (row: Row) => unknown) {
  const counts = new Map<any, number>();

  rows.forEach((row) => {
    const key = keyFn(row);

    if (key == null || key === '') {
      return;
    }

    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return counts;
}

function chartFromCounts(counts: Map<any, number>, labels: Row = {}) {
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);

  return Array.from(counts.entries()).map(([key, value]) => ({
    key,
    label: labels[key] || String(key),
    value,
    percentage: total ? Math.round((value / total) * 1000) / 10 : 0
  }));
}

function fixedChart(keys: any[], counts: Map<any, number>, labels: Row = {}) {
  const total = keys.reduce((sum, key) => sum + (counts.get(key) || 0), 0);

  return keys.map((key) => ({
    key,
    label: labels[key] || String(key),
    value: counts.get(key) || 0,
    percentage: total ? Math.round(((counts.get(key) || 0) / total) * 1000) / 10 : 0
  }));
}

function weekdayHourHeatmap(rows: Row[], weekdayLabels: Row) {
  const counts = countMap(rows, (row) => `${row.scan_weekday}_${row.scan_hour}`);

  return [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => Array.from({ length: 24 }, (_, hour) => {
    const key = `${weekday}_${hour}`;

    return {
      key,
      weekday,
      weekday_label: weekdayLabels[weekday] || String(weekday),
      hour,
      hour_label: `${hour}:00`,
      label: `${weekdayLabels[weekday] || weekday} ${hour}:00`,
      value: counts.get(key) || 0
    };
  }));
}

function topKey(counts: Map<any, number>, labels: Row = {}) {
  let top: any = null;
  let topValue = -1;

  counts.forEach((value, key) => {
    if (value > topValue) {
      top = key;
      topValue = value;
    }
  });

  return top == null ? null : labels[top] || top;
}

function buildBusinessScanStatistics(rows: Row[]) {
  const genderLabels = { male: 'Männlich', female: 'Weiblich' };
  const ageOrder = ['18_24', '25_29', '30_39', '40_49', '50_59', '60_69', '70_plus', '18_plus', '25_plus', '30_plus'];
  const ageLabels = {
    '18_24': '18–24', '25_29': '25–29', '30_39': '30–39', '40_49': '40–49',
    '50_59': '50–59', '60_69': '60–69', '70_plus': '70+',
    '18_plus': 'Legacy 18+', '25_plus': 'Legacy 25+', '30_plus': 'Legacy 30+'
  };
  const weekdayLabels = { 1: 'Montag', 2: 'Dienstag', 3: 'Mittwoch', 4: 'Donnerstag', 5: 'Freitag', 6: 'Samstag', 7: 'Sonntag' };
  const hourLabels = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [index, `${index}:00`]));
  const templateLabels = {
    club_card: 'Clubkarte',
    stamp_card: 'Stempelkarte',
    streak_card: 'Streakkarte',
    vip_card: 'VIP-Karte',
    balance_card: 'Guthabenkarte',
    cloakroom_card: 'Garderobenkarte',
    coupon_card: 'Couponkarte',
    membership_card: 'Mitgliedskarte',
    event_card: 'Eventkarte',
    generic_card: 'Generische Karte'
  };
  const clubFeatureLabels = { vip: 'VIP', balance: 'Guthaben', cloakroom: 'Garderobe', coupon: 'Coupon', membership: 'Mitgliedschaft' };
  const totalScans = rows.length;
  const uniqueCardIds = new Set(rows.map((row) => row.card_instance_id || row.customer_card_id).filter(Boolean));
  const genderCounts = countMap(rows, (row) => row.customer_gender);
  const ageCounts = countMap(rows, (row) => row.customer_age_group);
  const hourCounts = countMap(rows, (row) => row.scan_hour);
  const weekdayCounts = countMap(rows, (row) => row.scan_weekday);
  const templateCounts = countMap(rows, (row) => row.template_type);
  const firstScans = rows.filter((row) => row.is_first_scan).length;
  const repeatScans = totalScans - firstScans;
  const clubRows = rows.filter((row) => row.template_type === 'club_card');
  const clubFeatureCounts = new Map<any, number>();
  const clubCombinationCounts = new Map<any, number>();

  clubRows.forEach((row) => {
    const features = activeClubFeatureList(row.active_club_features || {});
    features.forEach((featureName) => clubFeatureCounts.set(featureName, (clubFeatureCounts.get(featureName) || 0) + 1));
    const combination = features.length ? features.map((featureName) => clubFeatureLabels[featureName] || featureName).join(' + ') : 'Keine Module';
    clubCombinationCounts.set(combination, (clubCombinationCounts.get(combination) || 0) + 1);
  });

  const overTimeCounts = countMap(rows, (row) => String(row.scanned_at || '').slice(0, 10));
  const genderAgeCounts = countMap(rows, (row) => `${row.customer_gender || 'unknown'}_${row.customer_age_group || 'unknown'}`);
  const maleCount = genderCounts.get('male') || 0;
  const femaleCount = genderCounts.get('female') || 0;

  return {
    kpis: {
      total_scans: totalScans,
      unique_cards: uniqueCardIds.size,
      first_scans: firstScans,
      repeat_scans: repeatScans,
      male_count: maleCount,
      female_count: femaleCount,
      male_percentage: totalScans ? Math.round((maleCount / totalScans) * 1000) / 10 : 0,
      female_percentage: totalScans ? Math.round((femaleCount / totalScans) * 1000) / 10 : 0,
      top_age_group: topKey(ageCounts, ageLabels),
      top_hour: topKey(hourCounts),
      top_weekday: topKey(weekdayCounts, weekdayLabels),
      top_template_type: topKey(templateCounts, templateLabels),
      top_club_feature: topKey(clubFeatureCounts, clubFeatureLabels),
      average_scans_per_card: uniqueCardIds.size ? Math.round((totalScans / uniqueCardIds.size) * 100) / 100 : 0,
      last_scan_at: rows[0]?.scanned_at || null,
      club_scans_total: clubRows.length,
      club_vip_scans: clubFeatureCounts.get('vip') || 0,
      club_balance_scans: clubFeatureCounts.get('balance') || 0,
      club_cloakroom_scans: clubFeatureCounts.get('cloakroom') || 0,
      club_coupon_scans: clubFeatureCounts.get('coupon') || 0,
      club_membership_scans: clubFeatureCounts.get('membership') || 0,
      top_club_combination: topKey(clubCombinationCounts)
    },
    charts: {
      gender_distribution: chartFromCounts(genderCounts, genderLabels),
      age_group_distribution: fixedChart(ageOrder, ageCounts, ageLabels),
      scans_by_hour: fixedChart(Array.from({ length: 24 }, (_, index) => index), hourCounts, hourLabels),
      scans_by_weekday: fixedChart([1, 2, 3, 4, 5, 6, 7], weekdayCounts, weekdayLabels),
      scans_over_time: chartFromCounts(overTimeCounts).sort((a, b) => String(a.key).localeCompare(String(b.key))),
      gender_age_matrix: chartFromCounts(genderAgeCounts, Object.fromEntries(
        ['male', 'female'].flatMap((gender) => ageOrder.map((ageGroup) => [
          `${gender}_${ageGroup}`,
          `${gender === 'male' ? 'Männlich' : 'Weiblich'} ${ageLabels[ageGroup]}`
        ]))
      )),
      first_vs_repeat: [
        { key: 'first_scan', label: 'Erstbesuche', value: firstScans },
        { key: 'repeat_scan', label: 'Wiederholungsbesuche', value: repeatScans }
      ],
      template_type_distribution: chartFromCounts(templateCounts, templateLabels),
      club_feature_distribution: chartFromCounts(clubFeatureCounts, clubFeatureLabels),
      club_feature_combinations: chartFromCounts(clubCombinationCounts),
      weekday_hour_heatmap: weekdayHourHeatmap(rows, weekdayLabels)
    },
    last_scans: rows.slice(0, 100).map((row) => ({
      id: row.id,
      scanned_at: row.scanned_at,
      scan_hour: row.scan_hour,
      card_instance_id: row.card_instance_id,
      card_instance_number: row.card_instance_number,
      template_id: row.template_id,
      template_name: row.template_name,
      template_type: row.template_type,
      active_club_features: row.active_club_features || {},
      customer_gender: row.customer_gender,
      customer_age_group: row.customer_age_group,
      is_first_scan: row.is_first_scan,
      action_type: row.action_type,
      action_label: row.action_label,
      scanned_by: row.scanned_by,
      last_scanned_at: row.scanned_at,
      scan_count: row.details?.scan_count || null
    }))
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({
      error_code: 'METHOD_NOT_ALLOWED',
      error_message: 'Nur POST ist erlaubt.',
      error_reason: 'Statistiken werden per POST geladen.'
    }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw createStructuredError(500, 'SUPABASE_EDGE_CONFIG_MISSING', 'Supabase Edge Secrets fehlen.', 'Setze SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY.');
    }

    const body = await request.json().catch(() => ({})) as Row;
    const filters = normalizeStatsFilters(body);
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const user = await requireAuthenticatedOperator(supabaseAdmin, request);

    if (filters.business_id) {
      const { data: business, error: businessError } = await supabaseAdmin
        .from('businesses')
        .select('id')
        .eq('id', filters.business_id)
        .eq('owner_id', user.id)
        .maybeSingle();

      if (businessError || !business) {
        throw createStructuredError(403, 'BUSINESS_FORBIDDEN', 'Kein Zugriff auf dieses Business.', 'Statistiken können nur für eigene Businesses geladen werden.');
      }
    }

    let query = supabaseAdmin
      .from('scan_events')
      .select([
        'id',
        'owner_id',
        'business_id',
        'template_id',
        'customer_card_id',
        'card_instance_id',
        'card_instance_number',
        'template_name',
        'scanned_by',
        'scanned_at',
        'scan_hour',
        'scan_weekday',
        'template_type',
        'active_club_features',
        'customer_gender',
        'customer_age_group',
        'is_first_scan',
        'demographics_were_collected',
        'action_type',
        'action_label',
        'details'
      ].join(','))
      .eq('owner_id', user.id)
      .order('scanned_at', { ascending: false })
      .limit(5000);

    if (filters.business_id) {
      query = query.eq('business_id', filters.business_id);
    }

    if (filters.date_from) {
      query = query.gte('scanned_at', `${filters.date_from}T00:00:00.000Z`);
    }

    if (filters.date_to) {
      query = query.lte('scanned_at', `${filters.date_to}T23:59:59.999Z`);
    }

    const { data, error } = await query;

    if (error) {
      throw createStructuredError(500, 'SCAN_STATISTICS_LOAD_FAILED', 'Besucherstatistik konnte nicht geladen werden.', error.message || 'scan_events.select hat einen Fehler zurückgegeben.');
    }

    return json({
      ok: true,
      filters,
      ...buildBusinessScanStatistics((data || []).filter((row: Row) => matchesStatsFilters(row, filters)))
    });
  } catch (error) {
    return errorJson(error);
  }
});
