-- Categories for tenders and suppliers (PRD P1-04, P1-13; OPEN_QUESTIONS.md, item 5).
--
-- Seeded with the six categories the legacy profile form offered. This is a DRAFT list: the client
-- has not confirmed the pilot categories yet (PRD section 13, item 4). Replace it with a new
-- migration when they do; tenders and suppliers keep their category ids.

create table public.categories (
  id bigint generated always as identity primary key,
  name text not null unique,
  slug text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  constraint categories_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table public.categories is
  'Tender and supplier categories. DRAFT: seeded with the legacy list until the client confirms the pilot categories.';

insert into public.categories (name, slug, sort_order) values
  ('Goods and Supplies', 'goods-and-supplies', 10),
  ('Works', 'works', 20),
  ('Professional Services', 'professional-services', 30),
  ('Technology Services', 'technology-services', 40),
  ('Security Services', 'security-services', 50),
  ('Cleaning and Janitorial', 'cleaning-and-janitorial', 60);

-- Optional on a draft; required to publish (enforced by the tender lifecycle).
alter table public.tenders add column category_id bigint references public.categories (id);
create index tenders_category_id_idx on public.tenders (category_id);

-- The category a supplier receives new-tender alerts for.
alter table public.supplier_profiles add column category_id bigint references public.categories (id);
create index supplier_profiles_category_id_idx on public.supplier_profiles (category_id);

-- Suppliers chose from the same six names, stored as text. A schema change isn't an edit by the
-- supplier, so updated_at keeps its value.
alter table public.supplier_profiles disable trigger set_supplier_profiles_updated_at;
update public.supplier_profiles supplier
set category_id = category.id
from public.categories category
where lower(btrim(supplier.industry_category)) = lower(category.name);
alter table public.supplier_profiles enable trigger set_supplier_profiles_updated_at;

comment on column public.supplier_profiles.industry_category is
  'Legacy free-text category, kept unchanged. category_id is the category the platform uses.';

alter table public.categories enable row level security;

create policy categories_read_signed_in on public.categories
for select to authenticated
using (true);

revoke all on public.categories from public, anon, authenticated;
grant select on public.categories to authenticated;
