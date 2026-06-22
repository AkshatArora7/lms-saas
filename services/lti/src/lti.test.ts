import { describe, expect, it } from "vitest";

import {
  CLAIM,
  LTI_VERSION,
  MSG_TYPE_RESOURCE_LINK,
  mapLtiRoles,
  validateLaunchClaims,
} from "./lti.js";

const MEMBERSHIP = "http://purl.imsglobal.org/vocab/lis/v2/membership#";

describe("mapLtiRoles (pure)", () => {
  it("maps Instructor → instructor (URN and short form)", () => {
    expect(mapLtiRoles([`${MEMBERSHIP}Instructor`]).primary).toBe("instructor");
    expect(mapLtiRoles(["Instructor"]).primary).toBe("instructor");
  });

  it("maps Learner / Student → learner", () => {
    expect(mapLtiRoles([`${MEMBERSHIP}Learner`]).primary).toBe("learner");
    expect(mapLtiRoles(["Student"]).primary).toBe("learner");
  });

  it("maps system/institution Administrator → org_admin", () => {
    expect(
      mapLtiRoles([
        "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator",
      ]).primary,
    ).toBe("org_admin");
    expect(mapLtiRoles([`${MEMBERSHIP}Administrator`]).primary).toBe("org_admin");
  });

  it("maps ContentDeveloper → course_builder, TeachingAssistant → teaching_assistant", () => {
    expect(mapLtiRoles([`${MEMBERSHIP}ContentDeveloper`]).primary).toBe(
      "course_builder",
    );
    expect(mapLtiRoles([`${MEMBERSHIP}TeachingAssistant`]).primary).toBe(
      "teaching_assistant",
    );
  });

  it("picks the highest-privilege role when several are present", () => {
    const m = mapLtiRoles([
      `${MEMBERSHIP}Learner`,
      `${MEMBERSHIP}Instructor`,
      `${MEMBERSHIP}Administrator`,
    ]);
    expect(m.primary).toBe("org_admin");
    // Deduped, precedence order, no super_admin ever.
    expect(m.roles).toEqual(["org_admin", "instructor", "learner"]);
    expect(m.roles).not.toContain("super_admin");
  });

  it("falls back to learner (least privilege) when nothing matches", () => {
    expect(mapLtiRoles([]).primary).toBe("learner");
    expect(mapLtiRoles(["urn:something:unknown#Wizard"]).primary).toBe("learner");
  });
});

describe("validateLaunchClaims (pure)", () => {
  const base = (): Record<string, unknown> => ({
    sub: "user-1",
    nonce: "nonce-1",
    [CLAIM.version]: LTI_VERSION,
    [CLAIM.messageType]: MSG_TYPE_RESOURCE_LINK,
    [CLAIM.deploymentId]: "dep-1",
    [CLAIM.roles]: [`${MEMBERSHIP}Instructor`],
    [CLAIM.resourceLink]: { id: "rl-1", title: "Week 1" },
    [CLAIM.context]: { id: "ctx-1", title: "Biology 101" },
    [CLAIM.targetLinkUri]: "https://app.lms.test/course/1",
  });
  const opts = {
    expectedNonce: "nonce-1",
    isKnownDeployment: (d: string) => d === "dep-1",
  };

  it("accepts a well-formed Resource Link launch", () => {
    const r = validateLaunchClaims(base(), opts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.launch.sub).toBe("user-1");
      expect(r.launch.deploymentId).toBe("dep-1");
      expect(r.launch.primaryRole).toBe("instructor");
      expect(r.launch.resourceLink.id).toBe("rl-1");
      expect(r.launch.context?.id).toBe("ctx-1");
    }
  });

  it("rejects a nonce mismatch", () => {
    const r = validateLaunchClaims({ ...base(), nonce: "other" }, opts);
    expect(r).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("rejects a wrong message_type and version", () => {
    expect(
      validateLaunchClaims({ ...base(), [CLAIM.messageType]: "DeepLink" }, opts),
    ).toEqual({ ok: false, reason: "wrong_message_type" });
    expect(
      validateLaunchClaims({ ...base(), [CLAIM.version]: "1.2.0" }, opts),
    ).toEqual({ ok: false, reason: "wrong_version" });
  });

  it("rejects an unknown deployment_id", () => {
    const r = validateLaunchClaims({ ...base(), [CLAIM.deploymentId]: "nope" }, opts);
    expect(r).toEqual({ ok: false, reason: "unknown_deployment" });
  });

  it("rejects a missing sub and missing resource link", () => {
    const noSub = { ...base() };
    delete noSub.sub;
    expect(validateLaunchClaims(noSub, opts)).toEqual({
      ok: false,
      reason: "missing_sub",
    });
    const noRl = { ...base() };
    delete noRl[CLAIM.resourceLink];
    expect(validateLaunchClaims(noRl, opts)).toEqual({
      ok: false,
      reason: "missing_resource_link",
    });
  });
});
