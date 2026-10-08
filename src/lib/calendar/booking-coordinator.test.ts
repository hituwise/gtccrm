import { describe, it, expect, vi } from 'vitest';
import {
  extractEmailFromText,
  detectBookingIntent,
  formatConfirmationMessage,
} from './booking-coordinator';
import { parseBookingSlot, formatBookingDateTime } from './date-parser';

describe('booking-coordinator', () => {
  describe('extractEmailFromText', () => {
    it('extracts standard email address', () => {
      expect(extractEmailFromText('My email is test@example.com, please book')).toBe('test@example.com');
      expect(extractEmailFromText('sure: client.name+tag@company.co.uk')).toBe('client.name+tag@company.co.uk');
      expect(extractEmailFromText('hello@domain.org')).toBe('hello@domain.org');
    });

    it('returns null when no valid email exists', () => {
      expect(extractEmailFromText('Hello there! No email here.')).toBeNull();
      expect(extractEmailFromText('test@example without tld')).toBeNull();
      expect(extractEmailFromText('')).toBeNull();
    });
  });

  describe('detectBookingIntent', () => {
    it('detects explicit booking keywords', () => {
      expect(detectBookingIntent('I want to book a demo')).toBe(true);
      expect(detectBookingIntent('Can we schedule a call?')).toBe(true);
      expect(detectBookingIntent('Ready for consultation')).toBe(true);
      expect(detectBookingIntent('Book demo slot please')).toBe(true);
    });

    it('detects email response to assistant prompt for email', () => {
      const assistantContext = ['Great! What is your email address so I can send the calendar invite?'];
      expect(detectBookingIntent('john@example.com', assistantContext)).toBe(true);
      expect(detectBookingIntent('Sure, my email is alex@gmail.com', assistantContext)).toBe(true);
    });

    it('returns false for unrelated messages', () => {
      expect(detectBookingIntent('What is your pricing?')).toBe(false);
      expect(detectBookingIntent('Thank you very much!')).toBe(false);
    });
  });

  describe('formatConfirmationMessage', () => {
    it('interpolates tokens properly', () => {
      const template = 'Demo booked for {{name}} at {{date_time}}.\nMeet: {{meet_link}}\nInvite: {{email}}';
      const rendered = formatConfirmationMessage(template, {
        name: 'Sarah',
        email: 'sarah@example.com',
        dateTime: 'Friday, Oct 9 at 3:00 PM',
        meetLink: 'https://meet.google.com/abc-defg-hij',
        title: 'Demo Call',
      });

      expect(rendered).toContain('Demo booked for Sarah');
      expect(rendered).toContain('Friday, Oct 9 at 3:00 PM');
      expect(rendered).toContain('https://meet.google.com/abc-defg-hij');
      expect(rendered).toContain('sarah@example.com');
    });
  });

  describe('parseBookingSlot', () => {
    it('parses explicit times like tomorrow at 3pm', () => {
      const refDate = new Date('2026-10-08T10:00:00Z');
      const slot = parseBookingSlot('tomorrow at 3pm', 30, refDate);
      expect(slot.isExplicitTime).toBe(true);
      const parsedStart = new Date(slot.startTime);
      expect(parsedStart.getHours()).toBe(15);
    });

    it('parses military times like today at 16:30', () => {
      const refDate = new Date('2026-10-08T10:00:00Z');
      const slot = parseBookingSlot('today at 16:30', 30, refDate);
      expect(slot.isExplicitTime).toBe(true);
      const parsedStart = new Date(slot.startTime);
      expect(parsedStart.getHours()).toBe(16);
      expect(parsedStart.getMinutes()).toBe(30);
    });

    it('defaults to next business day at 11am if time is not specified', () => {
      const refDate = new Date('2026-10-08T10:00:00Z');
      const slot = parseBookingSlot('just my email is client@example.com', 30, refDate);
      expect(slot.isExplicitTime).toBe(false);
      const parsedStart = new Date(slot.startTime);
      expect(parsedStart.getHours()).toBe(11);
    });
  });

  describe('formatBookingDateTime', () => {
    it('formats ISO dates correctly', () => {
      const iso = '2026-10-09T15:00:00Z';
      const formatted = formatBookingDateTime(iso, 'UTC');
      expect(formatted).toContain('2026');
      expect(formatted).toContain('(UTC)');
    });
  });
});
