-- Run once in your own Supabase project's SQL Editor. No service key is needed in the app.
begin;

create table if not exists public.lily_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  constraint lily_data_size check (octet_length(data::text) <= 10485760)
);

alter table public.lily_workspaces enable row level security;
revoke all on public.lily_workspaces from public, anon;
grant select, insert, update on public.lily_workspaces to authenticated;

drop policy if exists lily_read_own on public.lily_workspaces;
create policy lily_read_own on public.lily_workspaces for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists lily_insert_own on public.lily_workspaces;
create policy lily_insert_own on public.lily_workspaces for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists lily_update_own on public.lily_workspaces;
create policy lily_update_own on public.lily_workspaces for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Atomic compare-and-swap: two devices cannot silently overwrite the same version.
create or replace function public.save_lily_workspace(p_data jsonb, p_expected_version bigint)
returns table(version bigint)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_version bigint;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0
     or p_data is null
     or jsonb_typeof(p_data) is distinct from 'object'
     or (p_data->>'schemaVersion') is distinct from '2'
     or jsonb_typeof(p_data->'plans') is distinct from 'object'
     or jsonb_typeof(p_data->'lib') is distinct from 'array'
     or jsonb_typeof(p_data->'students') is distinct from 'array'
     or jsonb_typeof(p_data->'locs') is distinct from 'array' then
    raise exception 'invalid_workspace' using errcode = '22023';
  end if;
  if p_expected_version = 0 then
    insert into public.lily_workspaces as w(user_id, data, version)
      values (v_user, p_data, 1)
      on conflict (user_id) do nothing
      returning w.version into v_version;
  else
    update public.lily_workspaces as w
      set data = p_data, version = w.version + 1, updated_at = now()
      where w.user_id = v_user and w.version = p_expected_version
      returning w.version into v_version;
  end if;
  if v_version is null then
    raise exception 'sync_conflict' using errcode = '40001';
  end if;
  return query select v_version;
end;
$$;

revoke all on function public.save_lily_workspace(jsonb, bigint) from public, anon;
grant execute on function public.save_lily_workspace(jsonb, bigint) to authenticated;
commit;
