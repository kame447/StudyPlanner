/** Explicitly authored user guidance, never a provider's free-form message. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}
