import { describe, expect, it } from "vitest";

import { isSafeLaunchHref, parseManifest } from "./manifest.js";
import { isPassing, normalizeCmi } from "./runtime.js";

// --- Fixture manifests -----------------------------------------------------

const SCORM_12 = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-1" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Intro to Fire Safety</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>Module 1</title>
        <adlcp:masteryscore>80</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" adlcp:scormtype="sco" href="content/index.html">
      <file href="content/index.html"/>
    </resource>
  </resources>
</manifest>`;

const SCORM_2004 = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-2" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-2">
    <organization identifier="ORG-2">
      <title>Advanced Safety 2004</title>
      <item identifier="ITEM-A" identifierref="RES-A">
        <title>Unit A</title>
        <imsss:sequencing>
          <imsss:objectives>
            <imsss:primaryObjective>
              <imsss:minNormalizedMeasure>0.7</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>
          </imsss:objectives>
        </imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-A" adlcp:scormType="sco" href="sco/start.html">
      <file href="sco/start.html"/>
    </resource>
  </resources>
</manifest>`;

describe("scorm: parseManifest (SCORM 1.2)", () => {
  it("extracts version, org title, launch href and mastery score", () => {
    const r = parseManifest(SCORM_12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.version).toBe("1.2");
    expect(r.manifest.organizationTitle).toBe("Intro to Fire Safety");
    expect(r.manifest.launchHref).toBe("content/index.html");
    expect(r.manifest.masteryScore).toBeCloseTo(0.8);
    expect(r.manifest.items).toHaveLength(1);
    expect(r.manifest.items[0]).toMatchObject({
      identifier: "ITEM-1",
      title: "Module 1",
      identifierref: "RES-1",
      launchHref: "content/index.html",
    });
  });
});

describe("scorm: parseManifest (SCORM 2004)", () => {
  it("extracts version, org title, launch href and mastery measure", () => {
    const r = parseManifest(SCORM_2004);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.version).toBe("2004");
    expect(r.manifest.organizationTitle).toBe("Advanced Safety 2004");
    expect(r.manifest.launchHref).toBe("sco/start.html");
    expect(r.manifest.masteryScore).toBeCloseTo(0.7);
  });
});

describe("scorm: parseManifest rejects unsafe / malformed input", () => {
  it("rejects malformed XML", () => {
    const r = parseManifest("<manifest><organizations>");
    // Either the parser throws or there is no launchable resource — both fail.
    expect(r.ok).toBe(false);
  });

  it("rejects DOCTYPE (XXE guard)", () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<manifest><organizations><organization><title>&xxe;</title></organization></organizations></manifest>`;
    const r = parseManifest(xxe);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_xml");
  });

  it("rejects a bare ENTITY declaration (billion-laughs guard)", () => {
    const lol = `<!ENTITY lol "lol"><manifest/>`;
    const r = parseManifest(lol);
    expect(r.ok).toBe(false);
  });

  it("rejects a path-traversal launch href", () => {
    const evil = SCORM_12.replace("content/index.html", "../../etc/passwd");
    const r = parseManifest(evil);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unsafe_href");
  });

  it("rejects an absolute-URL launch href", () => {
    const evil = SCORM_12.replace(
      "content/index.html",
      "https://evil.example/x.html",
    );
    const r = parseManifest(evil);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unsafe_href");
  });

  it("reports no launchable resource when none resolves", () => {
    const none = `<manifest><metadata><schemaversion>1.2</schemaversion></metadata>
      <organizations><organization><title>Empty</title></organization></organizations>
      <resources></resources></manifest>`;
    const r = parseManifest(none);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_launchable_resource");
  });
});

describe("scorm: isSafeLaunchHref", () => {
  it("accepts relative paths and rejects unsafe ones", () => {
    expect(isSafeLaunchHref("content/index.html")).toBe(true);
    expect(isSafeLaunchHref("sco/start.html?x=1")).toBe(true);
    expect(isSafeLaunchHref("/abs/path")).toBe(false);
    expect(isSafeLaunchHref("../escape")).toBe(false);
    expect(isSafeLaunchHref("a\\b")).toBe(false);
    expect(isSafeLaunchHref("http://x/y")).toBe(false);
    expect(isSafeLaunchHref("//cdn/x")).toBe(false);
    expect(isSafeLaunchHref("")).toBe(false);
  });
});

describe("scorm: normalizeCmi (SCORM 1.2)", () => {
  it("maps lesson_status=passed → completed/passed", () => {
    const n = normalizeCmi({ lessonStatus: "passed", scoreRaw: 90, scoreMax: 100 });
    expect(n.completionStatus).toBe("completed");
    expect(n.successStatus).toBe("passed");
    expect(n.scoreRaw).toBe(90);
    expect(n.scoreScaled).toBeCloseTo(0.9);
    expect(n.lessonStatus).toBe("passed");
  });

  it("maps lesson_status=incomplete and failed", () => {
    expect(normalizeCmi({ lessonStatus: "incomplete" }).completionStatus).toBe(
      "incomplete",
    );
    const failed = normalizeCmi({ lessonStatus: "failed" });
    expect(failed.completionStatus).toBe("completed");
    expect(failed.successStatus).toBe("failed");
  });
});

describe("scorm: normalizeCmi (SCORM 2004)", () => {
  it("uses explicit completion/success/scaled fields", () => {
    const n = normalizeCmi({
      completionStatus: "completed",
      successStatus: "passed",
      scoreScaled: 0.85,
      scoreRaw: 85,
    });
    expect(n.completionStatus).toBe("completed");
    expect(n.successStatus).toBe("passed");
    expect(n.scoreScaled).toBeCloseTo(0.85);
    expect(n.scoreRaw).toBe(85);
  });

  it("clamps an out-of-range scaled score to 0..1", () => {
    expect(normalizeCmi({ scoreScaled: 1.5 }).scoreScaled).toBe(1);
    expect(normalizeCmi({ scoreScaled: -0.5 }).scoreScaled).toBe(0);
  });
});

describe("scorm: isPassing", () => {
  it("passes on success=passed or score meeting mastery", () => {
    expect(
      isPassing({ successStatus: "passed", scoreScaled: null }, null),
    ).toBe(true);
    expect(
      isPassing({ successStatus: "unknown", scoreScaled: 0.9 }, 0.8),
    ).toBe(true);
    expect(
      isPassing({ successStatus: "unknown", scoreScaled: 0.5 }, 0.8),
    ).toBe(false);
    expect(
      isPassing({ successStatus: "failed", scoreScaled: null }, null),
    ).toBe(false);
  });
});
