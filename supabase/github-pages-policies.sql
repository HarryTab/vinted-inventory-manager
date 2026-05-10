-- GitHub Pages is a static frontend, so it uses the public Supabase anon key.
-- Run this only if you are comfortable with this personal app being accessible
-- to anyone who has the site URL and anon key. For stronger protection, move
-- to Supabase Auth policies before sharing the URL widely.

alter table inventory enable row level security;
alter table pictures enable row level security;
alter table labels enable row level security;
alter table audit_log enable row level security;
alter table status_log enable row level security;
alter table settings enable row level security;
alter table logins enable row level security;
alter table sales enable row level security;

drop policy if exists "pages_inventory_all" on inventory;
drop policy if exists "pages_pictures_all" on pictures;
drop policy if exists "pages_labels_all" on labels;
drop policy if exists "pages_audit_log_all" on audit_log;
drop policy if exists "pages_status_log_all" on status_log;
drop policy if exists "pages_settings_all" on settings;
drop policy if exists "pages_logins_read" on logins;
drop policy if exists "pages_sales_all" on sales;

create policy "pages_inventory_all" on inventory for all to anon using (true) with check (true);
create policy "pages_pictures_all" on pictures for all to anon using (true) with check (true);
create policy "pages_labels_all" on labels for all to anon using (true) with check (true);
create policy "pages_audit_log_all" on audit_log for all to anon using (true) with check (true);
create policy "pages_status_log_all" on status_log for all to anon using (true) with check (true);
create policy "pages_settings_all" on settings for all to anon using (true) with check (true);
create policy "pages_logins_read" on logins for select to anon using (true);
create policy "pages_sales_all" on sales for all to anon using (true) with check (true);

drop policy if exists "pages_pictures_storage_read" on storage.objects;
drop policy if exists "pages_pictures_storage_write" on storage.objects;
drop policy if exists "pages_labels_storage_read" on storage.objects;
drop policy if exists "pages_labels_storage_write" on storage.objects;

create policy "pages_pictures_storage_read" on storage.objects for select to anon using (bucket_id = 'pictures');
create policy "pages_pictures_storage_write" on storage.objects for all to anon using (bucket_id = 'pictures') with check (bucket_id = 'pictures');
create policy "pages_labels_storage_read" on storage.objects for select to anon using (bucket_id = 'labels');
create policy "pages_labels_storage_write" on storage.objects for all to anon using (bucket_id = 'labels') with check (bucket_id = 'labels');
