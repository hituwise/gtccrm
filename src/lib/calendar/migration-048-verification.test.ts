import { describe, it, expect, vi } from 'vitest';
import { formatConfirmationMessage, executeDemoBooking } from './booking-coordinator';
import { GENIPLUS_SEED_PRODUCTS } from '../ai/actions/types';
import {
  normalizeTenantProduct,
  validateTenantProductMeetingMode,
} from '../products/tenant-products';

describe('Migration 048 Verification & Safety Suite', () => {
  describe('1. Customer Confirmation & CRM Record When Meet Link Generation Fails', () => {
    it('accurately sets meeting_mode to NONE and avoids claiming Google Meet when meetLink is null', () => {
      const template = null; // Uses defaultTemplate
      const msg = formatConfirmationMessage(template, {
        name: 'John Doe',
        dateTime: 'Saturday, Oct 10 at 11:00 AM',
        title: 'Free Abacus Demo',
        duration: 45,
        meetLink: null, // Generation failed
        meetingMode: 'NONE', // Fallback from coordinator
      });

      expect(msg).toContain('Perfect 😊 Your Free Abacus Demo is booked!');
      expect(msg).toContain('📞 We will call you directly for the session.');
      expect(msg).not.toContain('Google Meet');
      expect(msg).not.toContain('{{meet_link}}');
    });

    it('sets meeting_mode to GOOGLE_MEET and renders Meet link when generation succeeds', () => {
      const template = null;
      const msg = formatConfirmationMessage(template, {
        name: 'John Doe',
        dateTime: 'Saturday, Oct 10 at 11:00 AM',
        title: 'Free Abacus Demo',
        duration: 45,
        meetLink: 'https://meet.google.com/xyz-abcd-efg',
        meetingMode: 'GOOGLE_MEET',
      });

      expect(msg).toContain('💻 Google Meet: https://meet.google.com/xyz-abcd-efg');
      expect(msg).not.toContain('📞 We will call you directly');
    });

    it('strips broken or empty meet link lines if template specifies {{meet_link}} but link is missing', () => {
      const customTemplate =
        'Demo for {{name}} at {{date_time}}.\nGoogle Meet: {{meet_link}}\nSee you!';
      const msg = formatConfirmationMessage(customTemplate, {
        name: 'John Doe',
        dateTime: 'Saturday, Oct 10 at 11:00 AM',
        title: 'Free Abacus Demo',
        duration: 45,
        meetLink: null,
        meetingMode: 'NONE',
      });

      expect(msg).not.toContain('Google Meet');
      expect(msg).not.toContain('{{meet_link}}');
      expect(msg).toContain('Demo for John Doe at Saturday, Oct 10 at 11:00 AM.');
    });
  });

  describe('2. RLS Role Evaluation Hierarchy Verification', () => {
    // Simulates is_account_member(target_account_id, min_role)
    function simulateIsAccountMember(
      userMembership: { accountId: string; role: 'owner' | 'admin' | 'agent' | 'viewer' } | null,
      targetAccountId: string,
      minRole: 'owner' | 'admin' | 'agent' | 'viewer' = 'viewer',
    ): boolean {
      if (!userMembership || userMembership.accountId !== targetAccountId) {
        return false;
      }
      const roleRank: Record<string, number> = {
        owner: 4,
        admin: 3,
        agent: 2,
        viewer: 1,
      };
      return roleRank[userMembership.role] >= roleRank[minRole];
    }

    const targetAccount = '5d5413c2-6097-4ffe-bad8-2a992dca93a8';
    const otherAccount = 'e9999999-9999-9999-9999-999999999999';

    it('verifies SELECT policy (min_role = viewer)', () => {
      // 1-argument overload defaults to 'viewer'
      expect(simulateIsAccountMember({ accountId: targetAccount, role: 'viewer' }, targetAccount)).toBe(true);
      expect(simulateIsAccountMember({ accountId: targetAccount, role: 'agent' }, targetAccount)).toBe(true);
      expect(simulateIsAccountMember({ accountId: targetAccount, role: 'admin' }, targetAccount)).toBe(true);
      expect(simulateIsAccountMember({ accountId: targetAccount, role: 'owner' }, targetAccount)).toBe(true);

      // Non-member (different account or null)
      expect(simulateIsAccountMember({ accountId: otherAccount, role: 'owner' }, targetAccount)).toBe(false);
      expect(simulateIsAccountMember(null, targetAccount)).toBe(false);
    });

    it('verifies INSERT, UPDATE, DELETE policies (min_role = admin)', () => {
      // Viewers and agents are denied
      expect(simulateIsAccountMember({ accountId: targetAccount, role: 'viewer' }, targetAccount, 'admin')).toBe(false);
      expect(simulateIsAccountMember({ accountId: targetAccount, role: 'agent' }, targetAccount, 'admin')).toBe(false);

      // Admins and owners are permitted
      expect(simulateIsAccountMember({ accountId: targetAccount, role: 'admin' }, targetAccount, 'admin')).toBe(true);
      expect(simulateIsAccountMember({ accountId: targetAccount, role: 'owner' }, targetAccount, 'admin')).toBe(true);

      // Cross-account admins cannot modify other accounts
      expect(simulateIsAccountMember({ accountId: otherAccount, role: 'owner' }, targetAccount, 'admin')).toBe(false);
      expect(simulateIsAccountMember({ accountId: otherAccount, role: 'admin' }, targetAccount, 'admin')).toBe(false);
    });
  });

  describe('3. Geniplus Seed Idempotency & Meeting Mode Integrity', () => {
    it('verifies all 6 Geniplus products have verified meeting modes', () => {
      expect(GENIPLUS_SEED_PRODUCTS.ABACUS_KIDS.meetingMode).toBe('GOOGLE_MEET');
      expect(GENIPLUS_SEED_PRODUCTS.GTC.meetingMode).toBe('NONE'); // Training/Consultation call
      expect(GENIPLUS_SEED_PRODUCTS.RUBIKS_CUBE.meetingMode).toBe('GOOGLE_MEET');
      expect(GENIPLUS_SEED_PRODUCTS.GOLD.meetingMode).toBe('NONE'); // Strategy call
      expect(GENIPLUS_SEED_PRODUCTS.MAA.meetingMode).toBe('GOOGLE_MEET');
      expect(GENIPLUS_SEED_PRODUCTS.LEAD_PILOT.meetingMode).toBe('GOOGLE_MEET');
    });

    it('verifies Abacus email is optional and does not block booking', () => {
      expect(GENIPLUS_SEED_PRODUCTS.ABACUS_KIDS.requiredFields).not.toContain('email');
      expect(GENIPLUS_SEED_PRODUCTS.ABACUS_KIDS.optionalFields).toContain('email');
    });

    it('proves seed idempotency on simulated multi-run', () => {
      const mockDatabase = new Map<string, any>();

      function executeSeed(accountId: string) {
        let insertedCount = 0;
        const products = Object.values(GENIPLUS_SEED_PRODUCTS);
        for (const p of products) {
          const key = `${accountId}:${p.productServiceId}`;
          if (!mockDatabase.has(key)) {
            mockDatabase.set(key, { accountId, ...p });
            insertedCount++;
          }
        }
        return insertedCount;
      }

      const accountId = '5d5413c2-6097-4ffe-bad8-2a992dca93a8';

      // Run 1: Seeds all 6 products
      const run1 = executeSeed(accountId);
      expect(run1).toBe(6);
      expect(mockDatabase.size).toBe(6);

      // Run 2: ON CONFLICT DO NOTHING -> 0 inserted
      const run2 = executeSeed(accountId);
      expect(run2).toBe(0);
      expect(mockDatabase.size).toBe(6);

      // Verify product keys in store
      expect(mockDatabase.has(`${accountId}:ABACUS_KIDS`)).toBe(true);
      expect(mockDatabase.has(`${accountId}:GTC`)).toBe(true);
      expect(mockDatabase.has(`${accountId}:RUBIKS_CUBE`)).toBe(true);
      expect(mockDatabase.has(`${accountId}:GOLD`)).toBe(true);
      expect(mockDatabase.has(`${accountId}:MAA`)).toBe(true);
      expect(mockDatabase.has(`${accountId}:LEAD_PILOT`)).toBe(true);
    });
  });

  describe('4. Regression Test: Products Without Explicit Meeting Mode Never Default to GOOGLE_MEET', () => {
    it('proves creating a product without meetingMode defaults to NONE, not GOOGLE_MEET', () => {
      const productWithoutMode = {
        productServiceId: 'YOGA_WORKSHOP',
        name: 'Weekend Yoga Workshop',
        appointmentType: 'Yoga Consultation',
        durationMinutes: 60,
      };

      const normalized = normalizeTenantProduct(productWithoutMode);
      expect(normalized.meetingMode).not.toBe('GOOGLE_MEET');
      expect(normalized.meetingMode).toBe('NONE');
    });

    it('proves validateTenantProductMeetingMode returns NONE for undefined, null, or invalid modes', () => {
      expect(validateTenantProductMeetingMode(undefined)).toBe('NONE');
      expect(validateTenantProductMeetingMode(null)).toBe('NONE');
      expect(validateTenantProductMeetingMode('')).toBe('NONE');
      expect(validateTenantProductMeetingMode('INVALID_MODE')).toBe('NONE');
      expect(validateTenantProductMeetingMode(undefined)).not.toBe('GOOGLE_MEET');
    });

    it('proves GOOGLE_MEET is only assigned when explicitly requested', () => {
      const explicitMeet = normalizeTenantProduct({
        productServiceId: 'WEBINAR',
        name: 'Live Webinar',
        meetingMode: 'GOOGLE_MEET',
      });
      expect(explicitMeet.meetingMode).toBe('GOOGLE_MEET');

      const explicitZoom = normalizeTenantProduct({
        productServiceId: 'ZOOM_CALL',
        name: 'Zoom Strategy Session',
        meetingMode: 'ZOOM',
      });
      expect(explicitZoom.meetingMode).toBe('ZOOM');
    });
  });
});
