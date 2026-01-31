// Stub auth module for demo
export interface JWTPayload {
  userId: string;
  role: string;
  exp: number;
}

export interface User {
  id: string;
  role: "admin" | "support" | "user";
  email: string;
}

export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  // Stub implementation
  return {
    userId: "user-123",
    role: "admin",
    exp: Date.now() + 3600000,
  };
}

export async function getUserFromToken(payload: JWTPayload): Promise<User> {
  return {
    id: payload.userId,
    role: payload.role as User["role"],
    email: "admin@example.com",
  };
}
