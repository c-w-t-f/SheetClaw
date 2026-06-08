import { describe, it, expect } from 'vitest';
import { findPricing, computeCost, DEFAULT_PRICING } from '../index';

describe('findPricing', () => {
  it('returns null for unknown model', () => {
    expect(findPricing('openai', 'gpt-99-unknown-xyz')).toBeNull();
  });

  it('exact match beats glob', () => {
    const entry = findPricing('openai', 'gpt-4o');
    expect(entry?.modelMatch).toBe('gpt-4o');
  });

  it('glob match works for gpt-4o-mini variants', () => {
    const entry = findPricing('openai', 'gpt-4o-mini-2024-07-18');
    expect(entry?.modelMatch).toBe('gpt-4o-mini*');
  });

  it('ollama wildcard matches any model', () => {
    const entry = findPricing('ollama', 'llama3.2:latest');
    expect(entry).not.toBeNull();
    expect(entry?.inputPerMTok).toBe(0);
    expect(entry?.outputPerMTok).toBe(0);
  });

  it('falls back to null for unknown generic model', () => {
    const entry = findPricing('generic', 'some-unknown-model');
    expect(entry).toBeNull();
  });

  it('anthropic claude-sonnet-4 matches', () => {
    const entry = findPricing('anthropic', 'claude-sonnet-4-5');
    expect(entry?.modelMatch).toBe('claude-sonnet-4*');
    expect(entry?.outputPerMTok).toBe(15.00);
  });
});

describe('computeCost', () => {
  it('computes cost for openai gpt-4o', () => {
    const entry = findPricing('openai', 'gpt-4o')!;
    // 1M input + 0.5M output, no cache
    const cost = computeCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, entry);
    // 1M * 2.50/M + 0.5M * 10.00/M = 2.50 + 5.00 = 7.50
    expect(cost).toBeCloseTo(7.50, 4);
  });

  it('applies cache read discount', () => {
    const entry = findPricing('openai', 'gpt-4o')!;
    // 800k regular + 200k cache_read + 100k output
    const cost = computeCost({ inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 200_000 }, entry);
    // regular: 800k * 2.50/M = 2.00
    // cache_read: 200k * 1.25/M = 0.25
    // output: 100k * 10.00/M = 1.00
    expect(cost).toBeCloseTo(3.25, 4);
  });

  it('ollama is always 0', () => {
    const entry = findPricing('ollama', 'llama3.2')!;
    expect(computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, entry)).toBe(0);
  });

  it('uses defaults when entry is null', () => {
    const cost = computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, null, DEFAULT_PRICING.defaults);
    // 1M * 1.00/M + 1M * 3.00/M = 4.00
    expect(cost).toBeCloseTo(4.00, 4);
  });
});
