export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments?: string;
  workbookId: string;
  mutating: boolean;
}

export interface ToolResult {
  toolCallId: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code:
      | 'ValidationError'
      | 'WorkbookNotFound'
      | 'RangeError'
      | 'OfficeApiError'
      | 'PermissionDenied'
      | 'Unsupported';
    message: string;
    details?: unknown;
  };
  snapshotId?: string;
  durationMs?: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JSONSchemaObject;
  mutating: boolean;
}

export interface JSONSchemaObject {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export type JSONSchemaProperty =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'number'; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; items: JSONSchemaProperty; description?: string }
  | JSONSchemaObject
  | { description?: string; [key: string]: unknown };
