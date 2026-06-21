import type { Session } from "./auth";
import { getUser } from "./user-org-api";

/**
 * Display profile for the learner profile & preferences screen, sourced live
 * from the user-org microservice via the BFF server-fetch pattern (tenant-scoped
 * with `x-tenant-id`). The service supplies the display name, email and locale;
 * identifiers, tier, roles and scopes come from the session. When the service is
 * unreachable we fall back to session-derived values rather than crashing — but
 * we never invent demo values for fields the service owns.
 */

export interface Preference {
  label: string;
  value: string;
}

export interface Profile {
  displayName: string;
  email: string;
  initialsSource: string;
  userId: string;
  tenantId: string;
  tier: string;
  roles: string[];
  scopes: string[];
  preferences: Preference[];
}

/** Turn an opaque user identifier into a human-friendly display name. */
function humaniseName(userId: string): string {
  const local = userId.includes("@") ? userId.split("@")[0] ?? userId : userId;
  const words = local
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return userId;
  }
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Build a display profile from the user-org record + the current session. */
export async function getProfile(session: Session): Promise<Profile> {
  const user = await getUser(session.userId, session.tenantId);

  const displayName = user?.displayName ?? humaniseName(session.userId);
  const email =
    user?.email ??
    (session.userId.includes("@") ? session.userId : "Not provided");

  const preferences: Preference[] = [];
  if (user?.locale) {
    preferences.push({ label: "Language", value: user.locale });
  }

  return {
    displayName,
    email,
    initialsSource: displayName,
    userId: session.userId,
    tenantId: session.tenantId,
    tier: session.tier,
    roles: session.roles,
    scopes: session.scopes,
    preferences,
  };
}
