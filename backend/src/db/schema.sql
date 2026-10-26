create table if not exists users (
  id text primary key,
  email text not null unique collate nocase,
  password_hash text not null,
  password_salt text not null,
  created_at text not null default (datetime('now'))
);

create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at integer not null,
  created_at text not null default (datetime('now'))
);
create index if not exists sessions_user_idx on sessions(user_id);
create index if not exists sessions_expiry_idx on sessions(expires_at);

create table if not exists google_accounts (
  google_subject text primary key,
  user_id text not null unique references users(id) on delete cascade,
  email text not null collate nocase,
  created_at text not null default (datetime('now'))
);

create table if not exists finance_state (
  user_id text primary key references users(id) on delete cascade,
  state_json text not null check (json_valid(state_json)),
  updated_at text not null default (datetime('now'))
);

create table if not exists finance_records (
  user_id text not null references users(id) on delete cascade,
  collection text not null check (collection in ('transactions', 'budgets', 'goals', 'bills', 'billPayments', 'expenses')),
  record_id text not null,
  data_json text not null check (json_valid(data_json)),
  primary key (user_id, collection, record_id)
);
create index if not exists finance_records_user_collection_idx on finance_records(user_id, collection);
