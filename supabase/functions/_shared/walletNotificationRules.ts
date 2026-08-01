export type Row = Record<string, any>;

const ALLOWED_TARGET_TYPES = new Set([
  'all_active',
  'template',
  'platform_apple',
  'platform_google',
  'stamp_count',
  'streak_count',
  'vip_level',
  'balance_range',
  'cloakroom_open',
  'event',
  'coupon_unredeemed',
  'membership_status'
]);
const ALLOWED_RECURRENCES = new Set(['daily', 'weekly', 'biweekly', 'monthly']);

function fail(errorCode: string, errorMessage: string, errorReason: string) {
  const error: any = new Error(errorMessage);
  error.status = 400;
  error.error_code = errorCode;
  error.error_message = errorMessage;
  error.error_reason = errorReason;
  throw error;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function dateText(value: unknown) {
  const valueText = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : '';
}

function timeText(value: unknown) {
  const valueText = text(value).slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(valueText) ? valueText : '';
}

function dateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function timeParts(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute };
}

function dateKey(parts: Row) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addDays(parts: Row, count: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count, 12));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function zonedDateTimeToUtc(dateValue: string, timeValue: string, timeZone: string) {
  const date = dateParts(dateValue);
  const time = timeParts(timeValue);
  const desiredAsUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
  let guess = desiredAsUtc;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = localParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desiredAsUtc - actualAsUtc;
  }

  return new Date(guess);
}

function isoWeekday(parts: Row) {
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
  return day === 0 ? 7 : day;
}

function daysBetween(left: Row, right: Row) {
  const leftMs = Date.UTC(left.year, left.month - 1, left.day, 12);
  const rightMs = Date.UTC(right.year, right.month - 1, right.day, 12);
  return Math.floor((rightMs - leftMs) / 86400000);
}

function normalizeWeekdays(value: unknown) {
  const entries = Array.isArray(value) ? value : [];
  return [...new Set(entries.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);
}

function targetFilter(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function validTimeZone(value: unknown) {
  const candidate = text(value) || 'Europe/Zurich';

  try {
    new Intl.DateTimeFormat('de-CH', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (_) {
    fail('INVALID_TIME_ZONE', 'Zeitzone ist ungültig.', 'Verwende eine gültige IANA-Zeitzone wie Europe/Zurich.');
  }
}

function localToday(timeZone: string) {
  return dateKey(localParts(new Date(), timeZone));
}

function ruleMatchesDate(rule: Row, parts: Row) {
  const weekday = isoWeekday(parts);
  const weekdays = normalizeWeekdays(rule.weekdays);

  if (rule.trigger_type === 'location_based') {
    return weekdays.includes(weekday);
  }

  if (rule.recurrence === 'daily') {
    return true;
  }

  if (rule.recurrence === 'monthly') {
    return parts.day === Number(rule.month_day);
  }

  if (!weekdays.includes(weekday)) {
    return false;
  }

  if (rule.recurrence === 'biweekly') {
    const elapsedDays = daysBetween(dateParts(rule.starts_on), parts);
    return Math.floor(Math.max(0, elapsedDays) / 7) % 2 === 0;
  }

  return true;
}

export function nextRuleRunAt(rule: Row, after: Date = new Date()) {
  const timeZone = validTimeZone(rule.time_zone);
  const startsOn = dateText(rule.starts_on) || localToday(timeZone);
  const endsOn = dateText(rule.ends_on);
  const runTime = rule.trigger_type === 'location_based'
    ? timeText(rule.active_from_time)
    : timeText(rule.time_of_day);

  if (!runTime) {
    return null;
  }

  const afterLocal = localParts(after, timeZone);
  let cursor = dateParts(dateKey(afterLocal) < startsOn ? startsOn : dateKey(afterLocal));

  for (let offset = 0; offset < 740; offset += 1) {
    const candidateDate = dateKey(cursor);

    if (endsOn && candidateDate > endsOn) {
      return null;
    }

    if (candidateDate >= startsOn && ruleMatchesDate(rule, cursor)) {
      const candidate = zonedDateTimeToUtc(candidateDate, runTime, timeZone);

      if (candidate.getTime() > after.getTime() + 500) {
        return candidate.toISOString();
      }
    }

    cursor = addDays(cursor, 1);
  }

  return null;
}

export function locationWindowEndAt(rule: Row, runAt: Date) {
  if (rule.trigger_type !== 'location_based') {
    return null;
  }

  const timeZone = validTimeZone(rule.time_zone);
  const runLocal = localParts(runAt, timeZone);
  const startTime = timeText(rule.active_from_time);
  const endTime = timeText(rule.active_until_time);

  if (!startTime || !endTime) {
    return null;
  }

  let endDateParts = { year: runLocal.year, month: runLocal.month, day: runLocal.day };

  if (endTime <= startTime) {
    endDateParts = addDays(endDateParts, 1);
  }

  return zonedDateTimeToUtc(dateKey(endDateParts), endTime, timeZone).toISOString();
}

export function normalizeNotificationRuleInput(input: Row, business: Row, existing: Row = {}) {
  const merged = { ...existing, ...input };
  const triggerType = text(merged.triggerType || merged.trigger_type || 'recurring');
  const timeZone = validTimeZone(merged.timeZone || merged.time_zone);
  const startsOn = dateText(merged.startsOn || merged.starts_on) || localToday(timeZone);
  const endsOn = dateText(merged.endsOn || merged.ends_on) || null;
  const weekdays = normalizeWeekdays(merged.weekdays);
  const targetType = text(merged.targetType || merged.target_type || 'template');
  const recurrenceInput = text(merged.recurrence || (triggerType === 'location_based' ? 'location_window' : 'weekly'));
  const recurrence = triggerType === 'location_based' ? 'location_window' : recurrenceInput;
  const monthDay = Math.round(Number(merged.monthDay || merged.month_day || Number(startsOn.slice(-2))));
  const name = text(merged.name);
  const title = text(merged.title);
  const message = text(merged.message);
  const status = ['active', 'paused'].includes(text(merged.status)) ? text(merged.status) : 'active';

  if (!['recurring', 'location_based'].includes(triggerType)) {
    fail('INVALID_RULE_TRIGGER', 'Auslöser ist ungültig.', 'Erlaubt sind wiederkehrend und standortbasiert.');
  }

  if (!name || name.length > 120 || !title || title.length > 120 || !message || message.length > 500) {
    fail('INVALID_RULE_CONTENT', 'Name oder Nachricht ist ungültig.', 'Name und Titel dürfen maximal 120, die Nachricht maximal 500 Zeichen enthalten.');
  }

  if (!ALLOWED_TARGET_TYPES.has(targetType)) {
    fail('INVALID_RULE_TARGET', 'Zielgruppe ist ungültig.', 'Die gewählte Zielgruppe wird für Wallet-Regeln nicht unterstützt.');
  }

  if (targetType === 'template' && !text(merged.templateId || merged.template_id)) {
    fail('RULE_TEMPLATE_REQUIRED', 'Karte fehlt.', 'Für die Zielgruppe Karte muss ein Template ausgewählt werden.');
  }

  if (endsOn && endsOn < startsOn) {
    fail('INVALID_RULE_DATE_RANGE', 'Enddatum liegt vor dem Startdatum.', 'Das Enddatum muss am oder nach dem Startdatum liegen.');
  }

  if (triggerType === 'recurring' && !ALLOWED_RECURRENCES.has(recurrence)) {
    fail('INVALID_RULE_RECURRENCE', 'Wiederholung ist ungültig.', 'Erlaubt sind täglich, wöchentlich, zweiwöchentlich und monatlich.');
  }

  if (triggerType === 'recurring' && !timeText(merged.timeOfDay || merged.time_of_day)) {
    fail('RULE_TIME_REQUIRED', 'Uhrzeit fehlt.', 'Wiederkehrende Nachrichten brauchen eine Uhrzeit.');
  }

  if (triggerType === 'recurring' && ['weekly', 'biweekly'].includes(recurrence) && !weekdays.length) {
    fail('RULE_WEEKDAYS_REQUIRED', 'Wochentage fehlen.', 'Wähle mindestens einen Wochentag.');
  }

  if (recurrence === 'monthly' && (monthDay < 1 || monthDay > 31)) {
    fail('INVALID_RULE_MONTH_DAY', 'Monatstag ist ungültig.', 'Der Monatstag muss zwischen 1 und 31 liegen.');
  }

  const locationLat = Number(business?.location_lat);
  const locationLng = Number(business?.location_lng);
  const locationRadius = Math.round(Number(merged.locationRadiusM || merged.location_radius_m || 150));

  if (triggerType === 'location_based') {
    if (!weekdays.length || !timeText(merged.activeFromTime || merged.active_from_time) || !timeText(merged.activeUntilTime || merged.active_until_time)) {
      fail('RULE_LOCATION_WINDOW_REQUIRED', 'Standort-Zeitfenster ist unvollständig.', 'Wähle Wochentage sowie Beginn und Ende des Standort-Zeitfensters.');
    }

    if (!Number.isFinite(locationLat) || !Number.isFinite(locationLng)) {
      fail('BUSINESS_LOCATION_REQUIRED', 'Firmenstandort fehlt.', 'Hinterlege zuerst gültige Koordinaten in den Firmendaten.');
    }
  }

  const normalized: Row = {
    template_id: text(merged.templateId || merged.template_id) || null,
    name,
    title,
    message,
    target_type: targetType,
    target_filter: targetFilter(merged.targetFilter || merged.target_filter),
    trigger_type: triggerType,
    recurrence,
    weekdays,
    month_day: recurrence === 'monthly' ? monthDay : null,
    time_of_day: triggerType === 'recurring' ? timeText(merged.timeOfDay || merged.time_of_day) : null,
    time_zone: timeZone,
    starts_on: startsOn,
    ends_on: endsOn,
    active_from_time: triggerType === 'location_based' ? timeText(merged.activeFromTime || merged.active_from_time) : null,
    active_until_time: triggerType === 'location_based' ? timeText(merged.activeUntilTime || merged.active_until_time) : null,
    location_lat: triggerType === 'location_based' ? locationLat : null,
    location_lng: triggerType === 'location_based' ? locationLng : null,
    location_radius_m: triggerType === 'location_based' ? locationRadius : null,
    status
  };

  normalized.next_run_at = status === 'active' ? nextRuleRunAt(normalized) : null;
  return normalized;
}
