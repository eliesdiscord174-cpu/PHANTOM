-- ============================================================
-- Schéma PHANTOM pour Supabase
-- À exécuter une seule fois dans Supabase → SQL Editor → New query
-- ============================================================

create table if not exists downloads (
  id              bigint primary key,
  name            text not null,
  version         text not null,
  category        text not null,
  downloads       int not null default 0,
  url             text default '#',
  size            text default '',
  description     text default '',
  banner          text default '',
  image           text default '',
  video           text default '',
  rating          numeric default 0,
  reviews_count   int not null default 0,
  favorites_count int not null default 0,
  detection       text not null default 'undetectable',
  updated_at      timestamptz not null default now()
);

create table if not exists members (
  discord_id text primary key,
  joined_at  timestamptz not null default now()
);

create table if not exists history (
  id          bigint primary key,
  user_id     text not null,
  download_id bigint not null,
  name        text not null,
  "timestamp" timestamptz not null default now()
);

create table if not exists reviews (
  id          bigint primary key,
  download_id bigint not null,
  user_id     text not null,
  username    text,
  avatar      text,
  rating      int not null,
  text        text default '',
  verified    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  unique (download_id, user_id)
);

create table if not exists products (
  id          bigint primary key,
  name        text not null,
  description text default '',
  price       text not null,
  image       text default '',
  created_at  timestamptz not null default now()
);

create table if not exists articles (
  id         bigint primary key,
  title      text not null,
  excerpt    text not null,
  content    text default '',
  image      text default '',
  author     text default 'Équipe PHANTOM',
  created_at timestamptz not null default now()
);

-- Une seule ligne (id = 1) contenant les textes modifiables du hero d'accueil.
create table if not exists settings (
  id                int primary key default 1,
  hero_badge        text,
  hero_title_line1  text,
  hero_title_line2  text,
  hero_lead         text,
  constraint settings_singleton check (id = 1)
);

insert into settings (id, hero_badge, hero_title_line1, hero_title_line2, hero_lead)
values (
  1,
  'Plateforme officielle PHANTOM',
  'Téléchargez vos outils',
  'sur n''importe quel jeu',
  'Overlays, thèmes, extensions et utilitaires pour vos jeux préférés, gratuitement et en un clic. Connectez-vous avec Discord et téléchargez immédiatement.'
)
on conflict (id) do nothing;

-- Les 3 téléchargements de démarrage (mêmes valeurs que l'ancien downloads.json).
insert into downloads (id, name, version, category, downloads, url, size, description, rating, reviews_count, detection)
values
  (1, 'Overlay Stats HUD', '4.2.1', 'Multi-jeux', 809, '#', '56.9 Mo', 'Un overlay complet pour afficher tes statistiques en direct.', 4.8, 36, 'undetectable'),
  (2, 'Thème Discord PHANTOM', '1.0.0', 'Discord', 777, '#', '12.4 Mo', 'Le thème officiel du serveur PHANTOM pour Discord.', 4.9, 28, 'undetectable'),
  (3, 'Pack de profils Stream Deck', '2.0', 'Streaming', 583, '#', '8.1 Mo', 'Des profils prêts à l''emploi pour ton Stream Deck.', 4.6, 19, 'undetectable')
on conflict (id) do nothing;

-- Row Level Security : activée sur toutes les tables. Le serveur Express est
-- le SEUL à parler à Supabase, et il utilise la clé "service_role" qui
-- contourne RLS. Le navigateur, lui, ne reçoit jamais cette clé : il passe
-- toujours par l'API du serveur (/api/...), donc tout le monde voit
-- exactement les mêmes données, et seul le middleware requireAdmin (basé sur
-- ADMIN_DISCORD_IDS) autorise les écritures sensibles.
alter table downloads enable row level security;
alter table members   enable row level security;
alter table history    enable row level security;
alter table reviews    enable row level security;
alter table products   enable row level security;
alter table articles   enable row level security;
alter table settings   enable row level security;
