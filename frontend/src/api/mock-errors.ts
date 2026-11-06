export class MockHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
