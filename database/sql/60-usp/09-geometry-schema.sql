
    DO $$ DECLARE r text; BEGIN
      FOREACH r IN ARRAY ARRAY['ulpin_usp_find','ulpin_usp_ready','ulpin_usp_pack','ulpin_usp_export','ulpin_usp_display_compiler'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
          EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',r);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r AND
          (rolsuper OR rolcreatedb OR rolcreaterole OR rolcanlogin OR rolreplication OR rolbypassrls OR rolinherit)) THEN
          RAISE EXCEPTION 'Unsafe pre-existing USP reader role: %',r;
        END IF;
        EXECUTE format('GRANT %I TO %I',r,current_user);
      END LOOP;
    END $$;
    CREATE FUNCTION usp_has_illustrative_geometry(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT jsonb_path_exists(value, '$.**.geometryClass ? (@ == "illustrative")')
        OR jsonb_path_exists(value, '$.**.geometry_class ? (@ == "illustrative")')
    $$;
    CREATE FUNCTION usp_has_display_only_geometry(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT jsonb_path_exists(value, '$.**.geometryClass ? (@ == "illustrative" || @ == "estimated")')
        OR jsonb_path_exists(value, '$.**.representation ? (@ == "context_mesh")')
    $$;
    -- NOT VALID preserves any incompatible historical bytes while rejecting new writes.
    ALTER TABLE registry_records ADD CONSTRAINT usp_registry_no_illustrative CHECK (NOT usp_has_illustrative_geometry(body)) NOT VALID;
    ALTER TABLE registry_revisions ADD CONSTRAINT usp_registry_history_no_illustrative CHECK (NOT usp_has_illustrative_geometry(body)) NOT VALID;
    ALTER TABLE physical_features ADD CONSTRAINT usp_features_no_illustrative CHECK (NOT usp_has_illustrative_geometry(body)) NOT VALID;
    ALTER TABLE physical_feature_revisions ADD CONSTRAINT usp_feature_history_no_illustrative CHECK (NOT usp_has_illustrative_geometry(body)) NOT VALID;
    ALTER TABLE units ADD CONSTRAINT usp_units_no_illustrative CHECK (NOT usp_has_illustrative_geometry(body)) NOT VALID;
    ALTER TABLE unit_revisions ADD CONSTRAINT usp_unit_history_no_illustrative CHECK (NOT usp_has_illustrative_geometry(body)) NOT VALID;

    CREATE TABLE usp_geometry_qualifications (
      namespace text NOT NULL CHECK (namespace IN ('registry_record','area_feature')),
      record_id uuid NOT NULL, record_revision integer NOT NULL CHECK(record_revision>0),
      revision integer NOT NULL CHECK(revision>0), target_body_sha256 text NOT NULL CHECK(target_body_sha256 ~ '^[a-f0-9]{64}$'),
      body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(namespace,record_id,record_revision,revision),
      CHECK ((body->>'geometryClass' IN ('evidence_linked','estimated')) IS TRUE),
      CHECK ((body->>'representation' IN ('context_mesh','physical_semantic','legal_space')) IS TRUE),
      CHECK ((jsonb_typeof(body->'analyticEligible')='boolean') IS TRUE),
      CHECK (body ?& ARRAY['representation','geometryClass','analyticEligible','semanticLod','displayLevel','qualification']),
      CHECK (NOT usp_has_illustrative_geometry(body))
    );
    CREATE FUNCTION usp_geometry_receipt_eligible(ns text, rid uuid, rev integer, hash text, metadata jsonb)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      SELECT COALESCE(metadata->>'analyticEligible'='true' AND metadata->>'geometryClass'='evidence_linked'
        AND metadata->>'representation' IN ('physical_semantic','legal_space')
        AND metadata#>>'{qualification,state}'='qualified'
        AND metadata#>>'{qualification,targetBodySha256}'=hash
        AND CASE WHEN jsonb_typeof(metadata#>'{qualification,sources}')='array' THEN
          jsonb_array_length(metadata#>'{qualification,sources}')>0 AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(metadata#>'{qualification,sources}') p WHERE NOT EXISTS (
              SELECT 1 FROM sources s WHERE p#>>'{source,ref,namespace}'='source_revision'
                AND s.id::text=p#>>'{source,ref,id}' AND s.revision::text=p#>>'{source,revision}' AND s.sha256=p->>'sha256'
                AND NOT EXISTS(SELECT 1 FROM sources newer WHERE newer.case_id=s.case_id
                  AND newer.family_id=s.family_id AND newer.revision>s.revision)))
          ELSE false END
        AND EXISTS (SELECT 1 FROM usp_command_receipts c WHERE c.id::text=metadata#>>'{qualification,receiptId}'
          AND c.operation='qualify_geometry' AND c.body->>'status'='qualified'
          AND c.body->'target'=jsonb_build_object('ref',jsonb_build_object('namespace',ns,'id',rid::text),'revision',rev)
          AND c.body->>'targetBodySha256'=hash AND c.body->'sources'=metadata#>'{qualification,sources}'
          AND c.body#>>'{checks,reference}'='passed' AND c.body#>>'{checks,topology}'='passed'
          AND c.body#>>'{checks,sourceIntegrity}'='passed' AND c.body#>>'{review,verdict}'='accepted'), false)
    $$;
    CREATE FUNCTION usp_geometry_qualification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target_body jsonb; actual_revision integer;
    BEGIN
      IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Geometry qualifications are immutable revisions'; END IF;
      IF NEW.namespace='registry_record' THEN
        SELECT body,revision INTO target_body,actual_revision FROM registry_records WHERE id=NEW.record_id;
      ELSE
        SELECT body,revision INTO target_body,actual_revision FROM physical_features WHERE id=NEW.record_id;
      END IF;
      IF target_body IS NULL OR actual_revision<>NEW.record_revision OR
        encode(sha256(convert_to(target_body::text,'UTF8')),'hex')<>NEW.target_body_sha256 THEN
        RAISE EXCEPTION 'Geometry qualification must pin the current canonical bytes and revision';
      END IF;
      IF NEW.body->>'analyticEligible'='true' AND usp_has_display_only_geometry(target_body)
        THEN RAISE EXCEPTION 'Display-only or estimated source geometry cannot be promoted by an annotation'; END IF;
      IF NEW.body->>'analyticEligible'='true' AND NOT
        usp_geometry_receipt_eligible(NEW.namespace,NEW.record_id,NEW.record_revision,NEW.target_body_sha256,NEW.body)
        THEN RAISE EXCEPTION 'Analytical qualification requires its accepted canonical command receipt'; END IF;
      IF NEW.body->>'analyticEligible'='false' AND NEW.body#>>'{qualification,state}' IS DISTINCT FROM 'unqualified'
        THEN RAISE EXCEPTION 'Unqualified geometry cannot claim a qualification'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER usp_geometry_qualification_guard BEFORE INSERT OR UPDATE OR DELETE ON usp_geometry_qualifications
      FOR EACH ROW EXECUTE FUNCTION usp_geometry_qualification_guard();

    CREATE VIEW usp_analytic_geometry WITH (security_barrier=true) AS
      WITH latest AS (SELECT DISTINCT ON(namespace,record_id,record_revision) * FROM usp_geometry_qualifications
        ORDER BY namespace,record_id,record_revision,revision DESC), canonical AS (
        SELECT 'registry_record'::text AS namespace,r.id,r.revision,r.site_id AS scope_id,r.body FROM registry_records r
          WHERE NOT EXISTS(SELECT 1 FROM usp_project_codes i WHERE i.record_id=r.id AND i.status IN ('retired','cancelled_error'))
        UNION ALL SELECT 'area_feature',f.id,f.revision,a.site_id,f.body FROM physical_features f JOIN map_areas a ON a.id=f.area_id
          WHERE NOT EXISTS(SELECT 1 FROM usp_project_codes i WHERE i.record_id=f.record_id AND i.status IN ('retired','cancelled_error')))
      SELECT c.namespace,c.id,c.revision,c.scope_id,c.body,q.body AS metadata,q.revision AS qualification_revision
      FROM canonical c JOIN latest q ON q.namespace=c.namespace AND q.record_id=c.id AND q.record_revision=c.revision
      WHERE NOT usp_has_display_only_geometry(c.body)
        AND q.target_body_sha256=encode(sha256(convert_to(c.body::text,'UTF8')),'hex')
        AND usp_geometry_receipt_eligible(q.namespace,q.record_id,q.record_revision,q.target_body_sha256,q.body);
    REVOKE ALL ON FUNCTION usp_geometry_receipt_eligible(text,uuid,integer,text,jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION usp_geometry_receipt_eligible(text,uuid,integer,text,jsonb)
      TO ulpin_usp_find,ulpin_usp_ready,ulpin_usp_pack,ulpin_usp_export;
    REVOKE ALL ON usp_geometry_qualifications,usp_analytic_geometry FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO ulpin_usp_find,ulpin_usp_ready,ulpin_usp_pack,ulpin_usp_export;
    GRANT SELECT ON usp_analytic_geometry TO ulpin_usp_find,ulpin_usp_ready,ulpin_usp_pack,ulpin_usp_export;

    CREATE SCHEMA IF NOT EXISTS usp_display;
    REVOKE ALL ON SCHEMA usp_display FROM PUBLIC;
    CREATE TABLE usp_display.derivatives (
      id uuid PRIMARY KEY, record_id uuid NOT NULL, record_revision integer NOT NULL,
      body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(record_id,record_revision) REFERENCES registry_revisions(record_id,revision),
      CHECK ((body#>>'{metadata,analyticEligible}'='false') IS TRUE),
      CHECK ((body#>>'{metadata,qualification,state}'='unqualified') IS TRUE),
      CHECK ((body#>>'{record,ref,namespace}'='registry_record') IS TRUE),
      CHECK ((body#>>'{record,ref,id}'=record_id::text) IS TRUE),
      CHECK ((body#>>'{record,revision}'=record_revision::text) IS TRUE)
    );
    CREATE FUNCTION usp_display.immutable_derivative() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Display derivatives are immutable; retain prior input and asset pins'; END $$;
    CREATE TRIGGER immutable_derivative BEFORE UPDATE OR DELETE ON usp_display.derivatives
      FOR EACH ROW EXECUTE FUNCTION usp_display.immutable_derivative();
    REVOKE ALL ON ALL TABLES IN SCHEMA usp_display FROM PUBLIC;
    REVOKE ALL ON SCHEMA usp_display FROM ulpin_usp_find,ulpin_usp_ready,ulpin_usp_pack,ulpin_usp_export;
    GRANT USAGE ON SCHEMA usp_display TO ulpin_usp_display_compiler;
    GRANT SELECT ON usp_display.derivatives TO ulpin_usp_display_compiler;
  