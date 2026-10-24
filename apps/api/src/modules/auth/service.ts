import { createHash, randomBytes, randomInt } from 'node:crypto';
import argon2 from 'argon2';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  deviceCodes,
  emailTokens,
  registrationCodes,
  refreshTokens,
  users,
} from '../../db/schema.js';

export interface Mailer {
  sendRegistrationCode(email: string, code: string): Promise<void>;
  sendVerification(email: string, token: string): Promise<void>;
  sendPasswordReset(email: string, token: string): Promise<void>;
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

type AuthOptions = {
  accessSecret: string;
  emailVerificationRequired?: boolean;
  accessTokenTtl?: string;
  refreshTokenTtlMs?: number;
  now?: () => Date;
};

type Session = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresInSeconds: number;
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

function createRegistrationCode(): string {
  return String(randomInt(100000, 1000000));
}

export class AuthService {
  private readonly now: () => Date;
  private readonly accessSecret: Uint8Array;
  private readonly accessTokenTtl: string;
  private readonly refreshTokenTtlMs: number;
  private readonly emailVerificationRequired: boolean;

  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly mailer: Mailer,
    options: AuthOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.accessSecret = new TextEncoder().encode(options.accessSecret);
    this.accessTokenTtl = options.accessTokenTtl ?? '30m';
    this.refreshTokenTtlMs = options.refreshTokenTtlMs ?? defaultRefreshTokenTtlMs;
    this.emailVerificationRequired = options.emailVerificationRequired ?? true;
  }

  requiresEmailVerification(): boolean {
    return this.emailVerificationRequired;
  }

  async requestRegistrationCode(email: string): Promise<{ expiresInSeconds: number }> {
    const normalizedEmail = normalizeEmail(email);
    const existing = await this.database.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (existing.length > 0) {
      throw new AuthError('EMAIL_ALREADY_REGISTERED', 'Email is already registered.');
    }

    const code = createRegistrationCode();
    const now = this.now();
    await this.database.insert(registrationCodes).values({
      email: normalizedEmail,
      codeHash: hashToken(code),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    });
    await this.mailer.sendRegistrationCode(normalizedEmail, code);
    return { expiresInSeconds: 600 };
  }

  async register(email: string, password: string, displayName: string, verificationCode?: string) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedDisplayName = displayName.trim();
    if (!normalizedDisplayName) {
      throw new AuthError('INVALID_DISPLAY_NAME', 'Name is required.');
    }
    if (password.length < 8) {
      throw new AuthError('WEAK_PASSWORD', 'Password must be at least 8 characters.');
    }

    const existing = await this.database.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (existing.length > 0) {
      throw new AuthError('EMAIL_ALREADY_REGISTERED', 'Email is already registered.');
    }

    if (this.emailVerificationRequired) {
      if (!verificationCode) {
        throw new AuthError('EMAIL_VERIFICATION_REQUIRED', 'A verification code is required.');
      }
      const [codeRecord] = await this.database
        .select({ id: registrationCodes.id })
        .from(registrationCodes)
        .where(and(
          eq(registrationCodes.email, normalizedEmail),
          eq(registrationCodes.codeHash, hashToken(verificationCode.trim())),
          isNull(registrationCodes.usedAt),
          gt(registrationCodes.expiresAt, this.now()),
        ))
        .orderBy(desc(registrationCodes.createdAt))
        .limit(1);
      if (!codeRecord) {
        throw new AuthError('INVALID_REGISTRATION_CODE', 'Verification code is invalid or expired.');
      }

      const user = await this.createUser(normalizedEmail, password, normalizedDisplayName, true);
      await this.database.update(registrationCodes).set({ usedAt: this.now(), updatedAt: this.now() }).where(eq(registrationCodes.id, codeRecord.id));
      return user;
    }

    return this.createUser(normalizedEmail, password, normalizedDisplayName, true);
  }

  private async createUser(email: string, password: string, displayName: string, verified: boolean) {
    const existing = await this.database.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      throw new AuthError('EMAIL_ALREADY_REGISTERED', 'Email is already registered.');
    }

    const [user] = await this.database
      .insert(users)
      .values({ email, displayName, passwordHash: await argon2.hash(password), emailVerifiedAt: verified ? this.now() : null })
      .returning({ id: users.id, email: users.email, displayName: users.displayName });

    if (verified) return user;

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
    return this.database.transaction(async (tx) => {
    const [record] = await tx
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

    const [claimed] = await tx.update(refreshTokens).set({ revokedAt: this.now(), updatedAt: this.now() }).where(and(eq(refreshTokens.id, record.id), isNull(refreshTokens.revokedAt))).returning({ userId: refreshTokens.userId });
    if (!claimed) throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token has already been rotated.');
    return this.issueSession(claimed.userId, tx as unknown as PostgresJsDatabase);
    });
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
    return this.database.transaction(async (tx) => {
      const [record] = await tx.update(deviceCodes)
        .set({ consumedAt: this.now() })
        .where(and(
          eq(deviceCodes.deviceCodeHash, hashToken(deviceCode)),
          isNull(deviceCodes.consumedAt),
          gt(deviceCodes.expiresAt, this.now()),
        ))
        .returning({ userId: deviceCodes.userId });
      if (!record?.userId) {
        throw new AuthError('DEVICE_AUTHORIZATION_PENDING', 'Device authorization is still pending.');
      }
      return this.issueSession(record.userId, tx as unknown as PostgresJsDatabase);
    });
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

  async updateProfile(userId: string, displayName: string | null) {
    const result = await this.database
      .update(users)
      .set({ displayName: displayName?.trim() || null, updatedAt: this.now() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (result.length === 0) throw new AuthError('USER_NOT_FOUND', 'User does not exist.');
    return this.getUser(userId);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const [user] = await this.database.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (!user) return;
    const token = createToken();
    await this.database.insert(emailTokens).values({
      userId: user.id,
      tokenHash: hashToken(token),
      purpose: 'reset_password',
      expiresAt: new Date(this.now().getTime() + 30 * 60 * 1000),
    });
    await this.mailer.sendPasswordReset(user.email, token);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    if (password.length < 8) throw new AuthError('WEAK_PASSWORD', 'Password must be at least 8 characters.');
    await this.database.transaction(async (tx) => {
      const [record] = await tx.update(emailTokens)
        .set({ usedAt: this.now() })
        .where(and(eq(emailTokens.tokenHash, hashToken(token.trim())), eq(emailTokens.purpose, 'reset_password'), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, this.now())))
        .returning({ id: emailTokens.id, userId: emailTokens.userId });
      if (!record) throw new AuthError('INVALID_PASSWORD_RESET_TOKEN', 'Password reset link is invalid or expired.');
      await tx.update(users).set({ passwordHash: await argon2.hash(password), updatedAt: this.now() }).where(eq(users.id, record.userId));
      await tx.update(refreshTokens).set({ revokedAt: this.now(), updatedAt: this.now() }).where(and(eq(refreshTokens.userId, record.userId), isNull(refreshTokens.revokedAt)));
    });
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    await this.database.update(refreshTokens).set({ revokedAt: this.now(), updatedAt: this.now() }).where(and(eq(refreshTokens.tokenHash, hashToken(refreshToken)), isNull(refreshTokens.revokedAt)));
  }

  private async issueSession(userId: string, database = this.database): Promise<Session> {
    const refreshToken = createToken();
    const refreshExpiresAt = new Date(this.now().getTime() + this.refreshTokenTtlMs);
    await database.insert(refreshTokens).values({
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
      expiresInSeconds: decodeJwt(accessToken).exp! - decodeJwt(accessToken).iat!,
      refreshExpiresInSeconds: Math.floor(this.refreshTokenTtlMs / 1000),
    };
  }
}
