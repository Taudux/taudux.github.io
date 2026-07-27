\set ON_ERROR_STOP on

select case
  when current_database() = 'taudux_cover_0013_test' then true
  else pg_catalog.set_config('taudux.guard', 'refuse-wrong-database', false)::boolean
end as guarded_database;

begin;
create schema storage;
create table storage.buckets (
  id text primary key,
  file_size_limit bigint,
  allowed_mime_types text[]
);
insert into storage.buckets (id, file_size_limit, allowed_mime_types)
values ('course-covers', 5242880, array['image/jpeg', 'image/png', 'image/webp']);

\ir ../migrations/0013_course_cover_bucket_limit.sql

do $$
begin
  if (select file_size_limit from storage.buckets where id = 'course-covers') <> 10000000 then
    raise exception 'migration 0013 did not set the decimal 10 MB limit';
  end if;
  if (select allowed_mime_types from storage.buckets where id = 'course-covers')
      is distinct from array['image/jpeg', 'image/png', 'image/webp'] then
    raise exception 'migration 0013 changed legacy MIME allowances';
  end if;
end
$$;

rollback;
