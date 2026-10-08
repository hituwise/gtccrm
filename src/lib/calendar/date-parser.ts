import {
  addDays,
  addMinutes,
  format,
  setHours,
  setMinutes,
  setSeconds,
  setDate,
  setMonth,
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

/**
 * Extracts natural language date/time expressions or defaults to next business day.
 */
export function parseBookingSlot(
  text: string,
  durationMinutes: number = 30,
  referenceDate: Date = new Date(),
): ParsedSlot {
  const lower = text.toLowerCase().trim();
  const childAge = extractChildAge(text);

  // 1. Check for ISO string first
  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  if (isoMatch) {
    const d = new Date(isoMatch[0]);
    if (!isNaN(d.getTime())) {
      const end = addMinutes(d, durationMinutes);
      return {
        startTime: d.toISOString(),
        endTime: end.toISOString(),
        isExplicitDay: true,
        isExplicitTime: true,
        humanText: format(d, 'EEEE, MMM d, yyyy @ h:mm a'),
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
    // 24-hour match e.g. "14:00", "at 15:30"
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
      // Matches "at 10", "at 5"
      const atMatch = lower.match(/\bat\s+(\d{1,2})\b/);
      if (atMatch) {
        let hour = parseInt(atMatch[1], 10);
        // If hour is 1-6 and evening/afternoon or assumed PM
        if (hour >= 1 && hour <= 6) {
          hour += 12; // e.g. "at 5" -> 5 PM
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

  // 3. Determine target day
  let targetDay = new Date(referenceDate);
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
      targetDay = setMonth(targetDay, MONTHS[monthStr]);
      targetDay = setDate(targetDay, dayNum);
      // If date already passed in current year, advance to next year
      if (targetDay.getTime() < referenceDate.getTime() - 86400000) {
        targetDay.setFullYear(targetDay.getFullYear() + 1);
      }
      isExplicitDay = true;
    }
  }

  if (!isExplicitDay) {
    if (lower.includes('today')) {
      targetDay = referenceDate;
      isExplicitDay = true;
    } else if (lower.includes('tomorrow')) {
      targetDay = addDays(referenceDate, 1);
      isExplicitDay = true;
    } else if (lower.includes('in 2 days') || lower.includes('day after tomorrow')) {
      targetDay = addDays(referenceDate, 2);
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
      for (let i = 0; i < daysOfWeek.length; i++) {
        const dayName = daysOfWeek[i];
        if (lower.includes(dayName)) {
          isExplicitDay = true;
          const currentDayIndex = referenceDate.getDay();
          let diff = i - currentDayIndex;
          if (lower.includes(`next ${dayName}`)) {
            diff += 7;
          } else if (diff <= 0) {
            diff += 7; // Next occurrence
          }
          targetDay = addDays(referenceDate, diff);
          break;
        }
      }
    }
  }

  // If day was not explicitly specified, pick next business day
  if (!isExplicitDay) {
    targetDay = addDays(referenceDate, 1);
    while (isWeekend(targetDay)) {
      targetDay = addDays(targetDay, 1);
    }
  }

  // If time was not explicitly specified, pick default demo slot: 11:00 AM
  const hourToSet = targetHour !== null ? targetHour : 11;
  const minuteToSet = targetHour !== null ? targetMinute : 0;

  let eventStart = setSeconds(
    setMinutes(setHours(targetDay, hourToSet), minuteToSet),
    0,
  );

  // If calculated time is in the past and day wasn't explicit, push by 1 day
  if (!isExplicitDay && eventStart.getTime() <= referenceDate.getTime()) {
    eventStart = addDays(eventStart, 1);
    while (isWeekend(eventStart)) {
      eventStart = addDays(eventStart, 1);
    }
  }

  const eventEnd = addMinutes(eventStart, durationMinutes);

  return {
    startTime: eventStart.toISOString(),
    endTime: eventEnd.toISOString(),
    isExplicitDay,
    isExplicitTime,
    humanText: format(eventStart, 'EEEE, MMM d, yyyy @ h:mm a'),
    childAge,
  };
}

/**
 * Formats a booking ISO timestamp into a WhatsApp-friendly readable string.
 * e.g. "Friday, Oct 9, 2026 at 3:00 PM"
 */
export function formatBookingDateTime(
  isoString: string,
  timezone?: string,
): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    const formatted = format(d, "EEEE, MMM d, yyyy 'at' h:mm a");
    if (timezone) {
      return `${formatted} (${timezone})`;
    }
    return formatted;
  } catch {
    return isoString;
  }
}
