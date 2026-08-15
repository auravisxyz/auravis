create table if not exists triggers (
  id serial primary key,
  mandate_id bigint not null,
  token varchar(64) not null,
  direction varchar(8) not null check (direction in ('below', 'above')),
  target_price double precision not null,
  amount_in numeric(78, 0) not null,
  intent text not null,
  mode varchar(8) not null default 'catch' check (mode in ('catch', 'auto')),
  -- 'triggered' = price crossed, alert raised, purchase not yet made.
  -- 'fired'     = purchase confirmed on-chain. Kept distinct on purpose.
  status varchar(16) not null default 'active'
    check (status in ('active', 'triggered', 'fired', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  triggered_at timestamptz,
  fired_at timestamptz
);

create index if not exists triggers_status_idx on triggers (status);

create table if not exists executions (
  id serial primary key,
  trigger_id integer not null references triggers(id),
  mandate_id bigint not null,
  status varchar(16) not null check (status in ('pending', 'confirmed', 'reverted', 'skipped')),
  reason text,
  tx_hash varchar(66),
  created_at timestamptz not null default now()
);

create index if not exists executions_trigger_id_idx on executions (trigger_id);
