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
        "notes": "Stateless; horizontally scalable. Adds `X-Tenant-Id` and trace headers downstream.",
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
            ("GET", "/authz/check", "Evaluate permission for (subject, action, resource) via role_assignment."),
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
        "notes": "RBAC is tenant-scoped (RLS). LTI 1.3 login handshakes are delegated to the `lti` service which calls back here for claims.",
    },
    {
        "name": "tenant", "port": 4002, "data": "control-plane DB",
        "resp": "Tenant catalogue and lifecycle: provisioning saga, pool/silo routing, sub-tenant hierarchy (district -> school), feature flags, plan binding.",
        "tables": ["tenant", "plan", "subscription", "tenant_setting", "tenant_branding"],
        "endpoints": [
            ("POST", "/tenants", "Provision a tenant or sub-tenant (kind=standalone|parent|sub)."),
            ("GET", "/tenants/{id}/routing", "Resolve pool vs silo + database_ref for connection routing."),
            ("GET", "/tenants/{id}/subtree", "District roll-up: tenant_subtree() ids for parent reporting/billing."),
            ("PATCH", "/tenants/{id}/flags", "Toggle feature flags / add-on entitlements."),
            ("PUT", "/tenants/{id}/branding", "Set white-label branding (logo, colours, theme, custom domain)."),
            ("GET", "/tenants/{id}/branding", "Resolve effective branding (with parent inheritance)."),
            ("PUT", "/tenants/{id}/settings/{key}", "Set a per-tenant governance setting (validated against the key catalog)."),
            ("GET", "/tenants/{id}/settings", "Effective governance settings (catalog defaults + overrides)."),
            ("GET", "/tenants/{id}/settings/{key}", "Effective value for one setting key."),
            ("GET", "/settings/catalog", "The catalog of known governance keys, types and defaults."),
        ],
        "publishes": ["tenant.provisioning.started", "tenant.activated", "tenant.suspended", "tenant.subtenant.linked", "tenant.branding.updated"],
        "consumes": ["billing.subscription.changed (entitlements)"],
        "deps": ["Neon API (silo branch/project create)", "secret store (database_ref -> DSN)", "billing"],
        "notes": "Control-plane; `tenant` is NOT in the RLS tenant_tables loop. Provisioning is a saga with compensation (delete branch on failure).",
    },
    {
        "name": "user-org", "port": 4003, "data": "Postgres (read-heavy)",
        "resp": "User profiles and the org-unit hierarchy (district/school/department/section) per OneRoster orgs/users; academic sessions.",
        "tables": ["app_user", "org_unit", "academic_session"],
        "endpoints": [
            ("POST", "/org-units", "Create org unit under a parent (maintains materialised path; emits orgunit.created)."),
            ("GET", "/org-units", "List org units (filter by parentId, type)."),
            ("GET", "/org-units/{id}", "Fetch a single org unit."),
            ("GET", "/org-units/{id}/subtree", "Descendants via the path GIN index."),
            ("GET", "/org-units/{id}/ancestors", "Ancestors, root-first."),
            ("PATCH", "/org-units/{id}", "Rename / set active state."),
            ("POST", "/users", "Invite/create a user (emits user.created)."),
            ("GET", "/users", "List users (filter by status, orgUnitId)."),
            ("GET", "/users/{id}", "Profile + org-unit role memberships."),
            ("PATCH", "/users/{id}", "Update profile/status (emits user.updated/deactivated)."),
            ("POST", "/users/{id}/roles", "Assign a per-tenant role at an org unit."),
            ("DELETE", "/users/{id}/roles/{assignmentId}", "Revoke a role assignment."),
        ],
        "publishes": ["user.created", "user.updated", "user.deactivated", "orgunit.created"],
        "consumes": ["sis.user.upserted", "sis.org.upserted"],
        "deps": ["identity (claims)", "sis (rostering source of truth when SIS-driven)"],
        "notes": "Read-heavy; backed by materialised membership views. OneRoster `users`/`orgs` map here.",
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
        "resp": "Course content tree (modules/lessons/topics), completion tracking, SCORM/xAPI packages, H5P-style interactive content.",
        "tables": ["content_module", "content_topic", "content_completion", "release_condition", "scorm_package", "xapi_statement"],
        "endpoints": [
            ("POST", "/uploads", "Signed direct-to-Blob upload URL (type/size validated, tenant-namespaced key)."),
            ("POST", "/courses/{courseId}/modules", "Create a module."),
            ("GET", "/courses/{courseId}/modules", "Ordered modules for a course."),
            ("GET", "/modules/{id}", "Module with its ordered topics."),
            ("POST", "/modules/{id}/topics", "Add a topic (html/file/link/scorm/lti/video)."),
            ("POST", "/courses/{courseId}/release-conditions", "Availability/prerequisite rule (boolean tree)."),
        ],
        "publishes": [],
        "consumes": ["course.copied (clone module tree)"],
        "deps": ["Vercel Blob (package/media storage)", "analytics (xAPI forward)"],
        "notes": "Modules/topics ordered by position; availability/prerequisites modelled via release_condition. Large binaries upload direct-to-Blob via signed URLs (tenant-namespaced keys). Draft/published state, virus scanning, per-plan size limits, SCORM/xAPI ingestion and completion tracking are tracked follow-ups.",
    },
    {
        "name": "assignment", "port": 4007, "data": "Postgres + Blob",
        "resp": "Assignments, submissions, late/penalty policy, plagiarism integration hooks, file handling.",
        "tables": ["assignment", "submission"],
        "endpoints": [
            ("POST", "/assignments", "Create assignment with due/late policy."),
            ("POST", "/assignments/{id}/submissions", "Submit (file -> Blob, emits submission.created)."),
            ("GET", "/assignments/{id}/submissions", "List submissions for grading."),
        ],
        "publishes": ["assignment.created", "submission.created", "submission.late"],
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
            ("POST", "/caliper/events", "Ingest Caliper envelope."),
            ("GET", "/courses/{id}/engagement", "Engagement summary read model."),
            ("GET", "/courses/{id}/at-risk", "At-risk learner predictions."),
        ],
        "publishes": ["analytics.atrisk.flagged", "engagement.summary.updated"],
        "consumes": ["content.viewed", "content.completed", "quiz.attempt.submitted", "discussion.post.created", "submission.created"],
        "deps": ["notification (at-risk alerts -> intelligent agents)", "reporting (feeds exports)"],
        "notes": "Event-sourced; builds materialised read models. Pure consumer of domain events; emits derived signals.",
    },
    {
        "name": "reporting", "port": 4016, "data": "read replicas",
        "resp": "Scheduled and ad-hoc exports (CSV/PDF/OneRoster bulk), compliance and accreditation reports.",
        "tables": [],
        "endpoints": [
            ("POST", "/reports", "Request a report (async job)."),
            ("GET", "/reports/{id}", "Job status + download link (Blob)."),
            ("GET", "/oneroster/bulk", "OneRoster bulk CSV export."),
        ],
        "publishes": ["report.completed"],
        "consumes": ["report.requested"],
        "deps": ["Neon read replica", "Vercel Blob (output)", "all domains (read-only)"],
        "notes": "Reads from replicas to avoid load on write paths; outputs to Blob with signed URLs.",
    },
    {
        "name": "ai", "port": 4017, "data": "pgvector + JSONB",
        "resp": "Lumi-equivalent assistant: content generation, feedback, Q&A via RAG over course content (pgvector + Groq).",
        "tables": ["ai_embedding", "ai_chat", "ai_message"],
        "endpoints": [
            ("POST", "/embeddings/reindex", "(Re)embed content for a course."),
            ("POST", "/chats", "Start a grounded chat session."),
            ("POST", "/chats/{id}/messages", "Ask a question (RAG answer with citations)."),
        ],
        "publishes": ["ai.answer.generated"],
        "consumes": ["content.completed (reindex)", "content.viewed"],
        "deps": ["Groq (LLM, GROQ_API_KEY)", "pgvector", "content (source docs)"],
        "notes": "Retrieval grounded in tenant-scoped embeddings; never crosses tenant boundary (RLS on ai_embedding).",
    },
    {
        "name": "lti", "port": 4018, "data": "Postgres + Redis",
        "resp": "LTI 1.3 Platform + Tool: OIDC login, AGS, NRPS, Deep Linking, Dynamic Registration.",
        "tables": ["lti_registration", "lti_deployment"],
        "endpoints": [
            ("POST", "/lti/login", "OIDC third-party login initiation."),
            ("POST", "/lti/launch", "Validate id_token launch, mint session."),
            ("POST", "/lti/register", "Dynamic Registration of a tool."),
            ("GET", "/lti/nrps/contextmemberships", "Names and Role Provisioning Service."),
        ],
        "publishes": ["lti.tool.launched", "lti.deeplink.created"],
        "consumes": ["grading.graded (AGS score passback)"],
        "deps": ["identity (claims)", "grading (AGS)", "user-org (NRPS roster)", "Upstash Redis (nonce/state)"],
        "notes": "Acts as both Platform (embed external tools) and Tool (be embedded in a school portal/VLE). Key to portal integration.",
    },
    {
        "name": "sis", "port": 4019, "data": "Postgres",
        "resp": "OneRoster 1.2 consumer/provider, sourcedId mapping, delta/rostering sync with school SIS.",
        "tables": ["sis_sync", "sis_id_map"],
        "endpoints": [
            ("POST", "/sync/runs", "Trigger a rostering sync (full/delta)."),
            ("GET", "/oneroster/{resource}", "OneRoster provider endpoints (orgs/users/classes/enrollments)."),
            ("GET", "/id-map", "Resolve external sourcedId <-> internal id."),
        ],
        "publishes": ["sis.user.upserted", "sis.org.upserted", "sis.class.upserted", "sis.enrollment.upserted"],
        "consumes": ["user.updated (provider mode export)"],
        "deps": ["user-org", "course", "enrollment", "external SIS (OneRoster REST/CSV)"],
        "notes": "Bidirectional. Idempotent upserts keyed on sourcedId via sis_id_map; delta sync tracked in sis_sync.",
    },
    {
        "name": "video", "port": 4020, "data": "Blob + JSONB",
        "resp": "Video upload, FFmpeg transcode to HLS/DASH, caption/transcript generation.",
        "tables": ["video_asset"],
        "endpoints": [
            ("POST", "/videos", "Initiate upload (returns Blob upload URL)."),
            ("POST", "/videos/{id}/transcode", "Enqueue FFmpeg transcode job."),
            ("GET", "/videos/{id}/manifest", "HLS/DASH manifest URL once ready."),
        ],
        "publishes": ["video.uploaded", "video.transcoded", "video.captioned"],
        "consumes": ["video.transcode.requested"],
        "deps": ["Vercel Blob", "FFmpeg worker (container host)", "ai (transcription, optional)"],
        "notes": "Transcoding runs on a container worker (not serverless) due to runtime limits; status in JSONB.",
    },
    {
        "name": "search", "port": 4021, "data": "Postgres (FTS/vector)",
        "resp": "Full-text and vector search across content/courses/discussions, per-tenant filtered indexes.",
        "tables": [],
        "endpoints": [
            ("GET", "/search", "Unified query (FTS + vector), tenant-filtered."),
            ("POST", "/index/reindex", "Rebuild index for an entity type."),
        ],
        "publishes": ["search.reindexed"],
        "consumes": ["content.created", "course.created", "discussion.post.created", "content.completed"],
        "deps": ["Postgres FTS + pgvector", "content", "course", "discussion"],
        "notes": "Owns index tables only (derived); every query is constrained by app.tenant_id.",
    },
    {
        "name": "billing", "port": 4022, "data": "Postgres",
        "resp": "Plans and per-tenant subscriptions (trialing->active->past_due->canceled), seats and seat enforcement; invoices/usage metering and the enrollment+billing saga participant are roadmap.",
        "tables": ["plan", "subscription", "invoice", "usage_meter"],
        "endpoints": [
            ("GET", "/plans", "List the plan catalog (code, price, billing model, add-ons)."),
            ("POST", "/tenants/{id}/subscription", "Subscribe a tenant to a plan (defaults to trialing)."),
            ("GET", "/tenants/{id}/subscription", "The tenant's current subscription."),
            ("POST", "/tenants/{id}/subscription/transition", "Lifecycle transition (validated state machine)."),
            ("PUT", "/tenants/{id}/subscription/seats", "Set the seat count."),
            ("GET", "/tenants/{id}/subscription/seat-check", "Seat enforcement against an active-user count."),
        ],
        "publishes": ["billing.subscription.changed"],
        "consumes": ["enrollment.created (seat reservation, roadmap)", "tenant.activated"],
        "deps": ["tenant (registry)", "payment provider (Stripe, roadmap)"],
        "notes": "plan is the global control-plane catalog; subscription is tenant-scoped under RLS. Add-on enablement per subscription, invoices, usage metering and the seat-reservation saga are tracked follow-ups.",
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
            ("GET", "/home", "Aggregated dashboard (courses + deadlines + notifications)."),
            ("GET", "/courses/{id}/overview", "Course bundle tuned for mobile."),
        ],
        "publishes": [],
        "consumes": [],
        "deps": ["course", "calendar", "notification", "grading", "identity"],
        "notes": "Stateless aggregation; holds tokens server-side and keeps the mobile client thin.",
    },
    {
        "name": "attendance", "port": 4025, "data": "Postgres",
        "resp": "Class attendance and participation: per-tenant attendance codes, attendance sessions (one per section meeting), per-student records, and summaries/exports for compliance and SIS.",
        "tables": ["attendance_code", "attendance_session", "attendance_record"],
        "endpoints": [
            ("POST", "/codes", "Define/seed per-tenant attendance codes and categories."),
            ("POST", "/sessions", "Open an attendance session for a section meeting (roster from enrollment/timetable)."),
            ("PUT", "/sessions/{id}/records", "Mark each student present/absent/tardy/excused; edit until finalized."),
            ("POST", "/sessions/{id}/finalize", "Finalize a session (locks records)."),
            ("GET", "/sections/{id}/attendance/summary", "Attendance rates and chronic-absence flags."),
            ("GET", "/users/{id}/attendance", "A student's attendance history."),
        ],
        "publishes": ["attendance.marked", "attendance.session.finalized"],
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
