-- ลบอักขระคั่นที่ค้างหัว-ท้ายเบอร์โทร (เช่น "0812345678-" ที่ติดมาจากการ import ครั้งแรก)
--
-- ใช้เมื่อรัน `npm run fix:phones` ไม่ได้ — เช่นบนเซิร์ฟเวอร์ production ที่มีแต่
-- pgAdmin / Portainer console ไม่มี Node
--
-- ทำอะไร: ตัดอักขระคั่น (เว้นวรรค - . , ; : / |) ที่หัวและท้ายเท่านั้น
--   '0812345678-'   -> '0812345678'
--   ' 02-123-4567 ' -> '02-123-4567'   (ขีดตรงกลางไม่ถูกแตะ — คนเขียนเบอร์แบบนี้)
--   '-'             -> NULL            (มีแต่เครื่องหมาย ไม่ใช่เบอร์)
-- ไม่เพิ่ม ไม่ลบ ไม่สลับตัวเลขใด ๆ — กติกาเดียวกับ normalizePhone() ใน src/lib/phone.ts
--
-- รันซ้ำได้ไม่เสียหาย รอบที่สองจะแก้ 0 แถว
--
-- วิธีใช้:
--   1. รัน "ขั้นที่ 1" ก่อน เพื่อดูว่าจะแก้กี่แถว
--   2. พอใจแล้วค่อยรัน "ขั้นที่ 2"
--   3. รัน "ขั้นที่ 3" เพื่อตรวจว่าสะอาดแล้ว

-- ตัวคั่นที่ถือว่าเป็น "ขยะหัวท้าย" ใช้ชุดเดียวกันทุกที่ในไฟล์นี้
-- POSIX class [[:space:]] ครอบคลุมทั้ง space / tab / newline


-- ==========================================================
-- ขั้นที่ 1 — ดูก่อน (อ่านอย่างเดียว ไม่เขียนอะไรทั้งสิ้น)
-- ==========================================================
select 'students.phone'                     as คอลัมน์, count(*) as ต้องแก้ from students           where phone               ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
union all select 'student_addresses.phone',               count(*) from student_addresses where phone               ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
union all select 'student_addresses.emergency_phone',     count(*) from student_addresses where emergency_phone     ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
union all select 'student_addresses.nearby_friend_phone', count(*) from student_addresses where nearby_friend_phone ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
union all select 'guardians.home_phone',                  count(*) from guardians        where home_phone          ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
union all select 'guardians.mobile_phone',                count(*) from guardians        where mobile_phone        ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
union all select 'guardians.work_phone',                  count(*) from guardians        where work_phone          ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
union all select 'teachers.phone',                        count(*) from teachers         where phone               ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
union all select 'workers.phone',                         count(*) from workers          where phone               ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
union all select 'special_teachers.phone',                count(*) from special_teachers where phone               ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$';

-- ตัวอย่างค่าที่จะเปลี่ยน (ดูให้สบายใจก่อนเขียนจริง)
select id, student_code, phone as ก่อน,
       nullif(regexp_replace(phone, '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$', '', 'g'), '') as หลัง
from students
where phone ~ '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$'
order by id
limit 20;


-- ==========================================================
-- ขั้นที่ 2 — เขียนจริง
-- ==========================================================
-- ทั้งหมดอยู่ใน transaction เดียว ถ้าพังกลางคัน จะไม่มีอะไรถูกแก้เลย
begin;

-- สำรองค่าเดิมไว้ในตารางชั่วคราว เผื่อต้องย้อน (ดูท้ายไฟล์)
create table if not exists _phone_fix_backup (
  fixed_at  timestamptz not null default now(),
  tbl       text        not null,
  col       text        not null,
  row_id    integer     not null,
  old_value text
);

do $$
declare
  r record;
  sep constant text := '^[[:space:]\-.,;:/|]+|[[:space:]\-.,;:/|]+$';
begin
  for r in
    select * from (values
      ('students',          'phone'),
      ('student_addresses', 'phone'),
      ('student_addresses', 'emergency_phone'),
      ('student_addresses', 'nearby_friend_phone'),
      ('guardians',         'home_phone'),
      ('guardians',         'mobile_phone'),
      ('guardians',         'work_phone'),
      ('teachers',          'phone'),
      ('workers',           'phone'),
      ('special_teachers',  'phone')
    ) as t(tbl, col)
  loop
    -- ข้ามคอลัมน์ที่ยังไม่มีในสคีมานี้ แทนที่จะพังทั้งชุด
    if not exists (
      select 1 from information_schema.columns
      where table_name = r.tbl and column_name = r.col
    ) then
      raise notice 'ข้าม %.% (ไม่มีคอลัมน์นี้)', r.tbl, r.col;
      continue;
    end if;

    execute format(
      'insert into _phone_fix_backup (tbl, col, row_id, old_value)
       select %L, %L, id, %I from %I where %I ~ %L',
      r.tbl, r.col, r.col, r.tbl, r.col, sep
    );

    execute format(
      'update %I set %I = nullif(regexp_replace(%I, %L, '''', ''g''), '''') where %I ~ %L',
      r.tbl, r.col, r.col, sep, r.col, sep
    );

    raise notice 'แก้ %.% แล้ว', r.tbl, r.col;
  end loop;
end $$;

commit;


-- ==========================================================
-- ขั้นที่ 3 — ตรวจหลังแก้ (ควรได้ 0 ทุกบรรทัด ยกเว้นบรรทัดสุดท้าย)
-- ==========================================================
select 'ยังลงท้ายด้วยอักขระที่ไม่ใช่ตัวเลข' as ตรวจ, count(*) as จำนวน
from students where phone ~ '[^0-9]$'
union all
select 'เบอร์นักเรียนที่ยังมีค่า (ต้องเท่าเดิม ไม่ควรหาย)', count(*)
from students where phone is not null and phone <> '';

-- เช็ครายคน เช่น 07822
select id, student_code, first_name || ' ' || last_name as ชื่อ, phone, length(phone) as ความยาว
from students where student_code = '07822';

-- จำนวนแถวที่ถูกแก้ไปทั้งหมดในรอบนี้
select tbl, col, count(*) as แก้ไป from _phone_fix_backup group by tbl, col order by tbl, col;


-- ==========================================================
-- ถ้าต้องย้อนกลับ (ใช้เฉพาะเมื่อจำเป็น)
-- ==========================================================
-- begin;
-- update students s set phone = b.old_value
--   from _phone_fix_backup b
--   where b.tbl = 'students' and b.col = 'phone' and b.row_id = s.id;
-- commit;
--
-- เมื่อมั่นใจแล้วว่าไม่ต้องย้อน ลบตารางสำรองทิ้งได้:
-- drop table _phone_fix_backup;
