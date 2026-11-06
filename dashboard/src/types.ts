export type Role = "admin" | "operator" | "viewer";

export interface AuthUser {
  username: string;
  fullName: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
