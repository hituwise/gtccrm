import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseTagCell } from './parse-contact-csv';

describe('parseTagCell', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(parseTagCell(' VIP , Lead ,  ')).toEqual(['VIP', 'Lead']);
  });

  it('splits semicolon-separated tags', () => {
    expect(parseTagCell('VIP; Lead; Customer')).toEqual([
      'VIP',
      'Lead',
      'Customer',
    ]);
  });

  it('de-dupes case-insensitively', () => {
    expect(parseTagCell('vip, VIP, Lead')).toEqual(['vip', 'Lead']);
  });

  it('returns empty for blank values', () => {
    expect(parseTagCell('')).toEqual([]);
    expect(parseTagCell(undefined)).toEqual([]);
  });
});

describe('parseContactCsv', () => {
  it('parses optional tags column', () => {
    const csv = `phone,name,tags
+15551234567,Alice,"VIP, Lead"
+15559876543,Bob,Customer`;

    expect(parseContactCsv(csv)).toEqual({
      hasPhoneColumn: true,
      hasTagsColumn: true,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: ['VIP', 'Lead'],
        },
        {
          phone: '+15559876543',
          name: 'Bob',
          email: undefined,
          company: undefined,
          tagNames: ['Customer'],
        },
      ],
    });
  });

  it('keeps a row with an empty phone cell instead of dropping it silently', () => {
    const csv = `phone,name
+15551234567,Alice
,Bob`;

    const { rows } = parseContactCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      phone: '',
      name: 'Bob',
      email: undefined,
      company: undefined,
      tagNames: [],
    });
  });

  it('returns empty tagNames when tags column is absent', () => {
    const csv = `phone,name
+15551234567,Alice`;

    expect(parseContactCsv(csv)).toEqual({
      hasPhoneColumn: true,
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: [],
        },
      ],
    });
  });

  it('parses semicolon-delimited CSV (Excel European / localized export)', () => {
    const csv = `phone;name;tags\n+15551234567;Alice;VIP\n+15559876543;Bob;Lead`;
    const res = parseContactCsv(csv);
    expect(res.hasPhoneColumn).toBe(true);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].phone).toBe('+15551234567');
    expect(res.rows[0].name).toBe('Alice');
    expect(res.rows[0].tagNames).toEqual(['VIP']);
  });

  it('parses tab-delimited CSV (TSV / Excel copy paste)', () => {
    const csv = "phone\tname\temail\n+15551234567\tAlice\talice@test.com";
    const res = parseContactCsv(csv);
    expect(res.hasPhoneColumn).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].phone).toBe('+15551234567');
    expect(res.rows[0].name).toBe('Alice');
    expect(res.rows[0].email).toBe('alice@test.com');
  });

  it('strips UTF-8 BOM byte order mark added by Excel', () => {
    const csv = '\uFEFFphone,name\n+15551234567,Alice';
    const res = parseContactCsv(csv);
    expect(res.hasPhoneColumn).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].phone).toBe('+15551234567');
  });

  it('recognizes header aliases like "Phone Number", "Mobile", "Contact"', () => {
    const csv = 'Phone Number,Full Name,Email Address\n+15551234567,Alice,alice@test.com';
    const res = parseContactCsv(csv);
    expect(res.hasPhoneColumn).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].phone).toBe('+15551234567');
    expect(res.rows[0].name).toBe('Alice');
    expect(res.rows[0].email).toBe('alice@test.com');
  });

  it('handles empty header columns and extra trailing data (user spreadsheet format)', () => {
    const csv = `phone,name,,,email,tags,Creation Date,\n918105240033,Sandhya,91,8105240033,,ctwa,,56:09.1\n918754230270,Padma,91,8754230270,,ctwa,,43:25.6`;
    const res = parseContactCsv(csv);
    expect(res.hasPhoneColumn).toBe(true);
    expect(res.hasTagsColumn).toBe(true);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].phone).toBe('918105240033');
    expect(res.rows[0].name).toBe('Sandhya');
    expect(res.rows[0].tagNames).toEqual(['ctwa']);
    expect(res.rows[1].phone).toBe('918754230270');
    expect(res.rows[1].name).toBe('Padma');
  });
});
