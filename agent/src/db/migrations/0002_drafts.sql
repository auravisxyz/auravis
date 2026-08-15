-- Handoff between the extension popup and the web app, where signing happens.
create table if not exists drafts (
  id varchar(32) primary key,
  capture jsonb not null,
  draft jsonb not null,
  status varchar(16) not null default 'pending'
    check (status in ('pending', 'signed', 'abandoned')),
  mandate_id bigint,
  tx_hash varchar(66),
  created_at timestamptz not null default now()
);

create index if not exists drafts_status_idx on drafts (status);
create index if not exists drafts_created_at_idx on drafts (created_at desc);
