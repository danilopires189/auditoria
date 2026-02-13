create extension if not exists pgcrypto;

create schema if not exists app;
create schema if not exists staging;
create schema if not exists audit;
create schema if not exists authz;

create table if not exists public.schema_migrations (
    version text primary key,
    filename text not null,
    checksum text not null,
    applied_at timestamptz not null default timezone('utc', now())
);