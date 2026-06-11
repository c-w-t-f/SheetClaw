import type { ToolSpec } from '../types';
import { ToolValidationError } from '../workbook/executor';

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
  requiresText?: boolean;
}

export interface PendingChoice {
  id: string;
  toolCallId: string;
  question: string;
  options: ChoiceOption[];
  allowMultiple: boolean;
}

export const REQUEST_USER_CHOICE: ToolSpec = {
  name: 'request_user_choice',
  description: "Show the user a menu and wait for their selection. Use when the request is ambiguous, when fetching everything would be large, or whenever you would otherwise ask the user to choose Option A/B/C in prose. Derive options from information you actually found; put the short option title in label and the tradeoff/details in description. Always include an 'Other' option so the user can specify custom requirements.",
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Question to show, non-empty and at most 200 characters' },
      options: {
        type: 'array',
        description: '2-8 options, each {id,label,description?} or a bare string whose id is slugified from label',
        items: { description: 'Choice option' },
      },
      allow_multiple: { type: 'boolean', description: 'Allow selecting more than one option; default false' },
    },
    required: ['question', 'options'],
    additionalProperties: false,
  },
  mutating: false,
  runtime: 'none',
};

export function parsePendingChoice(toolCallId: string, args: Record<string, unknown>): PendingChoice {
  const question = parseQuestion(args.question);
  const options = parseOptions(args.options);
  const allowMultiple = args.allow_multiple === undefined ? false : parseBoolean(args.allow_multiple, 'allow_multiple');

  return {
    id: `choice_${toolCallId}`,
    toolCallId,
    question,
    options,
    allowMultiple,
  };
}

function parseQuestion(value: unknown): string {
  if (typeof value !== 'string') throw new ToolValidationError('"question" must be a string.');
  const question = value.trim();
  if (!question) throw new ToolValidationError('"question" must be non-empty.');
  if (question.length > 200) throw new ToolValidationError('"question" must be at most 200 characters.');
  return question;
}

function parseOptions(value: unknown): ChoiceOption[] {
  if (!Array.isArray(value)) throw new ToolValidationError('"options" must be an array.');
  if (value.length < 2) throw new ToolValidationError('"options" must contain at least 2 options.');
  if (value.length > 8) throw new ToolValidationError('"options" must contain at most 8 options.');

  const options = value.map((item, index) => parseOption(item, index));
  const valid = options.filter((option): option is ChoiceOption => !!option);
  if (valid.length < 2) throw new ToolValidationError('"options" must contain at least 2 valid options.');
  return ensureOtherOption(valid);
}

function parseOption(value: unknown, index: number): ChoiceOption | null {
  if (typeof value === 'string') {
    const label = value.trim();
    if (!label) return null;
    return { id: slugify(label) || `option-${index + 1}`, label };
  }
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.label !== 'string') return null;
  const id = raw.id.trim();
  const label = raw.label.trim();
  if (!id || !label) return null;
  return {
    id,
    label,
    ...(typeof raw.description === 'string' && raw.description.trim()
      ? { description: raw.description.trim() }
      : {}),
    ...(raw.requiresText === true ? { requiresText: true } : {}),
  };
}

function ensureOtherOption(options: ChoiceOption[]): ChoiceOption[] {
  const otherIndex = options.findIndex(option => isOtherOption(option));
  if (otherIndex >= 0) {
    return options.map((option, index) => index === otherIndex ? { ...option, requiresText: true } : option);
  }
  return [
    ...options,
    {
      id: 'other',
      label: 'Other',
      description: "I'll use your custom requirement or scope.",
      requiresText: true,
    },
  ];
}

function isOtherOption(option: ChoiceOption): boolean {
  const id = option.id.trim().toLowerCase();
  const label = option.label.trim().toLowerCase();
  return id === 'other' || id === 'others' || label === 'other' || label === 'others';
}

function parseBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new ToolValidationError(`"${name}" must be a boolean.`);
  return value;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
