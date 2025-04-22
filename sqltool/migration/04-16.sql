create or replace function get_public_tables()
returns table(tablename text)
language sql
as $$
  select tablename
  from pg_tables
  where schemaname = 'public';
$$;

-- Function to get column info for a specific table in a specific schema
CREATE OR REPLACE FUNCTION get_table_column_info (p_schema_name TEXT, p_table_name TEXT)
RETURNS TABLE (
    column_name NAME,
    data_type TEXT, -- Use TEXT for broader compatibility in JS
    is_nullable TEXT, -- Keep as TEXT ('YES'/'NO')
    column_default TEXT,
    udt_name NAME -- User Defined Type name (useful for enums etc.)
)
LANGUAGE sql
SECURITY DEFINER -- Important: Runs with the permissions of the function owner, allowing access to information_schema
AS $$
  SELECT
    col.column_name,
    col.data_type,
    col.is_nullable,
    col.column_default,
    col.udt_name -- Include UDT name
  FROM information_schema.columns AS col
  WHERE col.table_schema = p_schema_name
    AND col.table_name = p_table_name;
$$;

-- Grant permission to the roles your Supabase client uses (e.g., anon, authenticated)
-- Replace 'anon' and 'authenticated' if you use different roles
GRANT EXECUTE ON FUNCTION get_table_column_info(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_table_column_info(TEXT, TEXT) TO authenticated;


-- ⚠️⚠️ 보안이슈에 노출될 수 있어서 특정 제품만 검색할 수 있도록 하는 코드로 작성하는게 훨씬 나음 
create or replace function execute_sql(query text)
returns json
language plpgsql
as $$
declare
    result json;
begin
    execute format('select json_agg(t) from (%s) t', query) into result;
    return result;
exception when others then
    raise notice '쿼리 실행 오류: %', sqlerrm;
    return json_build_object('error', sqlerrm);
end;
$$;