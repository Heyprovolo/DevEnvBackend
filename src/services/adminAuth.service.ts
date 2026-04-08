import crypto from "crypto";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";

const ADMIN_USERS_COLLECTION = "admin_users";
const ADMIN_SESSIONS_COLLECTION = "admin_sessions";
const SESSION_TTL_HOURS = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 12);
const ADMIN_TOKEN_SECRET =
  process.env.ADMIN_AUTH_TOKEN_SECRET ?? process.env.FIREBASE_SECRET_KEY ?? "dev-admin-secret-change-me";

type AdminUserRecord = {
  email: string;
  emailLower: string;
  passwordHash: string;
  passwordSalt: string;
  isActive?: boolean;
  role?: string;
};

type AdminSessionRecord = {
  tokenHash: string;
  adminUserId: string;
  email: string;
  role: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
};

type StatelessAdminTokenPayload = {
  kind: "admin_local";
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
};

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payloadBase64: string) {
  return crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(payloadBase64).digest("base64url");
}

function isResourceExhaustedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("RESOURCE_EXHAUSTED");
}

function getFallbackAdminCredentials() {
  const envEmail = process.env.ADMIN_FALLBACK_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.ADMIN_FALLBACK_PASSWORD ?? "";

  if (envEmail && envPassword) {
    return { email: envEmail, password: envPassword };
  }

  if (process.env.NODE_ENV !== "production") {
    // Dev-only emergency fallback for local environments when Firestore quota is exhausted.
    return { email: "admin@localhost", password: "admin12345" };
  }

  return null;
}

function createStatelessAdminToken(admin: { adminUserId: string; email: string; role: string }, expiresAt: Date) {
  const payload: StatelessAdminTokenPayload = {
    kind: "admin_local",
    sub: admin.adminUserId,
    email: admin.email,
    role: admin.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const payloadBase64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);
  return `local.${payloadBase64}.${signature}`;
}

function parseStatelessAdminToken(token: string) {
  if (!token.startsWith("local.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payloadBase64 = parts[1];
  const signature = parts[2];
  if (!payloadBase64 || !signature) return null;
  const expected = signPayload(payloadBase64);
  const isSignatureValid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!isSignatureValid) return null;

  const payload = JSON.parse(base64UrlDecode(payloadBase64)) as StatelessAdminTokenPayload;
  if (payload.kind !== "admin_local") return null;
  if (payload.exp * 1000 < Date.now()) return null;

  return {
    adminUserId: payload.sub,
    email: payload.email,
    role: payload.role,
  };
}

function scryptHash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(derivedKey.toString("hex"));
    });
  });
}

export async function verifyAdminCredentials(email: string, password: string) {
  const emailLower = email.trim().toLowerCase();
  try {
    const app = getFirebaseApp();
    const db = getFirestore(app);
    const snapshot = await db
      .collection(ADMIN_USERS_COLLECTION)
      .where("emailLower", "==", emailLower)
      .limit(1)
      .get();

    if (snapshot.empty || !snapshot.docs[0]) return null;
    const doc = snapshot.docs[0];
    const user = doc.data() as AdminUserRecord;
    if (user.isActive === false) return null;
    if (!user.passwordHash || !user.passwordSalt) return null;

    const attemptedHash = await scryptHash(password, user.passwordSalt);
    const attemptedHashBuffer = Buffer.from(attemptedHash, "hex");
    const storedHashBuffer = Buffer.from(user.passwordHash, "hex");

    // timingSafeEqual throws if lengths differ; treat malformed records as invalid credentials.
    if (attemptedHashBuffer.length !== storedHashBuffer.length || storedHashBuffer.length === 0) {
      return null;
    }

    const isValid = crypto.timingSafeEqual(attemptedHashBuffer, storedHashBuffer);
    if (!isValid) return null;

    return {
      adminUserId: doc.id,
      email: user.email,
      role: user.role ?? "admin",
    };
  } catch (error) {
    if (!isResourceExhaustedError(error)) {
      throw error;
    }
    const fallback = getFallbackAdminCredentials();
    if (!fallback) return null;
    if (emailLower !== fallback.email || password !== fallback.password) return null;
    return {
      adminUserId: "local-admin",
      email: fallback.email,
      role: "admin",
    };
  }
}

export async function createAdminSession(admin: { adminUserId: string; email: string; role: string }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  try {
    const app = getFirebaseApp();
    const db = getFirestore(app);
    const record: AdminSessionRecord = {
      tokenHash,
      adminUserId: admin.adminUserId,
      email: admin.email,
      role: admin.role,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
    };

    await db.collection(ADMIN_SESSIONS_COLLECTION).doc(tokenHash).set(record);

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      role: admin.role,
      email: admin.email,
    };
  } catch (error) {
    if (!isResourceExhaustedError(error)) {
      throw error;
    }
    const localToken = createStatelessAdminToken(admin, expiresAt);
    return {
      token: localToken,
      expiresAt: expiresAt.toISOString(),
      role: admin.role,
      email: admin.email,
    };
  }
}

export async function getAdminSession(token: string) {
  const localSession = parseStatelessAdminToken(token);
  if (localSession) return localSession;

  const app = getFirebaseApp();
  const db = getFirestore(app);
  const tokenHash = hashToken(token);
  const doc = await db.collection(ADMIN_SESSIONS_COLLECTION).doc(tokenHash).get();
  if (!doc.exists) return null;
  const data = doc.data() as AdminSessionRecord | undefined;
  if (!data) return null;
  if (data.expiresAt.toDate().getTime() < Date.now()) {
    await db.collection(ADMIN_SESSIONS_COLLECTION).doc(tokenHash).delete().catch(() => undefined);
    return null;
  }
  return {
    adminUserId: data.adminUserId,
    email: data.email,
    role: data.role,
  };
}

