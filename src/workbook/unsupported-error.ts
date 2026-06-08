export class ToolUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolUnsupportedError';
  }
}
