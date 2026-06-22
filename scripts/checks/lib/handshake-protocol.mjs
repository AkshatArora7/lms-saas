// Pure handshake-protocol guard logic. No FS, no git — operates over string and
// array inputs so it is fully unit-testable. See
// .claude/handshakes/feat-multi-agent-delegation-protocol.md §4 (Guards A/B/C).
//
// Three guards keep the multi-agent delegation protocol's machine-readable
// surfaces honest:
//   Guard A — template integrity: .claude/agents/handshake.template.md contains
//             all seven required sections, in order, by stable `## N.` anchors.
//   Guard B — role drift: the agent files (.claude/agents/*.md minus README +
//             handshake.template), the role catalogue in
//             docs/AGENT_DELEGATION_PROTOCOL.md, and the role table in
//             .claude/agents/README.md must name the SAME set of roles.
//   Guard C — local handshake lint (advisory): a single live handshake validates
//             against the seven sections + its §7 last log line names a valid
//             next owner. Live handshakes are git-ignored, so CI sees none.

/**
 * The seven required handshake sections, in canonical order. Each entry pins a
 * section number (`n`) and a case-insensitive `keyword` that the `## N.` heading
 * text must contain. Matching by anchor + keyword (not exact prose) tolerates
 * minor heading wording while still catching a renamed/missing/reordered section.
 * @type {{ n: number, keyword: string }[]}
 */
export const REQUIRED_SECTIONS = [
  { n: 1, keyword: "task" },
  { n: 2, keyword: "acceptance" },
  { n: 3, keyword: "stage" },
  { n: 4, keyword: "decision" },
  { n: 5, keyword: "verification" },
  { n: 6, keyword: "open question" },
  { n: 7, keyword: "handshake log" },
];

/**
 * Extract the `## N. ...` section headings from a markdown string, in document
 * order. Returns the full heading text after the `## ` marker (e.g.
 * "1. Task", "2. Acceptance criteria").
 * @param {string} md
 * @returns {string[]}
 */
export function parseSections(md) {
  const headings = [];
  const re = /^##\s+(\d+\.\s.*)$/gm;
  let m;
  while ((m = re.exec(String(md ?? ""))) !== null) {
    headings.push(m[1].trim());
  }
  return headings;
}

/**
 * Guard A — assert a handshake template contains all seven required sections, in
 * order. Each required section must appear as a heading line anchored by
 * `^##\s+N\.` and whose text contains the case-insensitive keyword.
 * @param {string} templateMd  contents of handshake.template.md
 * @returns {string[]} human-readable violation messages; empty array = GREEN.
 */
export function validateTemplate(templateMd) {
  const md = String(templateMd ?? "");
  const headings = parseSections(md);
  const violations = [];

  // Index the numbered headings actually present, by their leading number.
  const byNumber = new Map();
  for (let i = 0; i < headings.length; i++) {
    const numMatch = headings[i].match(/^(\d+)\./);
    if (numMatch) byNumber.set(Number(numMatch[1]), { text: headings[i], pos: i });
  }

  let lastPos = -1;
  for (const { n, keyword } of REQUIRED_SECTIONS) {
    const found = byNumber.get(n);
    if (!found) {
      violations.push(
        `template is missing required section §${n} (expected heading "## ${n}. …" containing "${keyword}")`,
      );
      continue;
    }
    if (!found.text.toLowerCase().includes(keyword)) {
      violations.push(
        `template §${n} heading "${found.text}" does not contain the required keyword "${keyword}"`,
      );
    }
    if (found.pos < lastPos) {
      violations.push(
        `template section §${n} ("${found.text}") is out of order (must follow §${n - 1})`,
      );
    }
    lastPos = Math.max(lastPos, found.pos);
  }

  return violations;
}

/**
 * Map agent definition filenames to role slugs: drop the `.md` suffix, and
 * exclude README.md, handshake.template.md, and any name in `exceptions`
 * (matched with or without the `.md` suffix).
 * @param {string[]} filenames  e.g. ["architect.md", "README.md", ...]
 * @param {string[]} [exceptions]  documented non-role files (e.g. ["README", "handshake.template"]).
 * @returns {string[]} sorted unique role slugs.
 */
export function roleSlugsFromFilenames(filenames, exceptions = []) {
  const exempt = new Set();
  for (const e of exceptions) {
    exempt.add(e);
    exempt.add(e.replace(/\.md$/, ""));
  }
  const slugs = new Set();
  for (const file of filenames) {
    const base = String(file).replace(/.*[\\/]/, "").replace(/\.md$/, "");
    if (!base) continue;
    if (exempt.has(base)) continue;
    slugs.add(base);
  }
  return [...slugs].sort();
}

/**
 * Return which of `canonicalSlugs` appear in a document as a backticked token
 * (`` `slug` ``). Backtick matching avoids brittle table parsing and prose
 * false-positives.
 * @param {string} docMd
 * @param {string[]} canonicalSlugs
 * @returns {string[]} the subset of canonicalSlugs documented in docMd.
 */
export function documentedRoles(docMd, canonicalSlugs) {
  const md = String(docMd ?? "");
  const present = new Set();
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    present.add(m[1].trim());
  }
  return canonicalSlugs.filter((slug) => present.has(slug));
}

/**
 * Collect every backticked token in a doc that LOOKS like a role slug
 * (lowercase-hyphen, `^[a-z][a-z-]+$`). Used for reverse-drift detection.
 * @param {string} docMd
 * @returns {Set<string>}
 */
function backtickedSlugLikeTokens(docMd) {
  const md = String(docMd ?? "");
  const tokens = new Set();
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const tok = m[1].trim();
    if (/^[a-z][a-z-]+$/.test(tok)) tokens.add(tok);
  }
  return tokens;
}

/**
 * Guard B — role drift across three sources. The canonical role set is the set
 * of agent filenames (minus README/handshake.template/exceptions). Forward
 * drift: an agent file not documented (as a backticked token) in the protocol
 * doc OR in the README. Reverse drift: a backticked slug-like token in either
 * doc that has no matching agent file (and is not an exception). Mirrors the
 * forward/reverse symmetry of the RLS invariant guard.
 * @param {string[]} agentFilenames  e.g. result of globbing .claude/agents/*.md
 * @param {string} protocolDocMd     contents of docs/AGENT_DELEGATION_PROTOCOL.md
 * @param {string} readmeMd          contents of .claude/agents/README.md
 * @param {string[]} [exceptions]    documented non-role filenames.
 * @returns {string[]} human-readable violation messages; empty array = GREEN.
 */
export function findRoleDrift(agentFilenames, protocolDocMd, readmeMd, exceptions = []) {
  const canonical = roleSlugsFromFilenames(agentFilenames, exceptions);
  const canonicalSet = new Set(canonical);
  const exemptSlugs = new Set(exceptions.map((e) => e.replace(/\.md$/, "")));

  const inProtocol = new Set(documentedRoles(protocolDocMd, canonical));
  const inReadme = new Set(documentedRoles(readmeMd, canonical));

  const violations = [];

  // Forward drift: every canonical agent file must be documented in BOTH docs.
  for (const slug of canonical) {
    if (!inProtocol.has(slug)) {
      violations.push(
        `agent file "${slug}.md" is not documented (as a \`${slug}\` token) in docs/AGENT_DELEGATION_PROTOCOL.md`,
      );
    }
    if (!inReadme.has(slug)) {
      violations.push(
        `agent file "${slug}.md" is not documented (as a \`${slug}\` token) in .claude/agents/README.md`,
      );
    }
  }

  // Reverse drift: a backticked slug-like token in either doc with no agent file.
  const reverseSources = [
    { label: "docs/AGENT_DELEGATION_PROTOCOL.md", tokens: backtickedSlugLikeTokens(protocolDocMd) },
    { label: ".claude/agents/README.md", tokens: backtickedSlugLikeTokens(readmeMd) },
  ];
  for (const { label, tokens } of reverseSources) {
    for (const tok of tokens) {
      if (!tok.includes("-")) continue; // require hyphen to look like an agent slug, avoid prose like `feat`
      if (canonicalSet.has(tok)) continue;
      if (exemptSlugs.has(tok)) continue;
      violations.push(
        `${label} references role-like token \`${tok}\` but no .claude/agents/${tok}.md file exists (stale role reference)`,
      );
    }
  }

  return violations;
}

/**
 * Guard C — validate a single live handshake (advisory). Asserts it carries all
 * seven required sections, in order, and that its §7 Handshake log has at least
 * one log line whose LAST line names a `next owner → <role>` slug present in
 * `canonicalSlugs`.
 * @param {string} filename       for context in messages (e.g. "feat-x.md")
 * @param {string} md             handshake file contents
 * @param {string[]} canonicalSlugs  the canonical role set
 * @returns {string[]} human-readable violation messages; empty array = GREEN.
 */
export function validateHandshake(filename, md, canonicalSlugs) {
  const text = String(md ?? "");
  const violations = [];
  const slugSet = new Set(canonicalSlugs);

  // Reuse Guard A's structural check on the handshake's own sections.
  for (const v of validateTemplate(text)) {
    violations.push(`${filename}: ${v}`);
  }

  // §7 handshake log: collect the `- ... next owner → <role>` lines.
  const logLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /next owner/i.test(l));

  if (logLines.length === 0) {
    violations.push(`${filename}: §7 Handshake log has no log line naming a "next owner → <role>"`);
    return violations;
  }

  const last = logLines[logLines.length - 1];
  // Anchor on the `next owner →` marker (not any arrow in the prose), then pull
  // the first slug-like token after it. Tolerates `**`/whitespace around it.
  const ownerMatch = last.match(/next owner\s*\**\s*(?:→|->)\s*\**\s*([a-z][a-z-]+)/i);
  const named = ownerMatch ? ownerMatch[1] : null;

  if (!named || !slugSet.has(named)) {
    violations.push(
      `${filename}: last §7 log line names next owner "${named ?? "<none>"}" which is not a known role`,
    );
  }

  return violations;
}
