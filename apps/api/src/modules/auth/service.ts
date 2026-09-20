import { createHash, randomBytes, randomInt } from 'node:crypto';
import argon2 from 'argon2';
import { jwtVerify, SignJWT } from 'jose';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  deviceCodes,
  emailTokens,
  refreshTokens,
  users,
} from '../../db/schema.js';

export interface Mailer {
  sendVerification(email: string, token: string): Promise<void>;
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

type AuthOptions = {
  accessSecret: string;
  accessTokenTtl?: string;
  refreshTokenTtlMs?: number;
  now?: () => Date;
};

type Session = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

const defaultRefreshTokenTtlMs = 30 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createToken(): string {
  return randomBytes(32).toString('base64url');
}

export class AuthService {
  private readonly now: () => Date;
  private readonly accessSecret: Uint8Array;
  private readonly accessTokenTtl: string;
  private readonly refreshTokenTtlMs: number;

  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly mailer: Mailer,
    options: AuthOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.accessSecret = new TextEncoder().encode(options.accessSecret);
    this.accessTokenTtl = options.accessTokenTtl ?? '30m';
    this.refreshTokenTtlMs = options.refreshTokenTtlMs ?? defaultRefreshTokenTtlMs;
  }

  async register(email: string, password: string) {
    const normalizedEmail = normalizeEmail(email);
    if (password.length < 8) {
      throw new AuthError('WEAK_PASSWORD', 'Password must be at least 8 characters.');
    }

    const existing = await this.database.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (existing.length > 0) {
      throw new AuthError('EMAIL_ALREADY_REGISTERED', 'Email is already registered.');
    }

    const [user] = await this.database
      .insert(users)
      .values({ email: normalizedEmail, passwordHash: await argon2.hash(password) })
      .returning({ id: users.id, email: users.email });

    const verificationToken = createToken();
    await this.database.insert(emailTokens).values({
      userId: user.id,
      tokenHash: hashToken(verificationToken),
      purpose: 'verify_email',
      expiresAt: new Date(this.now().getTime() + 24 * 60 * 60 * 1000),
    });
    await this.mailer.sendVerification(user.email, verificationToken);
    return user;
  }

  async verifyEmail(token: string): Promise<void> {
    const [record] = await this.database
      .select({ id: emailTokens.id, userId: emailTokens.userId })
      .from(emailTokens)
      .where(and(
        eq(emailTokens.tokenHash, hashToken(token)),
        eq(emailTokens.purpose, 'verify_email'),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, this.now()),
      ))
      .limit(1);
    if (!record) {
      throw new AuthError('INVALID_EMAIL_TOKEN', 'Email verification token is invalid or expired.');
    }

    await this.database.update(users).set({ emailVerifiedAt: this.now(), updatedAt: this.now() }).where(eq(users.id, record.userId));
    await this.database.update(emailTokens).set({ usedAt: this.now() }).where(eq(emailTokens.id, record.id));
  }

  async login(email: string, password: string): Promise<Session> {
    const [user] = await this.database.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (!user.emailVerifiedAt) {
      throw new AuthError('EMAIL_NOT_VERIFIED', 'Verify your email before signing in.');
    }
    return this.issueSession(user.id);
  }

  async refresh(refreshToken: string): Promise<Session> {
    const [record] = await this.database
      .select({ id: refreshTokens.id, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(and(
        eq(refreshTokens.tokenHash, hashToken(refreshToken)),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, this.now()),
      ))
      .limit(1);
    if (!record) {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
    }

    await this.database.update(refreshTokens).set({ revokedAt: this.now(), updatedAt: this.now() }).where(eq(refreshTokens.id, record.id));
    return this.issueSession(record.userId);
  }

  async startDeviceAuthorization() {
    const deviceCode = createToken();
    const userCode = `${randomInt(100000, 999999)}`;
    await this.database.insert(deviceCodes).values({
      deviceCodeHash: hashToken(deviceCode),
      userCode,
      expiresAt: new Date(this.now().getTime() + 10 * 60 * 1000),
    });
    return { deviceCode, userCode, expiresInSeconds: 600 };
  }

  async approveDevice(userCode: string, userId: string): Promise<void> {
    const result = await this.database
      .update(deviceCodes)
      .set({ userId, approvedAt: this.now() })
      .where(and(eq(deviceCodes.userCode, userCode), isNull(deviceCodes.approvedAt), gt(deviceCodes.expiresAt, this.now())))
      .returning({ id: deviceCodes.id });
    if (result.length === 0) {
      throw new AuthError('INVALID_DEVICE_CODE', 'Device code is invalid or expired.');
    }
  }

  async exchangeDevice(deviceCode: string): Promise<Session> {
    const [record] = await this.database
      .select({ id: deviceCodes.id, userId: deviceCodes.userId })
      .from(deviceCodes)
      .where(and(
        eq(deviceCodes.deviceCodeHash, hashToken(deviceCode)),
        isNull(deviceCodes.consumedAt),
        gt(deviceCodes.expiresAt, this.now()),
      ))
      .limit(1);
    if (!record?.userId) {
      throw new AuthError('DEVICE_AUTHORIZATION_PENDING', 'Device authorization is still pending.');
    }
    await this.database.update(deviceCodes).set({ consumedAt: this.now() }).where(eq(deviceCodes.id, record.id));
    return this.issueSession(record.userId);
  }

  async verifyAccessToken(token: string): Promise<string> {
    try {
      const verified = await jwtVerify(token, this.accessSecret);
      if (typeof verified.payload.sub !== 'string') {
        throw new Error('Missing subject');
      }
      return verified.payload.sub;
    } catch {
      throw new AuthError('INVALID_ACCESS_TOKEN', 'Access token is invalid or expired.');
    }
  }

  async getUser(userId: string) {
    const [user] = await this.database
      .select({ id: users.id, email: users.email, displayName: users.displayName, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'User does not exist.');
    }
    return user;
  }

  private async issueSession(userId: string): Promise<Session> {
    const refreshToken = createToken();
    const refreshExpiresAt = new Date(this.now().getTime() + this.refreshTokenTtlMs);
    await this.database.insert(refreshTokens).values({
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt,
    });

    const accessToken = await new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(this.accessTokenTtl)
      .sign(this.accessSecret);

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: 30 * 60,
    };
  }
}
