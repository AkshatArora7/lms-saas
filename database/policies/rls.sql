-- ============================================================================
-- Row-Level Security — POOL tenant isolation
-- ============================================================================
-- Applied to the shared (pool) database. Every tenant-owned table only exposes
-- rows whose tenant_id matches the request-scoped GUC `app.tenant_id`, set by
-- @lms/db.withTenant() inside each transaction.
--
-- Silo databases hold a single tenant, so RLS is optional there — but keeping
-- the same policies makes pool↔silo migration a no-op.
--
-- Run AFTER schema.sql. The application connects as a NON-superuser role
-- (BYPASSRLS must NOT be set) for policies to take effect.
-- ============================================================================

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'org_unit','app_user','identity_provider','user_identity','role',
    'user_credential','refresh_token',
    'role_assignment','course','content_module','content_topic',
    'content_completion','page','page_version',
    'enrollment','question_library','question','quiz',
    'quiz_section','quiz_question','quiz_attempt','quiz_response','assignment',
    'submission','grade_scheme','grade_category','grade_item','grade','rubric',
    'rubric_criterion','rubric_level','competency','learning_objective',
    'objective_alignment','discussion_forum','discussion_topic',
    'discussion_post','lti_registration','lti_deployment','lti_launch_session','sis_sync',
    'scorm_package','scorm_attempt','xapi_statement','release_condition','intelligent_agent',
    'audit_log','event_outbox','event_inbox','idempotency_key','subscription',
    'academic_session','announcement','calendar_event','notification',
    'notification_preference','video_asset','ai_embedding','ai_chat',
    'ai_message','ai_usage','caliper_event','engagement_summary','sis_id_map','invoice',
    'usage_meter','tenant_setting','tenant_branding',
    'bell_schedule','schedule_period','timetable_entry',
    'attendance_code','attendance_session','attendance_record','participation_record',
    'self_registration_policy','self_registration_request',
    'submission_annotation','assignment_group','assignment_group_member',
    'parental_consent','search_document','guardian_relationship',
    'report_definition','report_run'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    -- Drop existing to keep this script idempotent.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);

    -- SELECT/UPDATE/DELETE: only rows for the current tenant.
    -- INSERT: rows must be stamped with the current tenant.
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id());
    $f$, t);
  END LOOP;
END
$$;

-- ----------------------------------------------------------------------------
-- role_permission has no tenant_id of its own (it hangs off role); isolate it
-- via its parent role so a tenant can only see/modify mappings for its own
-- roles. Makes per-tenant permission rules provably isolated end to end.
-- ----------------------------------------------------------------------------
ALTER TABLE role_permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permission FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON role_permission;
CREATE POLICY tenant_isolation ON role_permission
  USING (EXISTS (
    SELECT 1 FROM role r
    WHERE r.id = role_permission.role_id
      AND r.tenant_id = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM role r
    WHERE r.id = role_permission.role_id
      AND r.tenant_id = current_tenant_id()
  ));
