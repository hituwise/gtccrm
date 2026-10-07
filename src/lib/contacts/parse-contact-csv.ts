/**
 * CSV parsing for the contacts import modal and broadcast wizard.
 * Shared + unit-tested so phone/name/email/company/tag handling stays aligned.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /**
   * True when the CSV header includes the required `phone` column.
   * `rows` is empty both when the column is missing and when the file
   * simply has no usable data rows; callers that need to tell those
   * apart (to pick the right error message) read this flag.
   */
  hasPhoneColumn: boolean;
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
}

const PHONE_ALIASES = new Set([
  'phone',
  'phonenumber',
  'phone_number',
  'mobile',
  'mobilenumber',
  'mobile_number',
  'contact',
  'contactnumber',
  'contact_number',
  'telephone',
  'whatsapp',
]);

const NAME_ALIASES = new Set([
  'name',
  'fullname',
  'full_name',
  'contactname',
  'contact_name',
  'firstname',
  'first_name',
]);

const EMAIL_ALIASES = new Set([
  'email',
  'e_mail',
  'emailaddress',
  'email_address',
]);

const COMPANY_ALIASES = new Set([
  'company',
  'companyname',
  'company_name',
  'organization',
  'organisation',
  'business',
]);

const TAGS_ALIASES = new Set(['tags', 'tag', 'labels', 'label']);

function normalizeHeaderKey(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Auto-detect delimiter from the header row. Supports `,`, `;`, and `\t`.
 * Tries candidates that yield a recognizable `phone` column first,
 * then falls back to most frequent character.
 */
export function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t'];

  // 1. Try finding delimiter that exposes a recognizable phone header
  for (const delim of candidates) {
    const cols = parseCsvLine(headerLine, delim);
    const hasPhone = cols.some((col) =>
      PHONE_ALIASES.has(normalizeHeaderKey(col))
    );
    if (hasPhone) {
      return delim;
    }
  }

  // 2. Fallback to frequency count in header line
  let maxCount = -1;
  let bestDelim = ',';
  for (const delim of candidates) {
    const escaped = delim === '\t' ? '\t' : `\\${delim}`;
    const count = (headerLine.match(new RegExp(escaped, 'g')) || []).length;
    if (count > maxCount) {
      maxCount = count;
      bestDelim = delim;
    }
  }

  return bestDelim;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  // Strip BOM if present and normalize all line breaks (\r\n, \n, \r)
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r\n|\r|\n/);

  // Find the first non-empty line as header row
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1 || headerIndex >= lines.length - 1) {
    return {
      rows: [],
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
    };
  }

  const headerLine = lines[headerIndex];
  const delimiter = detectDelimiter(headerLine);
  const rawHeaders = parseCsvLine(headerLine, delimiter);
  const headers = rawHeaders.map(normalizeHeaderKey);

  const phoneIdx = headers.findIndex((h) => PHONE_ALIASES.has(h));
  if (phoneIdx === -1) {
    return {
      rows: [],
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
    };
  }

  const nameIdx = headers.findIndex((h) => NAME_ALIASES.has(h));
  const emailIdx = headers.findIndex((h) => EMAIL_ALIASES.has(h));
  const companyIdx = headers.findIndex((h) => COMPANY_ALIASES.has(h));
  const tagsIdx = headers.findIndex((h) => TAGS_ALIASES.has(h));

  const rows: ParsedContactRow[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line, delimiter);
    // A row with no usable phone is pushed through rather than dropped
    // here — dedupeByPhone (shared with the webhook/manual-form paths)
    // already treats an empty normalized key as invalid, and counting
    // it there means the import result can tell the user "N contacts
    // had no phone" instead of the row just vanishing with the total
    // row count silently short of what's actually in the file.
    const phone = values[phoneIdx]?.replace(/["']/g, '').trim() ?? '';

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
    });
  }

  return {
    rows,
    hasPhoneColumn: true,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}

/** CSV line parser handling quotes, escaped quotes (""), and custom delimiters. */
export function parseCsvLine(line: string, delimiter: string = ','): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
