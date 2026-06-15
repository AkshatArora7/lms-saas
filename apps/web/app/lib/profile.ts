import type { Session } from "./auth";

/**
 * Display profile for the learner profile & preferences screen.
 *
 * The session from the identity service carries identifiers, roles and scopes
 * but not yet a rich profile (display name, email, preferences). In production
 * these come from the identity/profile service. Until that read/write path is
 * wired in, we derive a presentable profile from the session: a humanised
 * display name and a demo email for the seeded demo tenant, with sensible
 * defaults for preferences that are clearly marked as not yet configurable.
 */

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";
const DEMO_EMAIL_DOMAIN = "northwind.example.edu";

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

function deriveEmail(userId: string, tenantId: string): string {
  if (userId.includes("@")) {
    return userId;
  }
  if (tenantId === DEMO_TENANT_ID) {
    const local = userId.replace(/\s+/g, ".").toLowerCase();
    return `${local}@${DEMO_EMAIL_DOMAIN}`;
  }
  return "Not provided";
}

/** Build a display profile from the current session. */
export function getProfile(session: Session): Profile {
  const displayName = humaniseName(session.userId);

  return {
    displayName,
    email: deriveEmail(session.userId, session.tenantId),
    initialsSource: displayName,
    userId: session.userId,
    tenantId: session.tenantId,
    tier: session.tier,
    roles: session.roles,
    scopes: session.scopes,
    preferences: [
      { label: "Language", value: "English (US)" },
      { label: "Time zone", value: "America/Toronto" },
      { label: "Email notifications", value: "Announcements & due dates" },
    ],
  };
}
