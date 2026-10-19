-- DEMO DATA ONLY (all fake). Do not run this against a database with real data.

insert into products (name, manufacturer, nafdac_reg_no, active_ingredient, strength) values
 ('Demo Paracetamol Tablets',        'DEMO Pharma Ltd',          'DEMO-A4-0001', 'Paracetamol', '500 mg'),
 ('Demo Amoxicillin Capsules',       'Sample Labs Nigeria Ltd',  'DEMO-A4-0002', 'Amoxicillin', '500 mg'),
 ('Demo Artemether-Lumefantrine',    'Sample Labs Nigeria Ltd',  'DEMO-04-0003', 'Artemether + Lumefantrine', '20/120 mg'),
 ('Demo Ibuprofen Tablets',          'DEMO Pharma Ltd',          'DEMO-A4-0004', 'Ibuprofen', '400 mg'),
 ('Demo ORS Sachet',                 'Example Health Products',  'DEMO-B1-0005', 'Oral rehydration salts', '20.5 g'),
 ('Demo Metformin Tablets',          'Example Health Products',  'DEMO-A4-0006', 'Metformin', '500 mg'),
 ('Demo Ciprofloxacin Tablets',      'Sample Labs Nigeria Ltd',  'DEMO-A4-0007', 'Ciprofloxacin', '500 mg'),
 ('Demo Vitamin C Tablets',          'DEMO Pharma Ltd',          'DEMO-B1-0008', 'Ascorbic acid', '1000 mg');

insert into batches (product_id, batch_no, mfg_date, expiry_date, status)
select p.id, v.batch_no, v.mfg::date, v.exp::date, v.status
from (values
 ('DEMO-A4-0001','PCM-2501','2025-07-01','2028-06-30','ok'),
 ('DEMO-A4-0001','PCM-2301','2023-04-01','2025-03-31','ok'),        -- expired
 ('DEMO-A4-0002','AMX-2602','2026-02-01','2028-01-31','ok'),
 ('DEMO-A4-0002','AMX-2404','2024-10-01','2027-09-30','recalled'),  -- recalled
 ('DEMO-04-0003','ACT-2601','2026-01-15','2028-03-31','ok'),
 ('DEMO-A4-0004','IBU-2503','2025-09-01','2027-12-31','ok'),
 ('DEMO-B1-0005','ORS-2605','2026-05-01','2028-05-31','ok'),
 ('DEMO-A4-0006','MET-2502','2025-08-01','2028-02-28','ok'),
 ('DEMO-A4-0007','CIP-2601','2026-01-10','2028-04-30','ok'),
 ('DEMO-B1-0008','VTC-2602','2026-02-20','2028-08-31','ok'),
 ('DEMO-B1-0008','VTC-2208','2022-08-01','2024-08-31','ok')         -- expired
) as v(reg, batch_no, mfg, exp, status)
join products p on p.nafdac_reg_no = v.reg;

insert into codes (batch_id, code_value)
select b.id, 'VRXDEMO' || lpad(n::text, 5, '0')
from (values
 (1,4,'PCM-2501'),(5,6,'PCM-2301'),(7,9,'AMX-2602'),(10,12,'AMX-2404'),
 (13,15,'ACT-2601'),(16,18,'IBU-2503'),(19,20,'ORS-2605'),(21,23,'MET-2502'),
 (24,26,'CIP-2601'),(27,28,'VTC-2602'),(29,30,'VTC-2208')
) as r(lo, hi, batch_no)
cross join lateral generate_series(r.lo, r.hi) as n
join batches b on b.batch_no = r.batch_no;

-- Scenario: heavily scanned code
update codes set scan_count = 7, first_scanned_at = now() - interval '30 days'
 where code_value = 'VRXDEMO00003';

-- Scenario: possible clone (4 devices, 4 cities)
update codes set scan_count = 4, first_scanned_at = now() - interval '10 days'
 where code_value = 'VRXDEMO00008';
insert into scans (code_value, result, user_id, lat, lng, created_at) values
 ('VRXDEMO00008','VERIFIED', gen_random_uuid(),  6.52,  3.38, now() - interval '10 days'),
 ('VRXDEMO00008','VERIFIED', gen_random_uuid(),  9.07,  7.40, now() - interval '8 days'),
 ('VRXDEMO00008','VERIFIED', gen_random_uuid(), 12.00,  8.52, now() - interval '5 days'),
 ('VRXDEMO00008','VERIFIED', gen_random_uuid(),  4.82,  7.03, now() - interval '2 days');

-- Scenario: admin-confirmed fake, plus two open reports for the triage demo
insert into reports (code_value, product_name_text, notes, status, reporter_id) values
 ('VRXDEMO00014','Demo Artemether-Lumefantrine','Seed: confirmed fake by admin','confirmed_fake', null),
 (null,'Demo Ibuprofen','Seed: packaging colour looked faded','new', null),
 ('VRXDEMO00020','Demo ORS Sachet','Seed: seal was already broken','new', null);