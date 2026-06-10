import type { ToolSpec } from '../types';
import { ToolValidationError } from '../workbook/executor';

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
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
  description: "Show the user a menu and wait for their selection. Use when the request is ambiguous or when fetching everything would be large - e.g. multiple matching datasets, several granularities, or unclear target range. Derive options from information you actually found; include an 'other' escape option.",
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
  return valid;
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
  };
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
