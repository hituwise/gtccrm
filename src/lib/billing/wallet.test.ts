import { describe, it, expect } from 'vitest';
import { calculateBroadcastCost, DEFAULT_RATES } from './wallet';

describe('calculateBroadcastCost', () => {
  it('calculates marketing costs correctly with default rates', () => {
    const result = calculateBroadcastCost('MARKETING', 100);
    expect(result.category).toBe('Marketing');
    expect(result.categoryLabel).toBe('Marketing');
    expect(result.costPerMessage).toBe(DEFAULT_RATES.marketing_rate);
    expect(result.totalCost).toBe(88.0);
  });

  it('calculates utility costs correctly with default rates', () => {
    const result = calculateBroadcastCost('UTILITY', 200);
    expect(result.category).toBe('Utility');
    expect(result.categoryLabel).toBe('Utility');
    expect(result.costPerMessage).toBe(DEFAULT_RATES.utility_rate);
    expect(result.totalCost).toBe(30.0);
  });

  it('calculates authentication costs correctly with default rates', () => {
    const result = calculateBroadcastCost('AUTHENTICATION', 50);
    expect(result.category).toBe('Authentication');
    expect(result.categoryLabel).toBe('Authentication');
    expect(result.costPerMessage).toBe(DEFAULT_RATES.auth_rate);
    expect(result.totalCost).toBe(7.5);
  });

  it('handles custom rates appropriately', () => {
    const customRates = {
      marketing_rate: 1.25,
      utility_rate: 0.2,
      auth_rate: 0.1,
      service_rate: 0.4,
    };
    const result = calculateBroadcastCost('marketing', 10, customRates);
    expect(result.costPerMessage).toBe(1.25);
    expect(result.totalCost).toBe(12.5);
  });

  it('handles 0 or negative recipient counts gracefully', () => {
    const resultZero = calculateBroadcastCost('MARKETING', 0);
    expect(resultZero.totalCost).toBe(0);

    const resultNegative = calculateBroadcastCost('MARKETING', -10);
    expect(resultNegative.totalCost).toBe(0);
  });

  it('defaults undefined or missing category to marketing', () => {
    const result = calculateBroadcastCost(undefined, 10);
    expect(result.category).toBe('Marketing');
    expect(result.totalCost).toBe(8.8);
  });
});
