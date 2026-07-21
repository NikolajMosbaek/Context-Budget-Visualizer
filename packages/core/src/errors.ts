export type CtxvizErrorCode = 'no-session' | 'not-found' | 'unreadable';

export class CtxvizError extends Error {
  constructor(
    public readonly code: CtxvizErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CtxvizError';
  }
}
