-- SCHOOL BRAWL CUP 2.0
-- This migration has already been applied to the connected Supabase project.
-- Keep it in the repository so the schema change is documented.
alter table public.tournaments
  add column if not exists details text not null default '';
