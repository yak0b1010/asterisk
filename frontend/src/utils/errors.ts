import { ApiError } from "../api/client";

export const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
