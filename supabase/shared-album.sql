-- Run this in the Supabase SQL Editor. It creates a private bucket,
-- an explicit email allowlist, photo metadata, and realtime publication.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'christmas-album',
  'christmas-album',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.christmas_album_members (
  email text primary key check (email = lower(btrim(email))),
  added_at timestamptz not null default now()
);

alter table public.christmas_album_members enable row level security;
revoke all on table public.christmas_album_members from anon, authenticated;

create or replace function public.is_christmas_album_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.christmas_album_members as member
    where member.email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );
$$;

revoke all on function public.is_christmas_album_member() from public, anon;
grant execute on function public.is_christmas_album_member() to authenticated;

create table if not exists public.christmas_album_photos (
  id uuid primary key default gen_random_uuid(),
  album_id text not null,
  storage_path text not null unique,
  original_name text not null,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.christmas_album_photos enable row level security;
revoke all on table public.christmas_album_photos from anon, authenticated;
grant select, insert, delete on table public.christmas_album_photos to authenticated;

drop policy if exists "Invited members can read shared photos" on public.christmas_album_photos;
create policy "Invited members can read shared photos"
  on public.christmas_album_photos for select to authenticated
  using (
    album_id = 'christmas-tree-shared'
    and (select public.is_christmas_album_member())
  );

drop policy if exists "Invited members can add their own photos" on public.christmas_album_photos;
create policy "Invited members can add their own photos"
  on public.christmas_album_photos for insert to authenticated
  with check (
    album_id = 'christmas-tree-shared'
    and uploader_id = (select auth.uid())
    and (select public.is_christmas_album_member())
  );

drop policy if exists "Members can delete their own photos" on public.christmas_album_photos;
create policy "Members can delete their own photos"
  on public.christmas_album_photos for delete to authenticated
  using (
    album_id = 'christmas-tree-shared'
    and uploader_id = (select auth.uid())
    and (select public.is_christmas_album_member())
  );

drop policy if exists "Invited members can view album files" on storage.objects;
create policy "Invited members can view album files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'christmas-album'
    and (storage.foldername(name))[1] = 'christmas-tree-shared'
    and (select public.is_christmas_album_member())
  );

drop policy if exists "Invited members can upload their own album files" on storage.objects;
create policy "Invited members can upload their own album files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'christmas-album'
    and (storage.foldername(name))[1] = 'christmas-tree-shared'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.is_christmas_album_member())
  );

drop policy if exists "Members can delete their own album files" on storage.objects;
create policy "Members can delete their own album files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'christmas-album'
    and (storage.foldername(name))[1] = 'christmas-tree-shared'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.is_christmas_album_member())
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'christmas_album_photos'
  ) then
    alter publication supabase_realtime add table public.christmas_album_photos;
  end if;
end
$$;

