import { withTenant } from "@lms/db";

import type {
  AgeBand,
  ConsentMethod,
  ConsentRecord,
  ConsentStatus,
  ConsentStore,
  ConsentType,
  RecordConsentInput,
} from "./consent.js";

interface ConsentRow {
  id: string;
  tenant_id: string;
  subject_user_id: string;
  age_band: AgeBand;
  consent_type: ConsentType;
  status: ConsentStatus;
  guardian_name: string | null;
  guardian_email: string | null;
  method: ConsentMethod | null;
  recorded_by: string | null;
  recorded_at: Date | string;
  revoked_at: Date | string | null;
}

interface Db {
  $queryRawUnsafe<T>(sql: string, ...args: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toConsent(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subjectUserId: row.subject_user_id,
    ageBand: row.age_band,
    consentType: row.consent_type,
    status: row.status,
    guardianName: row.guardian_name,
    guardianEmail: row.guardian_email,
    method: row.method,
    recordedBy: row.recorded_by,
    recordedAt: isoOrNull(row.recorded_at) ?? "",
    revokedAt: isoOrNull(row.revoked_at),
  };
}

const SELECT = `
  SELECT id, tenant_id, subject_user_id, age_band, consent_type, status,
         guardian_name, guardian_email, method, recorded_by, recorded_at,
         revoked_at
    FROM parental_consent`;

/** RLS-scoped parental-consent store (uuid params cast; upsert per the UNIQUE). */
export function createPrismaConsentStore(): ConsentStore {
  return {
    async recordConsent(ctx, input: RecordConsentInput): Promise<ConsentRecord> {
      const status = input.status ?? "pending";
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ConsentRow[]>(
          `INSERT INTO parental_consent
             (tenant_id, subject_user_id, age_band, consent_type, status,
              guardian_name, guardian_email, method, recorded_by,
              recorded_at, revoked_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid,
                   now(),
                   CASE WHEN $5 = 'revoked' THEN now() ELSE NULL END)
           ON CONFLICT (tenant_id, subject_user_id, consent_type)
           DO UPDATE SET
             age_band = EXCLUDED.age_band,
             status = EXCLUDED.status,
             guardian_name = EXCLUDED.guardian_name,
             guardian_email = EXCLUDED.guardian_email,
             method = EXCLUDED.method,
             recorded_by = EXCLUDED.recorded_by,
             recorded_at = now(),
             revoked_at = CASE WHEN EXCLUDED.status = 'revoked'
                               THEN now() ELSE NULL END
           RETURNING id, tenant_id, subject_user_id, age_band, consent_type,
                     status, guardian_name, guardian_email, method, recorded_by,
                     recorded_at, revoked_at`,
          ctx.tenantId,
          input.subjectUserId,
          input.ageBand,
          input.consentType,
          status,
          input.guardianName ?? null,
          input.guardianEmail ?? null,
          input.method ?? null,
          input.recordedBy ?? null,
        );
        return toConsent(rows[0]!);
      });
    },

    async revokeConsent(ctx, id): Promise<ConsentRecord | null> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ConsentRow[]>(
          `UPDATE parental_consent
              SET status = 'revoked', revoked_at = now()
            WHERE id = $1::uuid
           RETURNING id, tenant_id, subject_user_id, age_band, consent_type,
                     status, guardian_name, guardian_email, method, recorded_by,
                     recorded_at, revoked_at`,
          id,
        );
        return rows[0] ? toConsent(rows[0]) : null;
      });
    },

    async listConsents(ctx, subjectUserId): Promise<ConsentRecord[]> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<ConsentRow[]>(
          `${SELECT} WHERE subject_user_id = $1::uuid ORDER BY consent_type`,
          subjectUserId,
        );
        return rows.map(toConsent);
      });
    },

    async getAgeBand(ctx, subjectUserId): Promise<AgeBand> {
      return withTenant(ctx, async (db: Db) => {
        const rows = await db.$queryRawUnsafe<{ age_band: AgeBand }[]>(
          `SELECT age_band FROM parental_consent
            WHERE subject_user_id = $1::uuid
            ORDER BY recorded_at DESC LIMIT 1`,
          subjectUserId,
        );
        return rows[0]?.age_band ?? "unknown";
      });
    },
  };
}
