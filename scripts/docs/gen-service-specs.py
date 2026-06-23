#!/usr/bin/env python3
"""Generate per-service design specs under docs/services/.

Single source of truth for the microservice catalogue: responsibility, owned
tables, key endpoints, events published/consumed, and dependencies. Re-run to
regenerate; output is deterministic.
"""
from __future__ import annotations
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "services")

# port base 4000 in declaration order from ARCHITECTURE.md
SERVICES = [
    {
        "name": "gateway", "port": 4000, "data": "stateless",
        "resp": "Edge authentication, JWT validation, per-tenant rate limiting, request routing and tenant resolution (slug/host -> tenant_id).",
        "tables": [],
        "endpoints": [
            ("ANY", "/* (reverse proxy)", "Validate JWT, resolve tenant, enforce rate limit, forward to the owning service."),
            ("GET", "/health", "Liveness/readiness."),
        ],
        "publishes": [],
        "consumes": [],
        "deps": ["identity (JWKS)", "tenant (routing table)", "Upstash Redis (rate-limit buckets)"],
        "notes": "Stateless; horizontally scalable. The single trust boundary: validates the JWT and stamps trusted identity headers downstream from the VERIFIED claims, stripping any client-supplied copies first (anti-spoof) -- `x-tenant-id` (tenant), plus `x-user-id` (= `claims.sub`) and `x-user-roles` (= `claims.roles.join(\",\")`, comma-separated). Backend services treat these as trusted ONLY because the gateway guarantees them, and layer per-resource authorization ON TOP of tenant RLS (first consumer: analytics `GET /reports/engagement`). The web BFF forwards the same identity headers from its server session when it calls a service directly. See [ADR-0027](../ADR-0027-trusted-identity-headers.md). Also adds trace headers downstream.",
    },
    {
        "name": "identity", "port": 4001, "data": "Postgres",
        "resp": "First-party auth and token issuance (local password login, rotating refresh tokens with token-family reuse detection, access-token introspection), plus federation (OIDC/SAML/LTI) and RBAC authorization (roles, permissions, assignments). External CIAM federation is optional/roadmap.",
        "tables": ["app_user (credential join)", "user_credential", "refresh_token", "identity_provider", "user_identity", "role", "permission", "role_permission", "role_assignment"],
        "endpoints": [
            ("POST", "/auth/login", "Verify email+password; issue an access token and a rotating refresh token."),
            ("POST", "/auth/refresh", "Rotate a refresh token; reuse of a revoked token revokes the whole family."),
            ("POST", "/auth/logout", "Revoke the presented token's family (idempotent)."),
            ("GET", "/auth/me", "Introspect the bearer access token -> subject, tenant, roles, scopes."),
            ("POST", "/sso/{provider}/callback", "Handle OIDC/SAML federated login -> link user_identity."),
            ("GET", "/authz/check", "Org-scoped, deny-by-default permission check (cascades down the org subtree)."),
            ("GET", "/users/{id}/effective-permissions", "A user's effective (permission, org-unit, cascade) grants, for debugging."),
            ("GET", "/permissions", "List the permission catalog roles can be built from."),
            ("POST", "/roles", "Create a custom role (is_system=false)."),
            ("GET", "/roles", "List the tenant's roles (system + custom)."),
            ("GET", "/roles/{id}", "Role detail + its permission keys."),
            ("PATCH", "/roles/{id}", "Rename a custom role (system roles are read-only)."),
            ("DELETE", "/roles/{id}", "Delete a custom role."),
            ("PUT", "/roles/{id}/permissions", "Replace a role's permission set (catalog-validated)."),
        ],
        "publishes": ["identity.user.authenticated", "identity.role.assigned", "identity.role.revoked", "role.created", "role.updated", "role.deleted"],
        "consumes": ["user.created (auto-provision identity link)"],
        "deps": ["tenant (provider config)", "External CIAM (WorkOS/Auth0, optional)", "Upstash Redis (sessions)"],
        "notes": "RBAC is tenant-scoped (RLS). LTI 1.3 launches are handled by the `lti` service, which mints the LMS session itself via `@lms/auth` (shared signing secret) rather than calling back here.",
    },
    {
        "name": "tenant", "port": 4002, "data": "control-plane DB",
        "resp": "Tenant catalogue and lifecycle: provisioning saga, pool/silo routing and pool->silo promotion, sub-tenant hierarchy (district -> school), feature flags, plan binding.",
        "tables": ["tenant", "plan", "subscription", "tenant_setting", "tenant_branding", "tenant_admin_delegation", "tenant_silo_migration"],
        "endpoints": [
            ("POST", "/tenants", "Provision a tenant; pass parentTenantId to register a school sub-tenant under a district (inherits plan; promotes parent)."),
            ("GET", "/tenants/{id}/children", "List/search a district's child sub-tenants (?q=)."),
            ("GET", "/tenants/{id}/routing", "Resolve pool vs silo + database_ref for connection routing."),
            ("GET", "/tenants/{id}/subtree", "District roll-up: root + descendants (tenant_subtree()) for parent reporting/billing."),
            ("PATCH", "/tenants/{id}/flags", "Toggle feature flags / add-on entitlements."),
            ("PUT", "/tenants/{id}/branding", "Set/override white-label branding (logo, favicon, palette, light/dark theme, custom domain, custom CSS, support email; hex colours validated)."),
            ("GET", "/tenants/{id}/branding", "Resolve effective branding -> {branding (inheritance-resolved: sub-tenant override -> parent district -> platform default), overrides (this tenant's own row)}."),
            ("GET", "/tenants/by-domain/{host}", "Pre-auth, control-plane: resolve a custom domain (Host) to its tenant via tenant_branding.custom_domain (citext UNIQUE). Returns only {tenantId}; 404 when no tenant claims the host. Lets the learner web app brand a custom-domain landing/login screen at the edge before any session exists."),
            ("PUT", "/tenants/{id}/settings/{key}", "Set a per-tenant governance setting (validated against the key catalog)."),
            ("GET", "/tenants/{id}/settings", "Effective governance settings (catalog defaults + overrides)."),
            ("GET", "/tenants/{id}/settings/{key}", "Effective value for one setting key."),
            ("GET", "/settings/catalog", "The catalog of known governance keys, types and defaults."),
            ("GET", "/tenants/{id}/export", "Offboarding export: OneRoster CSV + content archive (audited)."),
            ("POST", "/tenants/{id}/offboard", "Purge a tenant's data across all services (verified, audited) and mark it deleted."),
            ("POST", "/tenants/{id}/promote-to-silo", "Promote a pool tenant to a dedicated silo DB via a compensating saga (provision -> migrate -> bulk-copy -> repoint database_ref -> flip tier=silo); idempotent on body `idempotencyKey`. 200 {migration, tenant} on success; 409 {migration, failedStep} on failure+rollback; 409 `already_silo` if not pool-tier; 409 `idempotency_key_conflict` on cross-tenant key reuse. Destructive control-plane action -- gated upstream (gateway/platform-admin), no in-service claim."),
            ("GET", "/tenants/{id}/silo-migration", "Read the tenant's latest silo-promotion run: {migration:{id, tenantId, status, completedSteps, target?, error?, startedAt, finishedAt}}; 404 if none. target surfaces only opaque refs (projectId/branchId/databaseRef), never a raw DSN."),
            ("POST", "/tenants/{id}/delegations", "Delegate admin of a sub-tenant to a user (district -> school)."),
            ("GET", "/tenants/{id}/delegations", "List active admin delegations for a sub-tenant."),
            ("POST", "/tenants/{id}/delegations/{did}/revoke", "Revoke a delegation."),
            ("GET", "/tenants/{id}/access-check", "Hierarchy-aware decision: may an actor administer this sub-tenant?"),
        ],
        "publishes": ["tenant.provisioning.started", "tenant.activated", "tenant.suspended", "tenant.subtenant.linked", "tenant.branding.updated", "tenant.data.exported", "tenant.data.purged"],
        "consumes": ["billing.subscription.changed (entitlements)"],
        "deps": ["Neon API (silo branch/project create)", "secret store (database_ref -> DSN)", "billing", "all tenant-scoped services (offboarding export/purge via gateway)", "audit (offboarding trail)"],
        "notes": "Control-plane; `tenant` is NOT in the RLS tenant_tables loop. Provisioning is a saga with compensation (delete branch on failure). Pool->silo PROMOTION (#3) is a separate compensating saga in `services/tenant/src/silo.*`: a pure engine (`silo.saga.ts`) runs five ordered steps -- provision (Neon project+branch) -> migrate (apply schema.sql+rls.sql so silo is schema-identical) -> bulk-copy the tenant's rows -> repoint catalog `database_ref` -> flip `tier=silo` -- behind an injectable `SiloProvisioningPort` (prod = Neon REST adapter `silo.neon.ts`, tests = fake), exactly like the offboarding ports. Because the silo gets the identical `schema.sql`+`rls.sql`, pool<->silo is schema-identical and requires NO application code change. On ANY step failure the engine runs the completed steps' compensations in REVERSE order (catalog reverts first -- `setDatabaseRef`/`setTier` back to prior values -- then `deprovision` tears down infra last), marking the run `rolled_back` (or `compensation_failed` if a compensation itself throws, surfaced for manual intervention). repoint precedes flip so a partial run never leaves a silo-tier tenant whose `database_ref` is null. Each run is one row of the control-plane `tenant_silo_migration` table; `idempotency_key` is UNIQUE so a re-POST returns the existing run rather than starting a second saga (a cross-tenant key reuse is rejected 409, never echoing another tenant's refs). `database_ref` is an OPAQUE secret-store ref end-to-end -- never a raw DSN -- and is never logged or returned. FOLLOW-UPS (NOT yet implemented): (1) the LIVE Neon adapter -- `silo.neon.ts` ships as a documented STUB whose methods throw `not_implemented`; the real impl (Neon REST createProject/branch + secret-store WRITE of `database_ref` + prod `runMigrations`/`copyTenantData` preserving per-row `tenant_id`) is deferred; the saga engine + catalog repoint + rollback ship now and are fully covered via the fake adapter. (2) the MANDATORY upstream super-admin gate -- the destructive `POST /tenants/:id/promote-to-silo` carries NO in-service claim (consistent with the whole control-plane surface incl. the equally destructive `POST /tenants/:id/offboard`); it MUST be gated at the gateway/platform-admin layer before prod enablement. Offboarding orchestrates per-service export/purge behind ports; per-service admin export/erasure endpoints are the contract (unverified services surface as failed, never silent). White-label branding (#89/#12) is per-tenant including sub-tenants: `tenant_branding` stores logo/favicon/palette/theme/custom_domain/custom_css/support_email, and the SQL function `tenant_effective_branding()` walks the parent chain to resolve effective branding with the precedence sub-tenant override -> parent district -> platform default (theme/custom_domain/custom_css are tenant-specific, not inherited). `GET /tenants/by-domain/:host` is the pre-auth, control-plane host->tenant lookup the learner web app calls at the edge for custom domains; it is safe at control-plane because `custom_domain` is globally unique and the response carries only the opaque tenant id. See [DEPLOYMENT.md](../DEPLOYMENT.md#custom-domains-white-label-at-the-edge) for the Vercel custom-domain ops procedure, and [MULTI_TENANCY.md](../MULTI_TENANCY.md#pool--silo-promotion-saga-3) for the silo-promotion saga.",
    },
    {
        "name": "user-org", "port": 4003, "data": "Postgres (read-heavy)",
        "resp": "User profiles and the org-unit hierarchy (district/school/department/section) per OneRoster orgs/users; academic sessions; COPPA/age-appropriate parental consent for minors; guardian/parent relationships with consent-gated read-only access to a child's scoped data.",
        "tables": ["app_user", "org_unit", "academic_session", "parental_consent", "guardian_relationship"],
        "endpoints": [
            ("POST", "/org-units", "Create org unit under a parent (maintains materialised path; emits orgunit.created)."),
            ("GET", "/org-units", "List org units (filter by parentId, type)."),
            ("GET", "/org-units/{id}", "Fetch a single org unit."),
            ("GET", "/org-units/{id}/subtree", "Descendants via the path GIN index."),
            ("GET", "/org-units/{id}/ancestors", "Ancestors, root-first."),
            ("PATCH", "/org-units/{id}", "Rename / set active state."),
            ("POST", "/users", "Invite/create a user (emits user.created)."),
            ("GET", "/users", "List users (filter by status, orgUnitId); each item is the enriched UserProfile with `memberships: [{assignmentId, roleId, roleName, orgUnitId, cascade}]`, the same shape as GET /users/{id}."),
            ("GET", "/users/{id}", "Profile + org-unit role memberships."),
            ("PATCH", "/users/{id}", "Update profile/status (emits user.updated/deactivated)."),
            ("POST", "/users/{id}/roles", "Assign a per-tenant role at an org unit."),
            ("DELETE", "/users/{id}/roles/{assignmentId}", "Revoke a role assignment."),
            ("POST", "/compliance/consents", "Capture/upsert parental consent for a (subject, category)."),
            ("POST", "/compliance/consents/{id}/revoke", "Revoke a consent."),
            ("GET", "/compliance/subjects/{userId}/consents", "A subject's consent ledger."),
            ("GET", "/compliance/subjects/{userId}/data-policy", "Age-gated data-collection decision for a category."),
            ("POST", "/guardians", "Link a guardian to a student (starts status='pending'; emits guardian.linked)."),
            ("GET", "/students/{studentId}/guardians", "List a student's guardians."),
            ("GET", "/guardians/{guardianId}/students", "List a guardian's students."),
            ("POST", "/guardians/{id}/activate", "Activate a pending link after re-checking the student's consent gate (emits guardian.linked)."),
            ("POST", "/guardians/{id}/revoke", "Soft-revoke a guardian link (emits guardian.revoked)."),
            ("GET", "/guardians/authorize", "Read-only predicate: is this guardian an active, consent-satisfied guardian of this student? Consent is re-derived live."),
        ],
        "publishes": ["user.created", "user.updated", "user.deactivated", "orgunit.created", "guardian.linked", "guardian.revoked"],
        "consumes": ["sis.user.upserted", "sis.org.upserted"],
        "deps": ["identity (claims)", "sis (rostering source of truth when SIS-driven)"],
        "notes": "Read-heavy; backed by materialised membership views. OneRoster `users`/`orgs` map here. COPPA: age stored as a coarse band (not DOB); under-13 data handling is gated on verifiable parental consent (see docs/compliance/coppa-data-flows.md). Guardian links are read-only and consent-gated: `/guardians/authorize` re-derives the consent decision live, so a consent revoke denies access immediately (no separate guardian write path).",
    },
    {
        "name": "enrollment", "port": 4004, "data": "Postgres",
        "resp": "Enrollments and section roles with full lifecycle (active/completed/dropped) per OneRoster enrollments; drives the enroll+billing saga.",
        "tables": ["enrollment", "self_registration_policy", "self_registration_request"],
        "endpoints": [
            ("POST", "/enrollments", "Enroll a user in a section with a role (starts saga)."),
            ("DELETE", "/enrollments/{id}", "Drop/withdraw (lifecycle transition)."),
            ("GET", "/sections/{id}/roster", "Active roster for a section."),
            ("PUT", "/sections/{id}/registration-policy", "Set self-registration: open, approval, capacity."),
            ("POST", "/sections/{id}/self-register", "Learner self-enroll (immediate, or pending approval/wait-list)."),
            ("GET", "/sections/{id}/registration-requests", "List self-registration requests (filter by status)."),
            ("POST", "/registration-requests/{id}/decide", "Approve (enrolls if seats remain) or deny a request."),
        ],
        "publishes": ["enrollment.created", "enrollment.dropped", "enrollment.completed"],
        "consumes": ["sis.enrollment.upserted", "billing.seat.reserved", "billing.seat.rejected"],
        "deps": ["course (section validity)", "billing (seat reservation)", "user-org (user validity)"],
        "notes": "Owns the enroll->reserve-seat->confirm saga; compensates by withdrawing on seat rejection.",
    },
    {
        "name": "course", "port": 4005, "data": "Postgres",
        "resp": "Courses, course templates, sections, terms, and course copy/import.",
        "tables": ["course", "release_condition"],
        "endpoints": [
            ("POST", "/courses", "Create a course (optionally from template)."),
            ("POST", "/courses/{id}/copy", "Deep-copy course content into a new offering."),
            ("GET", "/courses/{id}", "Course with sections and release conditions."),
            ("POST", "/courses/{id}/release-conditions", "Define gated-release rules."),
        ],
        "publishes": ["course.created", "course.published", "course.copied"],
        "consumes": ["sis.class.upserted", "term.created"],
        "deps": ["content (module tree)", "user-org (org placement)"],
        "notes": "Release conditions are evaluated by content/assessment at access time.",
    },
    {
        "name": "content", "port": 4006, "data": "JSONB + Blob",
        "resp": "Course content tree (modules/lessons/topics), completion tracking, SCORM/xAPI packages, H5P-style interactive content, and authored rich pages (WYSIWYG) with versioned drafts.",
        "tables": ["content_module", "content_topic", "content_completion", "page", "page_version", "release_condition", "scorm_package", "scorm_attempt", "xapi_statement"],
        "endpoints": [
            ("POST", "/uploads", "Signed direct-to-Blob upload URL (type/size validated, tenant-namespaced key)."),
            ("POST", "/courses/{courseId}/modules", "Create a module."),
            ("GET", "/courses/{courseId}/modules", "Ordered modules for a course."),
            ("GET", "/modules/{id}", "Module with its ordered topics."),
            ("POST", "/modules/{id}/topics", "Add a topic (html/file/link/scorm/lti/video)."),
            ("POST", "/courses/{courseId}/release-conditions", "Availability/prerequisite rule (boolean tree)."),
            ("POST", "/courses/{courseId}/pages", "Author a rich page (creates the page as a draft + version #1; slug derived from title if omitted)."),
            ("GET", "/courses/{courseId}/pages", "List a course's pages (summaries, no body)."),
            ("GET", "/pages/{id}", "Page + its current version (latest draft, else published)."),
            ("PATCH", "/pages/{id}", "Update title/slug; a new body inserts a NEW draft version (never mutates a prior version)."),
            ("POST", "/pages/{id}/publish", "Promote a draft version to published (default target = latest draft); sets the page's published pointer."),
            ("GET", "/pages/{id}/versions", "Version history, newest-first (no body)."),
            ("GET", "/pages/{id}/versions/{versionId}", "One full version including its body (read-only view)."),
            ("POST", "/scorm/packages", "Import a SCORM 1.2/2004 package: parse the supplied imsmanifest.xml (org title, launch href, mastery score) and store a launchable package. 400 `invalid_manifest`/`no_launchable_resource`/`unsafe_href`; 201 `{package}`."),
            ("GET", "/scorm/packages/{id}", "Launch info for a package (version, title, launchHref, masteryScore, blobUrl, topicId, manifest); 404 if not found."),
            ("PUT", "/scorm/packages/{id}/runtime", "Record a learner attempt: normalize raw cmi (SCORM 1.2 lesson_status or 2004 completion/success/score) and upsert one attempt per (tenant, package, learner). On a terminal/passing state emits a `learning.event_captured` outbox row (source:\"scorm\"). 404 if the package is unknown; 200 `{attempt}`."),
            ("GET", "/scorm/packages/{id}/runtime?learnerId=", "Read back a learner's current attempt for a package (RLS-scoped); 404 if the package is unknown, else 200 `{attempt|null}`."),
        ],
        "publishes": ["learning.event_captured"],
        "consumes": ["course.copied (clone module tree)"],
        "deps": ["Vercel Blob (package/media storage)", "analytics (xAPI forward)"],
        "notes": "Modules/topics ordered by position; availability/prerequisites modelled via release_condition. Large binaries upload direct-to-Blob via signed URLs (tenant-namespaced keys). Rich pages (#32) are authored in-platform via an accessible WYSIWYG editor: `page` holds identity + the published-version pointer, while immutable append-only `page_version` rows carry the sanitized rich-HTML `body` (versioned drafts). Editing with a new body always inserts the next version rather than mutating an existing one; publishing promotes a chosen draft. Embedded media/files reuse the existing signed `POST /uploads` flow with the blob URL referenced inline in the page HTML (no separate media join). SCORM import + completion tracking ship now (#31): `POST /scorm/packages` parses the supplied imsmanifest.xml (the .zip uploads via the signed `POST /uploads` flow and its blob URL is stored) into a launchable `scorm_package` (title/launch_href/mastery_score denormalized; full parsed manifest kept in `manifest` jsonb); the runtime endpoints upsert one `scorm_attempt` per (tenant, package, learner) — raw cmi (SCORM 1.2 `cmi.core.lesson_status` or 2004 `cmi.completion_status`/`success_status`/`score`) is normalized server-side. Manifest parsing fails closed against XXE/billion-laughs (entities off, `<!DOCTYPE`/`<!ENTITY` rejected, 1 MB cap) and rejects unsafe (absolute/traversal/backslash) launch hrefs. Completion is surfaced to the gradebook by emitting a `learning.event_captured` outbox row (source:\"scorm\", with the `passed` flag) in the SAME transaction as the attempt upsert; the analytics/LRS path consumes it today. Documented follow-ups: server-side unzip + byte-serving of the SCORM runtime assets (parser takes manifest XML only; launch href is rendered, not yet served), the full SCORM JS RTE bridge (`window.API` / `API_1484_11`), a dedicated `scorm.attempt_recorded` event verb + a grading-side consumer that writes a `grade` (needs `'scorm'` in `GradeItemSource`), and a service-side authenticated-user header so `learnerId` is resolved at the service rather than trusted from the BFF-supplied body. xAPI ingestion, draft/published state, virus scanning, per-plan size limits, and page-version retention/restore remain tracked follow-ups.",
    },
    {
        "name": "assignment", "port": 4007, "data": "Postgres + Blob",
        "resp": "Assignments, submissions, late/penalty policy, plagiarism integration hooks, file handling.",
        "tables": ["assignment", "submission", "submission_annotation", "assignment_group", "assignment_group_member"],
        "endpoints": [
            ("POST", "/assignments", "Create assignment with due/late policy."),
            ("POST", "/assignments/{id}/submissions", "Submit (file -> Blob, emits submission.created)."),
            ("GET", "/assignments/{id}/submissions", "List submissions for grading."),
            ("POST", "/submissions/{id}/annotations", "Add inline feedback (anchored comment)."),
            ("GET", "/submissions/{id}/annotations", "List annotations (released=true for the learner view)."),
            ("POST", "/submissions/{id}/feedback/release", "Release feedback -> learner notified (submission.feedback_released)."),
            ("POST", "/assignments/{id}/groups", "Create a group; manage membership (one group per learner)."),
            ("GET", "/assignments/{id}/groups/for-user/{userId}", "Resolve a learner's group for group submission."),
        ],
        "publishes": ["assignment.created", "submission.created", "submission.late", "submission.feedback_released"],
        "consumes": ["grading.graded (reflect status)", "plagiarism.report.ready"],
        "deps": ["Vercel Blob (uploads)", "grading (gradebook line item)", "rubric (attached rubric)"],
        "notes": "Submissions stored in Blob; metadata in Postgres. Plagiarism is an async hook.",
    },
    {
        "name": "assessment", "port": 4008, "data": "JSONB (write-heavy)",
        "resp": "Quizzes, question banks (QTI), sectioned exams, timed attempts, auto-grading.",
        "tables": ["question_library", "question", "quiz", "quiz_section", "quiz_question", "quiz_attempt", "quiz_response"],
        "endpoints": [
            ("POST", "/quizzes", "Author a quiz from banks/sections."),
            ("POST", "/quizzes/{id}/attempts", "Start a timed attempt."),
            ("POST", "/attempts/{id}/submit", "Submit responses, auto-grade objective items."),
            ("GET", "/question-libraries/{id}/questions", "Browse/import bank items."),
        ],
        "publishes": ["quiz.attempt.started", "quiz.attempt.submitted", "quiz.graded"],
        "consumes": ["course.copied (clone quizzes)"],
        "deps": ["grading (push scores)", "rubric (manual-grade rubrics)"],
        "notes": "Write-heavy attempt path; JSONB for flexible item types. Objective grading is synchronous; subjective routes to grading.",
    },
    {
        "name": "grading", "port": 4009, "data": "Postgres",
        "resp": "Gradebook: categories, line items, grade schemes, calculated and final grades (OneRoster results + LTI AGS).",
        "tables": ["grade_scheme", "grade_category", "grade_item", "grade"],
        "endpoints": [
            ("GET", "/courses/{id}/gradebook", "Full gradebook matrix."),
            ("PUT", "/grade-items/{id}/grades/{userId}", "Enter/override a grade."),
            ("POST", "/courses/{id}/final-grades/calculate", "Recalculate final grades."),
            ("GET", "/lti/ags/lineitems", "AGS line items for LTI tools."),
        ],
        "publishes": ["grading.graded", "grading.final.calculated"],
        "consumes": ["submission.created", "quiz.graded", "assignment.created (create line item)"],
        "deps": ["assessment", "assignment", "lti (AGS exposure)", "sis (results export)"],
        "notes": "Source of truth for grades; exposes LTI AGS and OneRoster results.",
    },
    {
        "name": "discussion", "port": 4010, "data": "JSONB",
        "resp": "Forums, topics/threads, posts and replies, subscriptions and read state.",
        "tables": ["discussion_forum", "discussion_topic", "discussion_post"],
        "endpoints": [
            ("POST", "/forums", "Create a forum (course/org scoped)."),
            ("POST", "/topics/{id}/posts", "Reply in a thread (emits discussion.post.created)."),
            ("POST", "/topics/{id}/subscribe", "Subscribe for notifications."),
        ],
        "publishes": ["discussion.post.created", "discussion.topic.created"],
        "consumes": ["course.created (default forum)"],
        "deps": ["notification (subscriber fanout)", "ai (moderation/summary, optional)"],
        "notes": "Threaded posts in JSONB; notification fanout on new posts to subscribers.",
    },
    {
        "name": "announcement", "port": 4011, "data": "Postgres",
        "resp": "Course/org announcements with scheduled publish and notification fanout.",
        "tables": ["announcement"],
        "endpoints": [
            ("POST", "/announcements", "Create/schedule an announcement."),
            ("GET", "/courses/{id}/announcements", "List visible announcements."),
        ],
        "publishes": ["announcement.published"],
        "consumes": [],
        "deps": ["notification (fanout)", "calendar (optional event)"],
        "notes": "Scheduled publishing via QStash schedule; fanout handled by notification.",
    },
    {
        "name": "notification", "port": 4012, "data": "Postgres + Redis",
        "resp": "Multi-channel delivery (email/SMS/push/in-app), per-user preferences, unread counters, intelligent-agent automation.",
        "tables": ["notification", "notification_preference", "intelligent_agent"],
        "endpoints": [
            ("GET", "/users/{id}/notifications", "In-app inbox + unread count."),
            ("PUT", "/users/{id}/preferences", "Update channel preferences."),
            ("POST", "/agents", "Define an intelligent agent (condition -> action)."),
        ],
        "publishes": ["notification.sent", "notification.failed"],
        "consumes": ["announcement.published", "discussion.post.created", "grading.graded", "assignment.created", "enrollment.created", "grade.released"],
        "deps": ["Email/SMS/Push providers", "Upstash Redis (unread counters)", "analytics (agent triggers)", "relay (event delivery via POST /events)"],
        "notes": "Central fanout consumer; respects per-user preferences and quiet hours. Intelligent agents evaluate analytics signals. First real event consumer wired to the `relay` (`POST /events`): `enrollment.created` and `grade.released` flow end-to-end, deduped exactly-once via `event_inbox` keyed on `(consumer, message_id)`.",
    },
    {
        "name": "calendar", "port": 4013, "data": "Postgres",
        "resp": "Calendar events, deadlines, iCal feeds, and timetable/class scheduling (bell schedules, periods, section-period-room-teacher assignments).",
        "tables": ["calendar_event", "bell_schedule", "schedule_period", "timetable_entry"],
        "endpoints": [
            ("POST", "/calendar/events", "Create a manual event/deadline."),
            ("PUT", "/calendar/events/source", "Idempotently upsert an assignment/quiz due-date event (aggregation)."),
            ("GET", "/calendar/events", "List events (filter by orgUnitId + from/to time range)."),
            ("GET", "/calendar/feed.ics", "Timezone-correct (UTC) iCal subscription feed."),
            ("POST", "/schedules", "Create a bell schedule with named periods/times."),
            ("POST", "/timetable", "Assign a section to a period, room and instructor; detects conflicts."),
            ("GET", "/users/{id}/timetable", "Personal recurring weekly timetable."),
        ],
        "publishes": ["timetable.entry.scheduled"],
        "consumes": ["assignment.created (due-date sync)", "quiz.attempt.started"],
        "deps": ["notification (reminders)", "user-org (sections/instructors)"],
        "notes": "Aggregates deadlines and timetable meetings into a unified calendar/iCal feed. Room/teacher/period conflicts are validated on write.",
    },
    {
        "name": "rubric", "port": 4014, "data": "Postgres",
        "resp": "Rubrics, competencies, learning objectives/outcomes, objective alignment and mastery (LTI Rubric Service).",
        "tables": ["rubric", "rubric_criterion", "rubric_level", "competency", "learning_objective", "objective_alignment"],
        "endpoints": [
            ("POST", "/rubrics", "Author a rubric (criteria x levels; analytic/holistic)."),
            ("GET", "/rubrics", "List rubrics (filter by courseId)."),
            ("GET", "/rubrics/{id}", "Fetch a rubric with its full grid."),
            ("POST", "/rubrics/{id}/criteria", "Append a criterion (+ levels)."),
            ("POST", "/rubrics/{id}/score", "Tally picked levels -> total/max (maps to a grade item)."),
            ("DELETE", "/rubrics/{id}", "Delete a rubric."),
            ("POST", "/competencies", "Define a competency/outcome (hierarchical)."),
            ("GET", "/competencies", "List competencies."),
            ("POST", "/objectives", "Define a learning objective."),
            ("POST", "/objectives/{id}/alignments", "Align an objective to an activity."),
            ("GET", "/activities/{targetType}/{targetId}/objectives", "Objectives aligned to an activity."),
        ],
        "publishes": [],
        "consumes": [],
        "deps": ["grading (consumes rubric scores)", "analytics (mastery signals)"],
        "notes": "Rubric scoring is a pure tally the grading service maps onto a line item. Per-learner mastery roll-up (needs grade data) and rubric<->activity attachment (needs a join table) are tracked follow-ups.",
    },
    {
        "name": "analytics", "port": 4015, "data": "Postgres",
        "resp": "Learning Record Store (Caliper/xAPI), engagement metrics, at-risk/predictive read models (event-sourced).",
        "tables": ["caliper_event", "engagement_summary", "xapi_statement"],
        "endpoints": [
            ("POST", "/analytics/events", "Ingest a Caliper event to the LRS (+ transactional outbox row)."),
            ("POST", "/analytics/xapi", "Ingest an xAPI statement to the LRS."),
            ("GET", "/analytics/events", "List captured events (filter by type/action/time)."),
            ("GET", "/analytics/aggregate", "De-identified aggregate counts (safe to pool cross-tenant)."),
            ("GET", "/courses/{id}/engagement", "Engagement summary read model."),
            ("GET", "/courses/{id}/at-risk", "At-risk learner predictions."),
        ],
        "publishes": ["learning.event_captured", "analytics.atrisk.flagged", "engagement.summary.updated"],
        "consumes": ["content.viewed", "content.completed", "quiz.attempt.submitted", "discussion.post.created", "submission.created"],
        "deps": ["notification (at-risk alerts -> intelligent agents)", "reporting (feeds exports)"],
        "notes": "Event-sourced; builds materialised read models. Pure consumer of domain events; emits derived signals. `GET /reports/engagement` layers defence-in-depth course authorization ON TOP of tenant RLS (#284, refined #294): an instructor who teaches the course, a tenant-wide `super_admin`, or an `org_admin` whose administered org-unit subtree (`org_unit.path` + `role_assignment.cascade`) contains the course's org unit may read it; a missing trusted caller -> 401, an unauthorized caller -> 403. See [ADR-0027](../ADR-0027-trusted-identity-headers.md).",
    },
    {
        "name": "reporting", "port": 4016, "data": "Postgres + JSONB",
        "resp": "Tenant-scoped reporting bounded context: a catalogue of built-in report definitions and persisted report runs computed synchronously from existing LMS data via an injectable ReportRunner. Tenant-isolated by Postgres RLS.",
        "tables": ["report_definition", "report_run"],
        "endpoints": [
            ("GET", "/definitions", "List the caller-tenant's built-in report definitions (seeded lazily/idempotently per tenant). 400 `tenant_required` if no x-tenant-id."),
            ("POST", "/runs", "Create + execute a run for `{definitionKey, params?}` synchronously via the injected ReportRunner; persists the outcome and returns `{run}`. Unknown/blank key -> 400 (no run persisted); runner success -> 201 status='succeeded' with result+row_count; runner failure -> 200 status='failed' with error. requested_by from x-user-id."),
            ("GET", "/runs", "List the caller-tenant's runs newest-first (RLS-scoped)."),
            ("GET", "/runs/{id}", "Read one run incl. its `result` jsonb; 404 `not_found` if unknown (or owned by another tenant)."),
            ("GET", "/health", "Liveness/readiness."),
        ],
        "publishes": [],
        "consumes": [],
        "deps": ["enrollment (enrollment table, direct RLS-scoped read)", "course (course table, direct RLS-scoped read)"],
        "notes": "Owns `report_definition` (per-tenant catalogue of built-in reports, UNIQUE (tenant_id, key), seeded idempotently via `INSERT ... ON CONFLICT (tenant_id, key) DO NOTHING`) and `report_run` (one persisted execution: status queued|running|succeeded|failed, params/result jsonb, row_count, error, created_at/completed_at). Two built-in reports compute under the SAME RLS `withTenant` GUC scope over existing tenant-scoped tables: `enrollment-summary` (`enrollment` GROUP BY status -> `{total, byStatus:[{status,count}]}`) and `course-completion-summary` (`course LEFT JOIN enrollment` -> `{courses:[{courseId,title,enrolled,completed}]}`). Heavy work sits behind an injectable `ReportRunner` seam (mirroring ADR-0028/0029): default `DbReportRunner` reads real tables under `withTenant`; a deterministic `FakeReportRunner` lets the full suite run offline (memory store, no DB/network). Per-tenant isolation: both tables are under FORCE RLS (`tenant_isolation`) and EVERY store method + the DbReportRunner aggregations run inside `withTenant` -- tenant_id is stamped from ctx, never client-supplied; `requested_by` is sourced only from x-user-id (ADR-0027). HTTP request/response only -- no outbox/inbox events wired yet. Cron/scheduling and external delivery (email/CSV-to-blob) are deliberate follow-ups; the course-completion join granularity is tracked as a non-blocking correctness follow-up (#323). See [ADR-0030](../ADR-0030-reporting-service.md).",
    },
    {
        "name": "ai", "port": 4017, "data": "pgvector + JSONB",
        "resp": "AI study assistant: embeds a course's content into pgvector and answers student questions via Groq RAG with citations, grounded ONLY in retrieved chunks; also drafts quiz questions for teacher review. Tenant-isolated by Postgres RLS.",
        "tables": ["ai_embedding", "ai_chat", "ai_message", "ai_usage"],
        "endpoints": [
            ("POST", "/courses/{courseId}/reindex", "(Re)build the course's embedding index -- idempotent delete-then-insert over content_topic.body chunks."),
            ("POST", "/courses/{courseId}/chat", "Ask a question: embed -> top-k (k=5) cosine retrieval (RLS-scoped) -> Groq grounded answer with citations; persists the chat + user/assistant messages. Retrieved context + question are wrapped in labeled untrusted-data delimiters and the system prompt refuses embedded instructions (prompt-injection hardening); over-long messages are rejected 400 invalid_request before any model call. Cost-bounded (#309): a per-user then per-tenant fixed-window rate limit returns 429 `rate_limited` (with Retry-After / RateLimit-* headers) on breach, and a durable per-tenant per-UTC-day usage ceiling (`ai_usage`) returns 429 `cost_exceeded` before any embed/retrieval/Groq call once the request or token-estimate ceiling is reached. Requires x-user-id."),
            ("POST", "/courses/{courseId}/question-drafts", "Generate transient quiz-question drafts (multiple_choice/true_false/short_answer) for teacher review -- LLM-authored, zod-validated per kind, each 1:1 with assessment's NewQuestionInput; nothing persisted, no events. Requires x-user-id."),
            ("GET", "/courses/{courseId}/chats", "List the caller's chats for a course (x-user-id owned)."),
            ("GET", "/chats/{chatId}/messages", "List messages for one of the caller's chats (ownership-checked)."),
        ],
        "publishes": [],
        "consumes": [],
        "deps": ["Groq (LLM, GROQ_API_KEY, optional; GROQ_MAX_TOKENS caps /chat output, default 1024)", "pgvector", "content (content_topic.body, direct RLS-scoped read)"],
        "notes": "Retrieval grounded in tenant-scoped embeddings; never crosses tenant boundary (FORCE RLS on ai_embedding/ai_chat/ai_message; every store method runs inside withTenant). Embeddings come from an injectable Embedder (default: deterministic 1024-dim HashingEmbedder -- Groq serves no embeddings API); the chat answer from an injectable ChatModel (Groq when GROQ_API_KEY is set, else a deterministic offline fake) so the service boots and tests run key-free/offline. Reads content_topic.body directly via @lms/db withTenant rather than calling the content service. Caller identity via x-user-id (ADR-0027). Quiz-question draft generation (POST /courses/{courseId}/question-drafts) reuses the same injectable ChatModel seam: pure buildQuestionGenMessages + total parseQuestionDrafts (per-kind zod validation, drop-invalid, clamp to count) return drafts that are 1:1 with assessment's NewQuestionInput, so the client/BFF maps approved drafts to assessment's existing POST /question-libraries/{id}/questions -- the ai service makes NO server-side call to assessment, holds NO draft state (transient, no table/RLS), and emits no events. HTTP request/response only -- no outbox/inbox events wired yet. /chat is hardened against prompt injection: the system instruction treats retrieved COURSE CONTEXT + the STUDENT QUESTION as untrusted DATA wrapped in labeled fenced delimiters and refuses any embedded directives; the user message is length-capped (over-long -> 400 invalid_request with no downstream model/embedder call), each retrieved chunk is truncated when rendered to bound prompt size, and the Groq completion is bounded by a max output-token cap (GROQ_MAX_TOKENS, default 1024). RLS remains the data-isolation guarantee; the prompt hardening is best-effort cost/robustness defense-in-depth. Cost controls (#309): `/chat` enforces a per-user (`AI_CHAT_USER_RATE_LIMIT_MAX`, default 30) then per-tenant (`AI_CHAT_RATE_LIMIT_MAX`, default 120) fixed-window rate limit over `AI_CHAT_RATE_LIMIT_WINDOW_SECONDS` (default 60) via the shared `@lms/ratelimit` package (in-process MemoryRateLimiter fallback, Upstash-optional via the existing UPSTASH_* env) -> 429 `rate_limited`; and a durable per-tenant per-UTC-day usage ceiling tracked in the tenant-scoped, RLS-isolated `ai_usage` table (request count + worst-case token estimate, upserted only on a successful completion) -> 429 `cost_exceeded` checked BEFORE any embed/retrieval/Groq spend, bounded by `AI_CHAT_DAILY_TENANT_REQUEST_CEILING` (default 2000) and `AI_CHAT_DAILY_TENANT_TOKEN_CEILING` (default 0 = token ceiling disabled, request ceiling still applies). See [ADR-0028](../ADR-0028-ai-rag-study-assistant.md) and [ADR-0033](../ADR-0033-ai-quiz-question-generation.md).",
    },
    {
        "name": "lti", "port": 4018, "data": "Postgres",
        "resp": "LTI 1.3 Tool: OIDC third-party-initiated login and Resource Link launch — validate a platform-signed id_token and mint an LMS session — plus tenant-scoped platform registration. Also serves signed, short-lived embeddable course/widget iframes for school portals. AGS, NRPS, Deep Linking 2.0, and Dynamic Registration are roadmap (not yet implemented).",
        "tables": ["lti_registration", "lti_deployment", "lti_launch_session"],
        "endpoints": [
            ("GET|POST", "/lti/login", "OIDC third-party-initiated login: resolve the tenant's platform registration by (iss, client_id), persist a single-use state+nonce launch session, and 302-redirect to the platform's auth endpoint (response_type=id_token, response_mode=form_post, prompt=none)."),
            ("POST", "/lti/launch", "Resource Link launch callback (form_post): atomically consume the state (replay/expiry/unknown -> 401), verify the id_token against the platform JWKS (iss/aud=client_id/exp via injected clock), check nonce/version/message_type and that deployment_id is registered, map LTI roles -> LMS roles, then mint an LMS session in an HttpOnly Secure SameSite=None cookie and 302 to the learner app (token never in the URL)."),
            ("POST", "/lti/registrations", "Register a platform this sub-tenant launches from (tenant-scoped): {issuer, clientId, authLoginUrl, authTokenUrl, jwksUrl, role?}; 201 {registration}, 400 on missing/invalid fields."),
            ("POST", "/embed/tokens", "Mint a signed, short-lived embed token scoped to a tenant + resource + allowed origins."),
            ("GET", "/embed/widget", "Render the embeddable widget; sets frame-ancestors from the signed origins."),
            ("GET", "/health", "Liveness/readiness."),
        ],
        "publishes": [],
        "consumes": [],
        "deps": ["identity (session claims minted via @lms/auth)", "external LTI platform (JWKS endpoint + OIDC auth endpoint)"],
        "notes": "This LMS is the Tool, launched from a school-portal Platform. Flow: the platform initiates OIDC login at `GET|POST /lti/login`; the service finds the tenant-scoped `lti_registration` by `(issuer, client_id)`, writes a single-use `lti_launch_session` (state+nonce, ~10 min TTL), and 302-redirects to the platform auth endpoint. The platform form_posts the signed `id_token` back to `POST /lti/launch`, where the state is consumed by one atomic `UPDATE ... SET consumed_at=now() WHERE consumed_at IS NULL AND expires_at>now() RETURNING` (replay/expiry/unknown -> 401), the token is verified with `jose.jwtVerify` against the platform JWKS (the resolver structurally blocks `alg:none`/symmetric-key confusion) with iss/aud=client_id/exp pinned, nonce/version(1.3.0)/message_type(LtiResourceLinkRequest)/deployment_id checked, and LTI role URNs mapped to `StandardRole`s (highest-privilege wins; `learner` default; `super_admin` NEVER granted from a launch). The minted session is delivered ONLY as an HttpOnly Secure SameSite=None `lms_session` cookie. Tenant comes from the gateway `x-tenant-id`, never the token. `lti_launch_session` is tenant-scoped (own `tenant_id`, in the RLS `tenant_tables[]` loop). No domain events are wired yet. Deferred follow-ups (NOT implemented): Deep Linking 2.0, NRPS roster pull, AGS grade passback, Dynamic Registration. The embed surface (`/embed/*`) is unchanged.",
    },
    {
        "name": "sis", "port": 4019, "data": "Postgres",
        "resp": "OneRoster 1.2 REST roster sync from a school SIS: idempotent ingestion of orgs/users/classes/enrollments, sourcedId <-> internal-id mapping, and full/incremental-delta sync runs with a conflict/error report.",
        "tables": ["sis_sync", "sis_id_map"],
        "endpoints": [
            ("POST", "/sis/sync", "Trigger a OneRoster sync run (full or incremental delta); cron-callable."),
            ("GET", "/sis/sync/{runId}", "Sync run status + conflict/error report."),
            ("GET", "/sis/sync", "List sync runs for the tenant."),
            ("GET", "/sis/id-map", "Resolve external sourcedId <-> internal id (per entity type)."),
        ],
        "publishes": ["sis.user.upserted", "sis.org.upserted", "sis.class.upserted", "sis.enrollment.upserted"],
        "consumes": [],
        "deps": ["user-org (app_user/org_unit upserts)", "course (class upserts)", "enrollment (enrollment upserts)", "external SIS (OneRoster 1.2 REST)"],
        "notes": "OneRoster 1.2 REST ingestion of orgs/users/classes/enrollments in dependency order. Upserts are idempotent, keyed on `sourcedId` via `sis_id_map`; the run writes domain rows (`org_unit`/`app_user`/`course`/`enrollment`) under tenant RLS. Incremental delta uses the last-successful-sync watermark on `sis_sync` (delta with no prior success falls back to full); QStash cron triggers `POST /sis/sync` on a schedule. Per-record conflicts/errors are captured in the report on `sis_sync.stats` and never fail the run — only a transport/auth failure marks a run `failed`. The OneRoster client is an injectable port (HTTP adapter in prod), so the sync engine is fully unit-testable.",
    },
    {
        "name": "video", "port": 4020, "data": "Blob + JSONB",
        "resp": "Lecture-video bounded context: signed direct-to-Blob uploads (tenant-namespaced), an injectable async transcode->caption pipeline that drives the video_asset lifecycle (uploaded->transcoding->ready), and URL-based adaptive playback (renditions + captions served from Blob/CDN, never proxied). Course-scoped streaming: a video associated with a course (video_asset.course_id) is readable/streamable only by enrolled students, course teachers/TAs, or admins. Tenant-isolated by Postgres RLS.",
        "tables": ["video_asset"],
        "endpoints": [
            ("POST", "/uploads", "Sign a tenant-namespaced video upload (key `t/{tenantId}/video/{uuid}/{file}`); validates content-type allow-list (415) + size cap (413). Requires an uploader role. Returns {upload:{key,uploadUrl,blobUrl}}."),
            ("POST", "/videos", "Create a video_asset {title, sourceBlobUrl, courseId?} (owner_id from x-user-id, status='uploaded') and enqueue the transcode->caption pipeline. Optional courseId associates the asset with a course for course-scoped streaming. Requires an uploader role."),
            ("GET", "/videos", "List the tenant's videos, newest first (RLS-scoped). Course-scoped videos (course_id set) are filtered to those the caller may stream -- enrolled student / course teacher-TA / admin; course_id IS NULL videos remain visible to any tenant member."),
            ("GET", "/videos/{id}", "Read one asset -- the playback contract: renditions (HLS ladder URLs) + sourceBlobUrl + captions + status + durationSeconds. For a course-scoped asset (course_id set) access is enrollment/teaching/admin-gated; a caller without access gets 404 (existence-hiding, identical to not-found/cross-tenant). 404 if not found."),
            ("POST", "/videos/{id}/transcode", "(Re)run the pipeline for an asset (idempotent: re-advances uploaded/failed -> transcoding -> ready, rewrites renditions+captions). Owner or admin."),
            ("PATCH", "/videos/{id}/captions", "Manual caption edit: full-replace the captions jsonb with validated tracks (stamped kind:'manual'). Owner or admin; 400 on malformed tracks."),
        ],
        "publishes": [],
        "consumes": [],
        "deps": ["Vercel Blob (signed upload, DevBlobSigner default; production signer is a follow-up)", "FFmpeg worker (container host; real transcoder is a follow-up behind the Transcoder seam)", "ASR provider (real auto-captioner is a follow-up behind the Captioner seam)", "enrollment + course (enrollment/course tables, direct RLS-scoped read for course-scoped streaming authz)"],
        "notes": "Per-tenant isolation: video_asset is under FORCE RLS (tenant_isolation), and every store method runs inside withTenant -- tenant_id is stamped from ctx on INSERT, never client-supplied; blob keys are tenant-namespaced (t/{tenantId}/video/...) as the storage boundary. The heavy work sits behind injectable seams (mirroring ADR-0028): a Transcoder (default deterministic StubTranscoder -> 480p/720p/1080p HLS ladder + hashed duration), a Captioner (default StubCaptioner -> one auto English WebVTT track), and a PipelineRunner (default fire-and-forget InlinePipelineRunner; SyncPipelineRunner for tests) advancing status uploaded->transcoding->ready (or failed) -- so the service boots and tests run offline with no FFmpeg/ASR/network/DB. renditions jsonb = [{quality,url,type:'hls'|'dash'|'mp4'}]; captions jsonb = [{lang,label,url,kind:'auto'|'manual'}]. Playback returns URLs (Blob/CDN streams), never proxies bytes. Write authz via x-user-id/x-user-roles (ADR-0027): uploader role for upload/create, owner-or-admin for transcode/captions. Read authz (#319, ADR-0031): `video_asset.course_id` (nullable FK -> `course.id`, ON DELETE SET NULL, + `ix_video_course`) opts an asset into course-scoped streaming -- read/list/stream of a course-scoped asset is allowed only to an enrolled student, a teacher/TA of that course, or an admin (super_admin/org_admin by role); everyone else is denied with 404 (existence-hiding), and the list omits forbidden course-scoped rows. course_id IS NULL keeps the original any-tenant-member behaviour. The check runs IN-PROCESS under the same `withTenant` RLS connection (no HTTP to enrollment) via an injectable `CourseAccessPolicy` seam (default `DbCourseAccessPolicy`: admin-by-role short-circuit then an `EXISTS` over `enrollment e JOIN course c ON c.org_unit_id = e.org_unit_id WHERE c.id = $1::uuid AND e.user_id = $2::uuid AND e.status IN ('active','completed')`; offline `FakeCourseAccessPolicy` for key-free tests) -- mirroring the analytics `teachesCourse` precedent. RLS is UNCHANGED: course_id is an app-level authz filter, NOT a new RLS axis (video_asset keeps the single tenant_isolation policy). Upload safety = content-type allow-list (mp4/webm/quicktime/mkv) + 5 GB cap + filename sanitization. No outbox/inbox events wired yet. See [ADR-0029](../ADR-0029-video-upload-transcode-pipeline.md), [ADR-0031](../ADR-0031-video-course-scoped-streaming.md).",
    },
    {
        "name": "search", "port": 4021, "data": "Postgres (pg_trgm/vector)",
        "resp": "Global tenant-scoped search read model across content/courses/people: keyword (pg_trgm) now, with a semantic (pgvector) embedding column present for a prod follow-up. Results are filtered by tenant and permission (allowed org units) and ranked.",
        "tables": ["search_document"],
        "endpoints": [
            ("PUT", "/search/documents", "Upsert a tenant-scoped search document (idempotent on entity)."),
            ("DELETE", "/search/documents/{entityType}/{entityId}", "Remove a document from the index."),
            ("GET", "/search", "Keyword (pg_trgm) search filtered by tenant + permission (allowed org units), ranked."),
            ("GET", "/search/typeahead", "Low-latency title typeahead (keyword, tenant + permission scoped)."),
        ],
        "publishes": [],
        "consumes": ["content.created", "course.created", "discussion.post.created", "content.completed"],
        "deps": ["Postgres pg_trgm + pgvector", "content", "course", "discussion"],
        "notes": "Owns the denormalized `search_document` read model only (derived; one row per indexable entity, populated via events/backfill rather than by reading other services' tables). Keyword ranking is pg_trgm `similarity` today; the semantic (pgvector) embedding column is present but the `<=>` merge is a prod follow-up, so ranking degrades gracefully to keyword-only when no embedding is set. Every query is constrained by tenant (RLS on `app.tenant_id`) AND permission: a row is visible when `org_unit_id` is NULL (tenant-global, e.g. the people directory) or in the caller-supplied allowed org units. The allowed set can only narrow, never widen past the tenant boundary.",
    },
    {
        "name": "billing", "port": 4022, "data": "Postgres",
        "resp": "Plans and per-tenant subscriptions (trialing->active->past_due->canceled), seats and seat enforcement, usage metering and invoice generation (incl. district-consolidated invoices across sub-tenants).",
        "tables": ["plan", "subscription", "invoice", "usage_meter"],
        "endpoints": [
            ("GET", "/plans", "List the plan catalog (code, price, billing model, add-ons)."),
            ("POST", "/tenants/{id}/subscription", "Subscribe a tenant to a plan (defaults to trialing)."),
            ("GET", "/tenants/{id}/subscription", "The tenant's current subscription."),
            ("POST", "/tenants/{id}/subscription/transition", "Lifecycle transition (validated state machine)."),
            ("PUT", "/tenants/{id}/subscription/seats", "Set the seat count."),
            ("GET", "/tenants/{id}/subscription/seat-check", "Seat enforcement against an active-user count."),
            ("POST", "/tenants/{id}/usage", "Record a usage meter rollup (metric + quantity over a window)."),
            ("GET", "/tenants/{id}/usage/rollup", "Sum a metric's usage, optionally within [from, to)."),
            ("POST", "/tenants/{id}/invoices", "Generate an invoice from the subscription plan + metered usage."),
            ("GET", "/tenants/{id}/invoices", "List the tenant's invoices."),
            ("GET", "/tenants/{id}/invoices/consolidated", "District-consolidated invoice across the tenant subtree."),
        ],
        "publishes": ["billing.subscription.changed"],
        "consumes": ["enrollment.created (seat reservation, roadmap)", "tenant.activated"],
        "deps": ["tenant (registry)", "payment provider (Stripe, roadmap)"],
        "notes": "plan is the global control-plane catalog; subscription/invoice/usage_meter are tenant-scoped under RLS. Consolidated invoicing is a deliberate control-plane roll-up bounded to tenant_subtree(); add-on enablement and the seat-reservation saga remain follow-ups.",
    },
    {
        "name": "audit", "port": 4023, "data": "Postgres (ledger)",
        "resp": "Tamper-evident hash-chained audit logs, DSAR (data subject access) fulfilment, retention enforcement.",
        "tables": ["audit_log"],
        "endpoints": [
            ("POST", "/audit/events", "Append a tamper-evident audit event (links to the tenant's hash chain)."),
            ("GET", "/audit/events", "List recent entries (filter by actorId, targetType, limit)."),
            ("GET", "/audit/verify", "Re-hash the tenant's chain and report the first break (verification job)."),
        ],
        "publishes": [],
        "consumes": ["* (mutating domain events can be mirrored for audit)"],
        "deps": ["all services (callers append audit events)"],
        "notes": "Per-tenant hash chain over audit_log.prev_hash/row_hash (SHA-256 of prev||row payload). /audit/verify is the tamper-detection job (run on a QStash/cron schedule). DSAR fulfilment and retention enforcement are tracked follow-ups.",
    },
    {
        "name": "mobile-bff", "port": 4024, "data": "stateless",
        "resp": "Backend-for-frontend aggregating domain services for the React Native app (mobile-shaped payloads, fewer round-trips).",
        "tables": [],
        "endpoints": [
            ("GET", "/mobile/home", "Home screen: enrolled courses + due-soon + unread badge in one round-trip."),
            ("GET", "/mobile/courses/{courseId}", "Course detail screen: course + its assignments."),
            ("GET", "/mobile/notifications", "Notifications screen with computed unread count."),
            ("POST", "/mobile/assignments/{assignmentId}/submissions", "Submit work from mobile (forwards to the assignment service)."),
            ("POST", "/mobile/devices", "Register a device push token for notifications."),
        ],
        "publishes": [],
        "consumes": [],
        "deps": ["gateway (auth + proxy)", "course", "calendar", "notification", "assignment", "enrollment", "identity"],
        "notes": "Stateless aggregation behind the same bearer-token model; verifies the token, fans out per screen via the gateway, and registers devices (push delivery is owned by the notification service).",
    },
    {
        "name": "attendance", "port": 4025, "data": "Postgres",
        "resp": "Class attendance and participation: per-tenant attendance codes, attendance sessions (one per section meeting), per-student records, and summaries/exports for compliance and SIS.",
        "tables": ["attendance_code", "attendance_session", "attendance_record"],
        "endpoints": [
            ("POST", "/codes", "Define/seed per-tenant attendance codes and categories."),
            ("POST", "/sessions", "Open an attendance session for a section meeting (roster from enrollment/timetable)."),
            ("PUT", "/sessions/{id}/records", "Mark each student present/absent/tardy/excused; edit until finalized."),
            ("POST", "/sessions/{id}/finalize", "Finalize a session (locks records); emits attendance.flagged per absent/tardy."),
            ("GET", "/sections/{id}/attendance/summary", "Attendance rates and chronic-absence flags."),
            ("GET", "/users/{id}/attendance", "A student's attendance history."),
        ],
        "publishes": ["attendance.marked", "attendance.session.finalized", "attendance.flagged"],
        "consumes": ["enrollment.created", "timetable.entry.scheduled"],
        "deps": ["enrollment (roster)", "calendar (timetable)", "notification (absence alerts)", "reporting (exports)"],
        "notes": "Attendance codes are tenant-owned (per-tenant policy); records are RLS-isolated. Marking emits events for notifications and analytics.",
    },
    {
        "name": "relay", "port": 4026, "data": "Postgres (event_outbox/event_inbox)",
        "resp": "Transactional-outbox relay / event publisher. A long-running worker that drains each tenant's unpublished `event_outbox` rows and publishes the domain events through a transport to consumers. The Fastify app exists only to expose a liveness endpoint and a manual trigger; it is not a request/response domain service.",
        "tables": [],
        "endpoints": [
            ("GET", "/health", "Liveness/readiness (reports tenant mode and uptime)."),
            ("POST", "/relay/run", "Run one drain pass now (ops/manual trigger); the worker also runs this on a timer."),
        ],
        "publishes": ["* (republishes any event_outbox row to consumers)"],
        "consumes": [],
        "deps": ["tenant (control-plane registry — active tenants to drain)", "notification (POST /events consumer)"],
        "notes": "Enumerates active tenants from the control-plane `tenant` registry (read outside RLS), then drains each tenant INSIDE its own `app.tenant_id` GUC transaction via `@lms/db.withTenant`. `event_outbox` is under FORCE ROW LEVEL SECURITY and the app connects as a NOBYPASSRLS role, so the relay can never read the outbox cross-tenant. Oldest-first delivery preserves causal order; only delivered rows are stamped `published_at` (re-guarded `IS NULL` so a concurrent relay can't double-stamp). Transport is abstracted (`@lms/events` EventTransport seam): in-process / HTTP by default, a hosted QStash/Upstash transport is a future seam (not implemented; no secrets hard-coded). Today notification is the only wired consumer (`enrollment.created`, `grade.released`); analytics is not yet wired.",
    },
]

CROSS_TABLES = ["event_outbox", "event_inbox", "idempotency_key"]


def md_table(rows, headers):
    def esc(c):
        return c.replace("|", "\\|")
    out = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    for r in rows:
        out.append("| " + " | ".join(esc(c) for c in r) + " |")
    return "\n".join(out)


def render(s):
    lines = []
    lines.append(f"# {s['name']} service\n")
    lines.append(f"- **Port (dev):** {s['port']}")
    lines.append(f"- **Data shape:** {s['data']}")
    lines.append(f"- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres\n")
    lines.append("## Responsibility\n")
    lines.append(s["resp"] + "\n")

    lines.append("## Owned tables\n")
    if s["tables"]:
        lines.append(", ".join(f"`{t}`" for t in s["tables"]) + "\n")
    else:
        lines.append("_None_ (stateless or operates on derived/index data only).\n")

    lines.append("## Key endpoints\n")
    lines.append(md_table([[f"`{m}`", f"`{p}`", d] for m, p, d in s["endpoints"]],
                          ["Method", "Path", "Description"]) + "\n")

    lines.append("## Events published\n")
    lines.append(("- " + "\n- ".join(f"`{e}`" for e in s["publishes"])) if s["publishes"] else "_None_")
    lines.append("")
    lines.append("## Events consumed\n")
    lines.append(("- " + "\n- ".join(f"`{e}`" for e in s["consumes"])) if s["consumes"] else "_None_")
    lines.append("")

    lines.append("## Dependencies\n")
    lines.append("- " + "\n- ".join(s["deps"]))
    lines.append("")

    lines.append("## Notes\n")
    lines.append(s["notes"] + "\n")

    lines.append("## Cross-cutting\n")
    lines.append("Writes a transactional **outbox** row (`event_outbox`) in the same DB "
                 "transaction as each state change; consumes via **inbox** (`event_inbox`) "
                 "with `idempotency_key` dedupe. All tenant-scoped tables are protected by "
                 "Postgres RLS keyed on `app.tenant_id`.\n")
    return "\n".join(lines)


def render_index():
    rows = []
    for s in SERVICES:
        owned = ", ".join(f"`{t}`" for t in s["tables"]) if s["tables"] else "-"
        rows.append([f"[{s['name']}]({s['name']}.md)", str(s["port"]), s["data"], owned])
    body = []
    body.append("# Service design specs\n")
    body.append("Per-service design specs for the LMS decomposition. Each page "
                "documents responsibility, owned tables, key endpoints, published/consumed "
                "events, and dependencies. Generated by `scripts/docs/gen-service-specs.py` "
                "(edit the script, not the output).\n")
    body.append("See also: [ARCHITECTURE.md](../ARCHITECTURE.md), "
                "[MULTI_TENANCY.md](../MULTI_TENANCY.md), [STANDARDS.md](../STANDARDS.md).\n")
    body.append("## Catalogue\n")
    body.append(md_table(rows, ["Service", "Port", "Data shape", "Owned tables"]) + "\n")

    pub = {}
    con = {}
    for s in SERVICES:
        for e in s["publishes"]:
            pub.setdefault(e, []).append(s["name"])
        for e in s["consumes"]:
            con.setdefault(e, []).append(s["name"])
    all_events = sorted(set(pub) | set(con))
    erows = []
    for e in all_events:
        erows.append([f"`{e}`", ", ".join(pub.get(e, [])) or "-", ", ".join(con.get(e, [])) or "-"])
    body.append("## Event catalogue\n")
    body.append("Domain events flow producer -> `event_outbox` -> `relay` (drains per-tenant "
                "inside the RLS GUC) -> transport -> consumer, deduped exactly-once via "
                "`event_inbox` keyed on `(consumer, message_id)`. The transport is in-process / "
                "HTTP by default (a hosted QStash transport is a future seam). Today `notification` "
                "is the only wired consumer (`enrollment.created`, `grade.released`).\n")
    body.append(md_table(erows, ["Event", "Published by", "Consumed by"]) + "\n")

    body.append("## Dependency map (service -> service)\n")
    svc_names = {s["name"] for s in SERVICES}
    drows = []
    for s in SERVICES:
        internal = [d.split(" ")[0] for d in s["deps"]]
        internal = sorted({d for d in internal if d in svc_names and d != s["name"]})
        drows.append([s["name"], ", ".join(internal) or "-"])
    body.append(md_table(drows, ["Service", "Depends on (internal)"]) + "\n")

    body.append("## Cross-cutting tables\n")
    body.append("Shared platform tables present in every service boundary: "
                + ", ".join(f"`{t}`" for t in CROSS_TABLES) + ".\n")
    return "\n".join(body)


def main():
    os.makedirs(OUT, exist_ok=True)
    for s in SERVICES:
        path = os.path.join(OUT, f"{s['name']}.md")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(render(s))
    with open(os.path.join(OUT, "README.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(render_index())
    print(f"Wrote {len(SERVICES)} specs + index to {OUT}")


if __name__ == "__main__":
    main()
