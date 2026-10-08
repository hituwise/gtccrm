import {
  addDays,
  isWeekend,
} from 'date-fns';

export interface ParsedSlot {
  startTime: string; // ISO string
  endTime: string;   // ISO string
  isExplicitDay: boolean;
  isExplicitTime: boolean;
  humanText: string;
  childAge?: number | null;
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * Extracts child age if mentioned in text (e.g. "my child is 9", "9 year old", "age 8").
 */
export function extractChildAge(text: string): number | null {
  const lower = text.toLowerCase();
  const m1 = lower.match(/(?:child|kid|daughter|son)\s*(?:is\s*|aged?\s*)(\d{1,2})/);
  if (m1) return parseInt(m1[1], 10);

  const m2 = lower.match(/(\d{1,2})\s*(?:years?|yrs?)(?:[\s-]*old)?/);
  if (m2) return parseInt(m2[1], 10);

  const m3 = lower.match(/age\s*(\d{1,2})/);
  if (m3) return parseInt(m3[1], 10);

  return null;
}

/**
 * Checks whether text mentions a specific date or day expression.
 */
export function hasDateSpecified(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    lower.includes('today') ||
    lower.includes('tomorrow') ||
    lower.includes('day after tomorrow') ||
    lower.includes('in 2 days')
  ) {
    return true;
  }

  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (daysOfWeek.some((d) => lower.includes(d))) return true;

  // Month check e.g. "12 october", "oct 12"
  for (const month of Object.keys(MONTHS)) {
    if (lower.includes(month)) return true;
  }

  // ISO or date regex check: 2026-10-12 or 12/10
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(lower) || /\b\d{1,2}\/\d{1,2}\b/.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Checks whether text mentions a specific time expression.
 */
export function hasTimeSpecified(text: string): boolean {
  const lower = text.toLowerCase();
  // e.g. 5pm, 10 am, 14:00, at 10, at 5, evening, morning, afternoon, noon
  if (/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(lower)) return true;
  if (/\b(?:at|around)\s+\d{1,2}(?::\d{2})?\b/i.test(lower)) return true;
  if (/\b\d{1,2}:\d{2}\b/.test(lower)) return true;
  if (lower.includes('evening') || lower.includes('morning') || lower.includes('afternoon') || lower.includes('noon')) {
    return true;
  }
  return false;
}

export function getTimezoneOffsetString(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!tzPart || tzPart === 'GMT') return '+00:00';
    const match = tzPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!match) return '+00:00';
    const sign = match[1];
    const hours = match[2].padStart(2, '0');
    const minutes = (match[3] || '00').padStart(2, '0');
    return `${sign}${hours}:${minutes}`;
  } catch {
    return '+05:30';
  }
}

export function getZonedDateParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '0';
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    weekday: get('weekday'),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

/**
 * Extracts natural language date/time expressions in target timezone (default Asia/Kolkata / IST).
 */
export function parseBookingSlot(
  text: string,
  durationMinutes: number = 45,
  referenceDate: Date = new Date(),
  timezone: string = 'Asia/Kolkata',
): ParsedSlot {
  const tz = timezone || 'Asia/Kolkata';
  const lower = text.toLowerCase().trim();
  const childAge = extractChildAge(text);

  // 1. Check for ISO string first
  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?/);
  if (isoMatch) {
    const d = new Date(isoMatch[0]);
    if (!isNaN(d.getTime())) {
      const end = new Date(d.getTime() + durationMinutes * 60000);
      return {
        startTime: d.toISOString(),
        endTime: end.toISOString(),
        isExplicitDay: true,
        isExplicitTime: true,
        humanText: formatBookingDateTime(d.toISOString(), tz),
        childAge,
      };
    }
  }

  // 2. Extract hour & minutes from text
  let targetHour: number | null = null;
  let targetMinute: number = 0;
  let isExplicitTime = false;

  const timeMatch = lower.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3].toLowerCase();

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    targetHour = hour;
    targetMinute = minute;
    isExplicitTime = true;
  } else {
    // 24-hour match e.g. "14:00", "at 15:30", "17:00"
    const milMatch = lower.match(/(?:at\s+)?(\d{1,2}):(\d{2})/);
    if (milMatch) {
      const hour = parseInt(milMatch[1], 10);
      const minute = parseInt(milMatch[2], 10);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        targetHour = hour;
        targetMinute = minute;
        isExplicitTime = true;
      }
    } else {
      // Matches "at 10", "at 5", "5 o'clock"
      const atMatch = lower.match(/\b(?:at\s+(\d{1,2})|(\d{1,2})\s*o'?clock)\b/);
      if (atMatch) {
        let hour = parseInt(atMatch[1] || atMatch[2], 10);
        if (hour >= 1 && hour <= 7) {
          hour += 12; // e.g. "at 5" -> 17:00 (5 PM)
        }
        targetHour = hour;
        targetMinute = 0;
        isExplicitTime = true;
      } else if (lower.includes('evening')) {
        targetHour = 18; // 6 PM
        targetMinute = 0;
        isExplicitTime = true;
      } else if (lower.includes('morning')) {
        targetHour = 10; // 10 AM
        targetMinute = 0;
        isExplicitTime = true;
      } else if (lower.includes('afternoon')) {
        targetHour = 15; // 3 PM
        targetMinute = 0;
        isExplicitTime = true;
      } else if (lower.includes('noon')) {
        targetHour = 12;
        targetMinute = 0;
        isExplicitTime = true;
      }
    }
  }

  // 3. Determine target day in the target timezone
  const refParts = getZonedDateParts(referenceDate, tz);
  let targetYear = refParts.year;
  let targetMonth = refParts.month; // 1-12
  let targetDay = refParts.day;
  let isExplicitDay = false;

  // Check explicit date like "12 October" or "October 12"
  const dateMonthMatch =
    lower.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/i) ||
    lower.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);

  if (dateMonthMatch) {
    const p1 = dateMonthMatch[1].toLowerCase();
    const p2 = dateMonthMatch[2].toLowerCase();
    const dayNum = parseInt(p1, 10) || parseInt(p2, 10);
    const monthStr = isNaN(parseInt(p1, 10)) ? p1 : p2;

    if (MONTHS[monthStr] !== undefined && dayNum >= 1 && dayNum <= 31) {
      targetMonth = MONTHS[monthStr] + 1;
      targetDay = dayNum;
      isExplicitDay = true;
      const tempDate = new Date(targetYear, targetMonth - 1, targetDay);
      const refDayDate = new Date(refParts.year, refParts.month - 1, refParts.day);
      if (tempDate.getTime() < refDayDate.getTime()) {
        targetYear += 1;
      }
    }
  }

  if (!isExplicitDay) {
    if (lower.includes('today')) {
      targetYear = refParts.year;
      targetMonth = refParts.month;
      targetDay = refParts.day;
      isExplicitDay = true;
    } else if (lower.includes('tomorrow')) {
      const d = addDays(new Date(refParts.year, refParts.month - 1, refParts.day), 1);
      targetYear = d.getFullYear();
      targetMonth = d.getMonth() + 1;
      targetDay = d.getDate();
      isExplicitDay = true;
    } else if (lower.includes('in 2 days') || lower.includes('day after tomorrow')) {
      const d = addDays(new Date(refParts.year, refParts.month - 1, refParts.day), 2);
      targetYear = d.getFullYear();
      targetMonth = d.getMonth() + 1;
      targetDay = d.getDate();
      isExplicitDay = true;
    } else {
      const daysOfWeek = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ];
      const curWeekdayIdx = new Date(refParts.year, refParts.month - 1, refParts.day).getDay();

      for (let i = 0; i < daysOfWeek.length; i++) {
        const dayName = daysOfWeek[i];
        if (lower.includes(dayName)) {
          isExplicitDay = true;
          let diff = i - curWeekdayIdx;
          if (lower.includes(`next ${dayName}`)) {
            diff += 7;
          } else if (diff <= 0) {
            diff += 7; // Next occurrence
          }
          const d = addDays(new Date(refParts.year, refParts.month - 1, refParts.day), diff);
          targetYear = d.getFullYear();
          targetMonth = d.getMonth() + 1;
          targetDay = d.getDate();
          break;
        }
      }
    }
  }

  // If day was not explicitly specified, pick next business day
  if (!isExplicitDay) {
    let d = addDays(new Date(refParts.year, refParts.month - 1, refParts.day), 1);
    while (isWeekend(d)) {
      d = addDays(d, 1);
    }
    targetYear = d.getFullYear();
    targetMonth = d.getMonth() + 1;
    targetDay = d.getDate();
  }

  // If time was not explicitly specified, pick default demo slot: 11:00 AM
  const hourToSet = targetHour !== null ? targetHour : 11;
  const minuteToSet = targetHour !== null ? targetMinute : 0;

  // Construct ISO string with explicit timezone offset
  const yStr = String(targetYear).padStart(4, '0');
  const mStr = String(targetMonth).padStart(2, '0');
  const dStr = String(targetDay).padStart(2, '0');
  const hStr = String(hourToSet).padStart(2, '0');
  const minStr = String(minuteToSet).padStart(2, '0');
  const offset = getTimezoneOffsetString(referenceDate, tz);

  const startIso = `${yStr}-${mStr}-${dStr}T${hStr}:${minStr}:00${offset}`;
  let eventStart = new Date(startIso);

  // If calculated time is in the past and day wasn't explicit, advance by 1 business day
  if (!isExplicitDay && eventStart.getTime() <= referenceDate.getTime()) {
    let advDate = addDays(new Date(targetYear, targetMonth - 1, targetDay), 1);
    while (isWeekend(advDate)) {
      advDate = addDays(advDate, 1);
    }
    const newY = String(advDate.getFullYear()).padStart(4, '0');
    const newM = String(advDate.getMonth() + 1).padStart(2, '0');
    const newD = String(advDate.getDate()).padStart(2, '0');
    eventStart = new Date(`${newY}-${newM}-${newD}T${hStr}:${minStr}:00${offset}`);
  }

  const eventEnd = new Date(eventStart.getTime() + durationMinutes * 60000);

  return {
    startTime: eventStart.toISOString(),
    endTime: eventEnd.toISOString(),
    isExplicitDay,
    isExplicitTime,
    humanText: formatBookingDateTime(eventStart.toISOString(), tz),
    childAge,
  };
}

/**
 * Formats a booking ISO timestamp into a WhatsApp-friendly readable string in target timezone.
 * e.g. "Friday, Oct 9, 2026 at 5:00 PM IST"
 */
export function formatBookingDateTime(
  isoString: string,
  timezone: string = 'Asia/Kolkata',
): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    const tz = timezone || 'Asia/Kolkata';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(d);

    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const weekday = get('weekday');
    const month = get('month');
    const day = get('day');
    const year = get('year');
    const hour = get('hour');
    const minute = get('minute');
    const dayPeriod = get('dayPeriod');

    const tzLabel = tz === 'Asia/Kolkata' ? 'IST' : `(${tz})`;
    return `${weekday}, ${month} ${day}, ${year} at ${hour}:${minute} ${dayPeriod} ${tzLabel}`;
  } catch {
    return isoString;
  }
}
