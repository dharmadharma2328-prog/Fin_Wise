create table if not exists finance_state (
  id integer primary key check (id = 1),
  state_json text not null check (json_valid(state_json)),
  updated_at text not null default (datetime('now'))
);

create table if not exists finance_records (
  collection text not null check (collection in ('transactions', 'budgets', 'goals', 'bills', 'billPayments', 'expenses')),
  record_id text not null,
  data_json text not null check (json_valid(data_json)),
  primary key (collection, record_id)
);
create index if not exists finance_records_collection_idx on finance_records(collection);
