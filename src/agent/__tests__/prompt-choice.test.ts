import { describe, expect, it } from 'vitest';
import { REQUEST_USER_CHOICE } from '../choice';
import { buildSystemPrompt } from '../system-prompt';

describe('choice prompt guidance', () => {
  it('requires prose option menus to use request_user_choice', () => {
    const prompt = buildSystemPrompt('wb1');

    expect(prompt).toContain('Never ask option menus in prose');
    expect(prompt).toContain('Option A/B/C');
    expect(prompt).toContain('request_user_choice');
    expect(REQUEST_USER_CHOICE.description).toContain('Option A/B/C');
    expect(REQUEST_USER_CHOICE.description).toContain('label');
    expect(REQUEST_USER_CHOICE.description).toContain('description');
  });
});
