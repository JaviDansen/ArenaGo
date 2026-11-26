// The projections are paired with the fields required by formatVersion 2.
// PostgreSQL OIDs are used for joins only. Definitions use the same search_path in both environments.
export const structuralCatalogSql = `SELECT * FROM (
  WITH relations AS (
    SELECT c.*, n.nspname AS schema
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p')
  )
  SELECT 'table' AS kind, r.schema, r.relname AS name, NULL::name AS relation, NULL::text AS signature,
    jsonb_build_object('relationKind', r.relkind::text, 'persistence', r.relpersistence::text,
      'rowSecurity', r.relrowsecurity, 'forceRowSecurity', r.relforcerowsecurity) AS properties
  FROM relations r
  UNION ALL
  SELECT 'column', r.schema, a.attname, r.relname, NULL,
    jsonb_build_object('position', a.attnum, 'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull, 'expression', pg_get_expr(d.adbin, d.adrelid, false),
      'identity', a.attidentity::text, 'generated', a.attgenerated::text,
      'collation', CASE WHEN col.oid IS NOT NULL THEN format('%I.%I', ns.nspname, col.collname) END)
  FROM relations r JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  LEFT JOIN pg_catalog.pg_collation col ON col.oid = a.attcollation
  LEFT JOIN pg_catalog.pg_namespace ns ON ns.oid = col.collnamespace
  WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint', r.schema, k.conname, r.relname, NULL,
    jsonb_build_object('constraintType', k.contype::text, 'definition', pg_get_constraintdef(k.oid, false),
      'validated', k.convalidated, 'enforced', k.conenforced, 'deferrable', k.condeferrable,
      'initiallyDeferred', k.condeferred,
      'foreignKeyTriggers', CASE WHEN k.contype = 'f' THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'tableSchema', trigger_ns.nspname, 'tableName', trigger_rel.relname,
          'relatedSchema', related_ns.nspname, 'relatedName', related_rel.relname,
          'functionSchema', fn_ns.nspname, 'functionName', fn.proname,
          'functionSignature', oidvectortypes(fn.proargtypes),
          'eventsAndTiming', ri.tgtype, 'enabled', ri.tgenabled::text,
          'deferrable', ri.tgdeferrable, 'initiallyDeferred', ri.tginitdeferred))
        FROM pg_catalog.pg_trigger ri
        JOIN pg_catalog.pg_class trigger_rel ON trigger_rel.oid = ri.tgrelid
        JOIN pg_catalog.pg_namespace trigger_ns ON trigger_ns.oid = trigger_rel.relnamespace
        LEFT JOIN pg_catalog.pg_class related_rel ON related_rel.oid = ri.tgconstrrelid
        LEFT JOIN pg_catalog.pg_namespace related_ns ON related_ns.oid = related_rel.relnamespace
        JOIN pg_catalog.pg_proc fn ON fn.oid = ri.tgfoid
        JOIN pg_catalog.pg_namespace fn_ns ON fn_ns.oid = fn.pronamespace
        WHERE ri.tgisinternal AND ri.tgconstraint = k.oid
      ), '[]'::jsonb) END)
  FROM relations r JOIN pg_catalog.pg_constraint k ON k.conrelid = r.oid
  UNION ALL
  SELECT 'index', n.nspname, c.relname, NULL, NULL,
    jsonb_build_object('definition', pg_get_indexdef(c.oid, 0, false), 'unique', i.indisunique,
      'valid', i.indisvalid, 'ready', i.indisready, 'live', i.indislive,
      'predicate', pg_get_expr(i.indpred, i.indrelid, false))
  FROM relations r JOIN pg_catalog.pg_index i ON i.indrelid = r.oid
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  UNION ALL
  SELECT 'function', n.nspname, p.proname, NULL, oidvectortypes(p.proargtypes),
    jsonb_build_object('definition', pg_get_functiondef(p.oid), 'language', l.lanname,
      'volatility', p.provolatile::text, 'securityDefiner', p.prosecdef, 'leakproof', p.proleakproof,
      'strict', p.proisstrict, 'parallel', p.proparallel::text, 'configuration', p.proconfig)
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE n.nspname IN ('public', 'drizzle') AND p.prokind = 'f'
  UNION ALL
  SELECT 'trigger', r.schema, t.tgname, r.relname, NULL,
    jsonb_build_object('definition', pg_get_triggerdef(t.oid, false), 'enabled', t.tgenabled::text,
      'function', format('%I.%I(%s)', fn_schema.nspname, fn.proname, oidvectortypes(fn.proargtypes)),
      'eventsAndTiming', t.tgtype, 'deferrable', t.tgdeferrable, 'initiallyDeferred', t.tginitdeferred)
  FROM relations r JOIN pg_catalog.pg_trigger t ON t.tgrelid = r.oid
  JOIN pg_catalog.pg_proc fn ON fn.oid = t.tgfoid
  JOIN pg_catalog.pg_namespace fn_schema ON fn_schema.oid = fn.pronamespace
  WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'sequence', n.nspname, c.relname, NULL, NULL,
    jsonb_build_object('type', format_type(s.seqtypid, NULL), 'start', s.seqstart::text, 'min', s.seqmin::text,
      'max', s.seqmax::text, 'increment', s.seqincrement::text, 'cache', s.seqcache::text, 'cycle', s.seqcycle,
      'ownedBy', (
        SELECT format('%I.%I.%I', owner_schema.nspname, owner_table.relname, a.attname)
        FROM pg_catalog.pg_depend d
        JOIN pg_catalog.pg_class owner_table ON owner_table.oid = d.refobjid
        JOIN pg_catalog.pg_namespace owner_schema ON owner_schema.oid = owner_table.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
        WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.refclassid = 'pg_catalog.pg_class'::regclass
          AND d.objid = c.oid AND d.deptype IN ('a', 'i')
      ))
  FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'drizzle')
) AS structural_catalog`;
