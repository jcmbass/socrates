/**
 * User / AuthIdentifier — B3-modelo-de-dominio.md §2.1.
 *
 * `AuthIdentifier` is a value object (B3 §1: embedded in `User`, no own
 * store/schemaVersion). `User` is a first-class entity.
 *
 * Not a redefinition of anything in @buxo/core — the alfa (`lib/session.ts`)
 * never modeled accounts at all (B3 §5.3: "la alfa no tiene cuentas").
 */
import { z } from "zod";
import { idSchema, isoTimestampSchema, schemaVersionSchema } from "./common";

export const ACCOUNT_STATUSES = ["active", "suspended", "deleted"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const AUTH_IDENTIFIER_TYPES = ["email", "phone", "external_oauth"] as const;
export type AuthIdentifierType = (typeof AUTH_IDENTIFIER_TYPES)[number];

export const ACCOUNT_KINDS = ["student", "internal_dev"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/**
 * How a user authenticates. Deliberately generic: O-10 (email vs.
 * phone/OTP vs. OAuth) is not decided yet (A1/C2 spec) — B3 does not bet on
 * one shape.
 */
export interface AuthIdentifier {
  type: AuthIdentifierType;
  /** @sensitive PII */
  value: string;
  verifiedAt: string | null;
  isPrimary: boolean;
}

export const AuthIdentifierSchema: z.ZodType<AuthIdentifier> = z.object({
  type: z.enum(AUTH_IDENTIFIER_TYPES),
  value: z.string().min(1),
  verifiedAt: isoTimestampSchema.nullable(),
  isPrimary: z.boolean(),
});

export interface User {
  id: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;

  /** @sensitive nombre elegido por un posible menor */
  displayName: string;
  /** @sensitive */
  authIdentifiers: AuthIdentifier[];

  /** ISO 3166-1 alpha-2. DF-4: solo "SV" activo en etapa 1. */
  countryCode: string;
  /** BCP-47, p.ej. "es" — consumido por D1. */
  preferredLanguageCode: string;

  /**
   * DF-3: auto-declaración de edad 13+ + términos, sin flujo parental
   * in-app en etapa 1. Hecho que A1/C2 necesitan para el gate de acceso.
   */
  ageConfirmedAt: string;
  /**
   * Opcional, NO usado para gatear acceso en etapa 1 (eso lo hace
   * ageConfirmedAt). Existe para no remodelar el día que se habiliten los
   * grados menores (1º-9º, edades 6-15) — O-13/DF-4. @sensitive.
   */
  birthYear: number | null;

  /** Puntero de conveniencia, denormalizado. */
  currentCourseId: string | null;
  accountStatus: AccountStatus;
  /** Tombstone — ver B3 §6 (borrado real). */
  deletedAt: string | null;

  /**
   * Distingue las cuentas internas del founder (harness/QA/B4) de
   * estudiantes reales. NUNCA true para un usuario real; usado para eximir
   * de cuotas (UsageQuota.capTutorMessages: null) y excluir de métricas de
   * producto.
   */
  accountKind: AccountKind;

  /** D-C07: NULL means the user has not completed the seed onboarding flow yet. */
  onboardingCompletedAt: string | null;
}

export const UserSchema: z.ZodType<User> = z.object({
  id: idSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  schemaVersion: schemaVersionSchema,

  displayName: z.string().min(1),
  authIdentifiers: z.array(AuthIdentifierSchema),

  countryCode: z.string().length(2),
  preferredLanguageCode: z.string().min(2),

  ageConfirmedAt: isoTimestampSchema,
  birthYear: z.number().int().nullable(),

  currentCourseId: idSchema.nullable(),
  accountStatus: z.enum(ACCOUNT_STATUSES),
  deletedAt: isoTimestampSchema.nullable(),

  accountKind: z.enum(ACCOUNT_KINDS),

  onboardingCompletedAt: isoTimestampSchema.nullable(),
});
