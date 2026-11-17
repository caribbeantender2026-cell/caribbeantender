-- The client's category list (sent 14 Nov 2026, "Categories of works, services and goods"): 66
-- categories in three procurement types. The code (WRK-001, SRV-001, GDS-001, ...) is what the
-- client uses to match suppliers to tenders, so it is stored, unique and checked.
--
-- The six draft categories from 20261005040250 are retired, not deleted: rows that still point at
-- them keep working, but they are no longer offered. On 16 Nov 2026 no tender or supplier used them.

alter table public.categories
  add column code text,
  add column procurement_type text,
  add column examples text;

alter table public.categories
  add constraint categories_code_format check (code is null or code ~ '^(WRK|SRV|GDS)-[0-9]{3}$'),
  add constraint categories_procurement_type check (procurement_type is null or procurement_type in ('Works', 'Services', 'Goods & Supplies')),
  add constraint categories_examples_length check (examples is null or char_length(examples) <= 300);

create unique index categories_code_key on public.categories (code);

comment on table public.categories is
  'Tender and supplier categories: the client''s list of Works, Services and Goods & Supplies, each with a code.';
comment on column public.categories.code is 'The client''s category code: WRK = Works, SRV = Services, GDS = Goods & Supplies.';

update public.categories set is_active = false where code is null;

-- Only the client's coded categories may be offered; a retired draft row may lack a code.
alter table public.categories
  add constraint categories_active_have_code check (not is_active or (code is not null and procurement_type is not null));

insert into public.categories (code, procurement_type, name, slug, examples, sort_order) values
  ('WRK-001', 'Works', 'Building & General Construction', 'wrk-001', 'Residential, commercial and industrial construction', 101),
  ('WRK-002', 'Works', 'Civil Engineering & Infrastructure', 'wrk-002', 'Roads, bridges, drainage, retaining walls', 102),
  ('WRK-003', 'Works', 'Electrical Works', 'wrk-003', 'Wiring, lighting, electrical installations, upgrades', 103),
  ('WRK-004', 'Works', 'Plumbing & Sanitation', 'wrk-004', 'Pipe installation, drainage, sewage systems', 104),
  ('WRK-005', 'Works', 'Mechanical Works', 'wrk-005', 'Industrial equipment installation, mechanical systems', 105),
  ('WRK-006', 'Works', 'Renovation & Refurbishment', 'wrk-006', 'Building upgrades, remodeling, interior improvements', 106),
  ('WRK-007', 'Works', 'Painting & Finishing', 'wrk-007', 'Interior/exterior painting, tiling, plastering', 107),
  ('WRK-008', 'Works', 'Roofing & Waterproofing', 'wrk-008', 'Roofing installation, repairs, waterproofing', 108),
  ('WRK-009', 'Works', 'Landscaping & External Works', 'wrk-009', 'Land preparation, paving, fencing, landscaping', 109),
  ('WRK-010', 'Works', 'HVAC Installation & Maintenance', 'wrk-010', 'Air conditioning, ventilation, refrigeration', 110),
  ('WRK-011', 'Works', 'Renewable Energy Installation', 'wrk-011', 'Solar panels, battery storage, energy systems', 111),
  ('WRK-012', 'Works', 'Telecommunications Infrastructure', 'wrk-012', 'Fibre-optic installation, cabling, network infrastructure', 112),
  ('WRK-013', 'Works', 'Demolition & Site Preparation', 'wrk-013', 'Excavation, demolition, clearing, earthworks', 113),
  ('WRK-014', 'Works', 'Security Systems Installation', 'wrk-014', 'CCTV, access control, alarm systems', 114),
  ('WRK-015', 'Works', 'Water & Environmental Infrastructure', 'wrk-015', 'Water treatment facilities, wastewater systems', 115),
  ('SRV-001', 'Services', 'Accounting, Audit & Taxation', 'srv-001', 'Bookkeeping, financial audits, tax consultancy', 201),
  ('SRV-002', 'Services', 'Legal & Compliance', 'srv-002', 'Legal advisory, contracts, regulatory compliance', 202),
  ('SRV-003', 'Services', 'Business & Management Consulting', 'srv-003', 'Strategic planning, operational improvement', 203),
  ('SRV-004', 'Services', 'Information Technology', 'srv-004', 'Software development, IT support, cloud solutions', 204),
  ('SRV-005', 'Services', 'Marketing, Advertising & Branding', 'srv-005', 'Digital marketing, campaigns, brand development', 205),
  ('SRV-006', 'Services', 'Graphic Design & Creative Services', 'srv-006', 'Logo design, print design, digital content', 206),
  ('SRV-007', 'Services', 'Media, Photography & Videography', 'srv-007', 'Photography, video production, broadcasting', 207),
  ('SRV-008', 'Services', 'Human Resources & Recruitment', 'srv-008', 'Staffing, payroll, talent acquisition', 208),
  ('SRV-009', 'Services', 'Training & Professional Development', 'srv-009', 'Workshops, corporate training, certifications', 209),
  ('SRV-010', 'Services', 'Security & Investigation Services', 'srv-010', 'Security guards, monitoring, investigations', 210),
  ('SRV-011', 'Services', 'Cleaning & Janitorial Services', 'srv-011', 'Office cleaning, sanitation, deep cleaning', 211),
  ('SRV-012', 'Services', 'Waste Management & Recycling', 'srv-012', 'Waste collection, recycling, disposal', 212),
  ('SRV-013', 'Services', 'Transportation & Logistics', 'srv-013', 'Haulage, courier, freight, delivery', 213),
  ('SRV-014', 'Services', 'Warehousing & Distribution', 'srv-014', 'Storage, inventory handling, distribution', 214),
  ('SRV-015', 'Services', 'Event Planning & Management', 'srv-015', 'Conferences, corporate events, event coordination', 215),
  ('SRV-016', 'Services', 'Catering & Hospitality', 'srv-016', 'Food services, corporate catering, accommodation', 216),
  ('SRV-017', 'Services', 'Travel & Tourism Services', 'srv-017', 'Corporate travel, tour operations, travel management', 217),
  ('SRV-018', 'Services', 'Research & Data Analytics', 'srv-018', 'Market research, surveys, data analysis', 218),
  ('SRV-019', 'Services', 'Engineering & Technical Consulting', 'srv-019', 'Engineering design, inspections, technical assessments', 219),
  ('SRV-020', 'Services', 'Architecture & Quantity Surveying', 'srv-020', 'Architectural services, cost estimation, surveying', 220),
  ('SRV-021', 'Services', 'Property & Facilities Management', 'srv-021', 'Building management, maintenance contracts', 221),
  ('SRV-022', 'Services', 'Healthcare & Occupational Health', 'srv-022', 'Medical services, workplace wellness, health screening', 222),
  ('SRV-023', 'Services', 'Insurance & Risk Management', 'srv-023', 'Insurance brokerage, risk assessments', 223),
  ('SRV-024', 'Services', 'Environmental & Sustainability Consulting', 'srv-024', 'Environmental assessments, ESG reporting', 224),
  ('SRV-025', 'Services', 'Agriculture & Agribusiness Services', 'srv-025', 'Farm management, crop services, agricultural consulting', 225),
  ('SRV-026', 'Services', 'Customer Service & BPO', 'srv-026', 'Call centres, customer support, outsourcing', 226),
  ('SRV-027', 'Services', 'Administrative & Office Support', 'srv-027', 'Data entry, transcription, virtual assistance', 227),
  ('SRV-028', 'Services', 'Financial & Payment Services', 'srv-028', 'Payment processing, financial advisory', 228),
  ('SRV-029', 'Services', 'Equipment & Vehicle Maintenance', 'srv-029', 'Fleet servicing, machinery and equipment repairs', 229),
  ('SRV-030', 'Services', 'Pest Control & Fumigation', 'srv-030', 'Pest management, commercial fumigation', 230),
  ('GDS-001', 'Goods & Supplies', 'Office Supplies & Stationery', 'gds-001', 'Paper, stationery, printer cartridges', 301),
  ('GDS-002', 'Goods & Supplies', 'Computers & IT Equipment', 'gds-002', 'Laptops, servers, printers, accessories', 302),
  ('GDS-003', 'Goods & Supplies', 'Telecommunications Equipment', 'gds-003', 'Phones, routers, network devices', 303),
  ('GDS-004', 'Goods & Supplies', 'Furniture & Fixtures', 'gds-004', 'Office furniture, shelving, fittings', 304),
  ('GDS-005', 'Goods & Supplies', 'Construction Materials', 'gds-005', 'Cement, steel, lumber, aggregates', 305),
  ('GDS-006', 'Goods & Supplies', 'Electrical Supplies', 'gds-006', 'Cables, lighting, electrical components', 306),
  ('GDS-007', 'Goods & Supplies', 'Plumbing & Hardware Supplies', 'gds-007', 'Pipes, fittings, tools', 307),
  ('GDS-008', 'Goods & Supplies', 'Machinery & Industrial Equipment', 'gds-008', 'Manufacturing machinery, generators', 308),
  ('GDS-009', 'Goods & Supplies', 'Vehicles & Automotive Parts', 'gds-009', 'Fleet vehicles, tyres, spare parts', 309),
  ('GDS-010', 'Goods & Supplies', 'Safety & Protective Equipment', 'gds-010', 'PPE, safety footwear, helmets', 310),
  ('GDS-011', 'Goods & Supplies', 'Cleaning & Sanitation Supplies', 'gds-011', 'Detergents, chemicals, hygiene products', 311),
  ('GDS-012', 'Goods & Supplies', 'Food, Beverages & Groceries', 'gds-012', 'Food products, bulk supplies, beverages', 312),
  ('GDS-013', 'Goods & Supplies', 'Agricultural Products & Equipment', 'gds-013', 'Seeds, fertilizers, farm equipment', 313),
  ('GDS-014', 'Goods & Supplies', 'Medical & Laboratory Supplies', 'gds-014', 'Medical equipment, diagnostic supplies', 314),
  ('GDS-015', 'Goods & Supplies', 'Uniforms, Clothing & Textiles', 'gds-015', 'Staff uniforms, workwear, fabrics', 315),
  ('GDS-016', 'Goods & Supplies', 'Promotional & Branded Merchandise', 'gds-016', 'Signage, banners, branded items', 316),
  ('GDS-017', 'Goods & Supplies', 'Packaging & Printing Supplies', 'gds-017', 'Cartons, labels, bags, packaging', 317),
  ('GDS-018', 'Goods & Supplies', 'Renewable Energy Equipment', 'gds-018', 'Solar panels, inverters, batteries', 318),
  ('GDS-019', 'Goods & Supplies', 'Security & Surveillance Equipment', 'gds-019', 'CCTV cameras, alarms, access controls', 319),
  ('GDS-020', 'Goods & Supplies', 'Hospitality & Restaurant Supplies', 'gds-020', 'Kitchen equipment, linens, tableware', 320),
  ('GDS-021', 'Goods & Supplies', 'Water & Environmental Equipment', 'gds-021', 'Water tanks, pumps, filtration systems', 321);
