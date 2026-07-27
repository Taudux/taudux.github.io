-- Raise the existing course-cover bucket limit for generated JPEG uploads.
begin;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'course-covers') then
    raise exception 'course-covers bucket is required before migration 0013';
  end if;
end
$$;

update storage.buckets
set file_size_limit = 10000000
where id = 'course-covers';

do $$
begin
  if exists (
    select 1
    from storage.buckets
    where id = 'course-covers'
      and file_size_limit is distinct from 10000000
  ) then
    raise exception 'course-covers bucket limit was not updated';
  end if;
end
$$;

commit;
