-- Tables pour le système de sondage "cool ou pas" sur les nouveaux outils.
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists tool_polls (
  id bigint generated always as identity primary key,
  download_id bigint not null references downloads(id) on delete cascade,
  message_id text,
  created_at timestamptz default now()
);

create table if not exists poll_votes (
  id bigint generated always as identity primary key,
  poll_id bigint not null references tool_polls(id) on delete cascade,
  user_id text not null,
  vote text not null check (vote in ('cool', 'meh', 'bad')),
  created_at timestamptz default now(),
  unique (poll_id, user_id)
);
