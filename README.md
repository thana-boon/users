# SchoolOS — Student & Teacher Records

โมดูลจัดการข้อมูล **นักเรียนและครู** (standalone) ของโรงเรียนสุขนธีรวิทย์ (SKDW).
Next.js + TypeScript + Drizzle ORM + **PostgreSQL** · UI ตาม `SKDW-CI.md` · รันบน **พอร์ต 3002**.

การเข้าถึงโมดูลนี้จำกัดเฉพาะ role **`teacher-admin`** เท่านั้น (RBAC บังคับที่ middleware + ทุก API route).

---

## เริ่มใช้งานเร็ว (local, Docker)

```bash
# 1) ตั้งค่า env (มี .env ตัวอย่างพร้อมคีย์ dev ให้แล้ว — ห้ามใช้คีย์ชุดนี้ใน prod)
cp .env.example .env    # ถ้ายังไม่มี .env

# 2) ยก PostgreSQL ขึ้น (ฐานข้อมูลชื่อ "users")
docker compose up -d postgres

# 3) สร้างตารางจาก Drizzle schema
npm install
npm run db:push

# 4) รัน dev server
npm run dev             # http://localhost:3002
```

เปิด `http://localhost:3002` → ถูก redirect ไป `/login` → เลือก **teacher-admin** → เข้าสู่ระบบ.

> ระบบเริ่มต้นด้วยฐานข้อมูล **ว่าง** (ไม่มีการ seed ข้อมูลตัวอย่าง) — นำเข้าข้อมูลเองผ่านหน้า
> "นักเรียน" / "ครู" ปุ่ม **นำเข้า** (ไฟล์ `.xlsx` ตามเทมเพลตในระบบ)

### รันทั้งสแตกด้วย Docker (app + db)

```bash
docker compose up --build   # app ที่ :3002, postgres ที่ :5432
# แล้วรัน db:push ชี้ DATABASE_URL ไปที่ localhost:5432 หนึ่งครั้ง
```

### (ทางเลือก) นำเข้าข้อมูลตัวอย่างจากสคริปต์
ถ้าต้องการโหลดไฟล์ตัวอย่างใน `.example/` แบบ bulk แทนการ import ทีละไฟล์:
```bash
npm run seed            # = seed:teachers แล้ว seed:students
```

---

## Environment (`.env`)

| ตัวแปร | หน้าที่ |
|---|---|
| `DATABASE_URL` | Postgres DSN (`postgres://user:pass@host:5432/users`) |
| `FIELD_ENCRYPTION_KEY` | คีย์ AES-256-GCM (base64 32 ไบต์) — **อยู่นอก DB**. gen: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `JWT_SECRET` | shared secret ของ mock JWT (HMAC) |
| `JWT_ISSUER` / `JWT_EXPIRES_IN` | ค่า iss / อายุ token (ดีฟอลต์ `schoolos` / `8h`) |
| `ENABLE_DEV_TOKEN` | `true` = เปิด `/api/auth/dev-token` (mock login). **ตั้ง `false` เมื่อต่อ SSO จริง** |
| `STUDENT_EMAIL_DOMAIN` | โดเมนอีเมลนักเรียน (ดีฟอลต์ `sukhon.ac.th`) |

---

## สถาปัตยกรรมโดยย่อ

### Data model (Drizzle → PostgreSQL)
Normalize: identity อยู่ใน `students` ครั้งเดียว, ชั้น/ห้องอยู่ต่อปีการศึกษาใน `enrollments`
(unique `student_id + academic_year_id`). ตารางลูก: `student_addresses` (4 ประเภท), `guardians`
(guardian/father/mother), `previous_schools`, `student_health`, `teachers`, `audit_logs`.
`academic_years`/`enrollments` ใช้ **soft-delete** (`is_archived`) — ไม่ hard-delete เพื่อคง `enrollment_id`
ที่ระบบปลายน้ำ (เช่น ScoreBridge) อ้างถึง.

### ความปลอดภัยข้อมูล / PDPA
- ฟิลด์อ่อนไหว (`password`, `citizen_id`, `income`) เก็บเป็น **ciphertext AES-256-GCM** — คีย์อยู่ใน env.
  เลือก reversible encryption (ไม่ hash) เพราะ admin ต้อง "ดูรหัสผ่านจริง" คืนให้เจ้าของได้.
- decrypt ได้เฉพาะ `teacher-admin` ผ่าน endpoint `/reveal` และ **บันทึก audit log ทุกครั้ง**
  (ใคร / เมื่อไร / ของใคร / ฟิลด์ไหน) — ดูได้ที่หน้า "บันทึกการใช้งาน".
- List/detail API ไม่เคยส่ง ciphertext ออก — เลขบัตรถูก mask, รหัสผ่านไม่ส่ง, รายได้เป็น flag.

### Auth & RBAC
- Mock JWT (jose/HS256) สำหรับ dev — สลับเป็น SSO จริงตอน deploy โดย auth layer แยกจาก business logic.
- Middleware (edge) verify token แบบ **fail-closed** และรับเฉพาะ `teacher-admin` บน `/users/**` และ `/api/users/**`.
- Login API สาธารณะสำหรับนักเรียน/ครู (`/api/auth/{student,teacher}-login`) — decrypt แล้วเทียบรหัสผ่าน,
  มี rate-limit + lockout, ออก JWT ตาม role จริง. token `teacher`/`student` ผ่าน login ได้แต่ถูกโมดูลนี้ปฏิเสธ.

---

## โครงสร้างเส้นทาง

```
/login                         หน้า dev login (mock JWT)
/users                         dashboard ภาพรวมปีปัจจุบัน
/users/students                รายการ/ค้นหา/กรอง + เพิ่ม/นำเข้า/ส่งออก
/users/students/[id]           รายละเอียด/แก้ไข/reveal ข้อมูลอ่อนไหว
/users/teachers                รายการครู + จัดการ role
/users/teachers/[id]           รายละเอียด/แก้ไข/เปลี่ยน role/reveal
/users/academic-years          ตั้งปีปัจจุบัน / เก็บถาวร (soft-delete)
/users/audit                   บันทึกการใช้งาน (audit log)

/api/auth/{dev-token,student-login,teacher-login,logout,session}
/api/users/{students,teachers,academic-years,dashboard,meta,audit}
/api/users/students/{export,template,import,[id],[id]/reveal}
/api/users/teachers/{export,template,import,[id],[id]/reveal}
```

---

## นำเข้า / ส่งออก
- **Export** `.xlsx` โครงสร้าง 157 คอลัมน์ (นักเรียน) / 11 คอลัมน์ (ครู) — export → แก้ → re-import ได้.
  เป็นการ export PII (decrypt) จึง **audit log** ทุกครั้ง.
- **Import** ตรวจสอบทุกแถวก่อน (เลขบัตร 13 หลัก+checksum, รหัสซ้ำ, ฟิลด์บังคับ) แล้ว
  **รายงานแถวที่ผิดพลาดก่อน commit** — โหมด `dryRun=true` ตรวจอย่างเดียว.
- ครู: `Password` ใน CSV เป็น plain text → **encrypt ตอน import**; นำเข้าใหม่เป็น `role=teacher` เสมอ
  (การเลื่อนเป็น teacher-admin ทำผ่าน UI ไม่ hardcode).

---

## สคริปต์ที่มีให้

| คำสั่ง | หน้าที่ |
|---|---|
| `npm run dev` | dev server (พอร์ต 3002) |
| `npm run build` / `start` | production build / start |
| `npm run typecheck` | tsc --noEmit |
| `npm run db:push` | สร้าง/อัปเดตตารางจาก schema |
| `npm run db:generate` / `db:migrate` | สร้าง/รัน SQL migration |
| `npm run seed` | (ทางเลือก) นำเข้า `.example/teachers.xlsx` + `students.xlsx` |

---

## หมายเหตุการ deploy
1. สร้าง `FIELD_ENCRYPTION_KEY` และ `JWT_SECRET` ใหม่ (ห้ามใช้ค่าใน repo).
2. ตั้ง `ENABLE_DEV_TOKEN=false` และต่อ SSO จริงเข้ากับ auth layer (`src/lib/jwt.ts` / `middleware.ts`).
3. คีย์เข้ารหัสเก็บใน secret manager แยกจากฐานข้อมูลเสมอ.
