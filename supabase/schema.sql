create extension if not exists pgcrypto;

create table if not exists inventory (
  item_id text primary key,
  barcode text unique,
  title text not null default '',
  category text not null default '',
  brand text not null default '',
  size text not null default '',
  condition text not null default '',
  color text not null default '',
  purchase_price numeric(12,2) default 0,
  target_sale_price numeric(12,2) default 0,
  minimum_sale_price numeric(12,2) default 0,
  desired_profit numeric(12,2) default 0,
  platform_fee numeric(12,2) default 0,
  other_costs numeric(12,2) default 0,
  purchase_date date,
  listing_date date,
  sale_date date,
  actual_sale_price numeric(12,2),
  status text not null default 'Draft',
  days_listed integer,
  profit_at_target numeric(12,2) default 0,
  actual_profit numeric(12,2),
  description text not null default '',
  keywords text not null default '',
  storage_location text not null default '',
  source text not null default '',
  vinted_url text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pictures (
  picture_id text primary key,
  item_id text not null references inventory(item_id) on delete cascade,
  image_url text not null default '',
  storage_path text not null default '',
  note text not null default '',
  is_cover boolean not null default false,
  is_packaging_proof boolean not null default false,
  photo_type text not null default 'General',
  uploaded_at timestamptz not null default now()
);

create table if not exists labels (
  label_id text primary key,
  item_id text not null references inventory(item_id) on delete cascade,
  file_url text not null default '',
  storage_path text not null default '',
  note text not null default '',
  uploaded_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  timestamp timestamptz not null default now(),
  item_id text not null default '',
  action text not null default '',
  field text not null default '',
  old_value text not null default '',
  new_value text not null default '',
  note text not null default ''
);

create table if not exists status_log (
  id bigint generated always as identity primary key,
  timestamp timestamptz not null default now(),
  item_id text not null references inventory(item_id) on delete cascade,
  old_status text not null default '',
  new_status text not null default '',
  note text not null default ''
);

create table if not exists settings (
  key text primary key,
  value text not null default ''
);

insert into settings (key, value) values
  ('DEFAULT_DESIRED_PROFIT', '5'),
  ('DEFAULT_PLATFORM_FEE', '0'),
  ('DEFAULT_OTHER_COSTS', '0'),
  ('STALE_WARNING_DAYS', '14'),
  ('STALE_DANGER_DAYS', '30')
on conflict (key) do nothing;

create table if not exists logins (
  id bigint generated always as identity primary key,
  email text unique not null,
  username text unique not null,
  password_hash text,
  password text
);

insert into logins (email, username, password)
values ('you@example.com', 'admin', 'changeme')
on conflict (email) do nothing;

create table if not exists sales (
  id bigint generated always as identity primary key,
  item_id text references inventory(item_id) on delete set null,
  actual_sale_price numeric(12,2),
  sold_at timestamptz not null default now(),
  note text not null default ''
);

create index if not exists inventory_status_idx on inventory(status);
create index if not exists inventory_barcode_idx on inventory(barcode);
create index if not exists pictures_item_id_idx on pictures(item_id);
create index if not exists labels_item_id_idx on labels(item_id);
create index if not exists audit_log_item_id_idx on audit_log(item_id);

insert into storage.buckets (id, name, public)
values ('pictures', 'pictures', true), ('labels', 'labels', true)
on conflict (id) do nothing;
