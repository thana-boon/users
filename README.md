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

เปิด `http://localhost:3002` → ถูก redirect ไป `/login` → กรอก **รหัสครู + รหัสผ่าน** ของบัญชี **teacher-admin** → เข้าสู่ระบบ.

> ระบบเริ่มต้นด้วยฐานข้อมูล **ว่าง** (ไม่มีการ seed ข้อมูลตัวอย่าง) — นำเข้าข้อมูลเองผ่านหน้า
> "นักเรียน" / "ครู" ปุ่ม **นำเข้า** (ไฟล์ `.xlsx` ตามเทมเพลตในระบบ)

### รันด้วย Docker (app อย่างเดียว — ใช้ DB ของเซิร์ฟเวอร์)

สแตกนี้ **ไม่สร้าง Postgres เอง** แต่ต่อเข้ากับคอนเทนเนอร์ `postgres-core` ที่มีอยู่แล้ว
ผ่านเน็ตเวิร์ก external `school-net` โดยใช้ role/database ชื่อ `users`

```bash
docker compose up -d --build   # app ที่ :3002
```

รันจบในคำสั่งเดียว ไม่ต้องยืนยันอะไร — ลำดับคือ `migrate` (push schema, `--force`) → `app`

**บัญชีแอดมินแรกสร้างอัตโนมัติ** โดยตัวแอปเองตอนบูต (`src/instrumentation.ts` →
`src/lib/bootstrap.ts`): ถ้าใน DB **ยังไม่มี** teacher-admin ที่ใช้งานอยู่เลย จะสร้างจาก
`SEED_ADMIN_*` ใน `.env` ให้หนึ่งบัญชี ถ้ามีอยู่แล้วจะไม่แตะต้องอะไรทั้งสิ้น
(รหัสที่ผู้ใช้เปลี่ยนเองจึงไม่ถูกรีเซ็ตตอน redeploy) และถ้าล้มเหลวก็แค่ log ไว้ ไม่ทำให้แอปดับ

> เดิมขั้นตอนนี้เป็น service `seed-admin` ใน compose — **ถอดออกแล้ว** เพราะการผูก bootstrap
> ไว้กับ deploy ทำให้ทั้ง stack ล้มเมื่อมันพลาด (Portainer ขึ้น
> `service "seed-admin" didn't complete successfully: exit 1`)

ถ้า**ลืมรหัสแอดมิน** (auto-bootstrap ช่วยไม่ได้ เพราะมันสร้างให้เฉพาะตอนไม่มีแอดมินเลย)
ให้ยืม service `seed` มารันสคริปต์ — มันสร้างจาก image `migrator` จึงมี tsx + `scripts/`
ซึ่ง image ของ `app` ไม่มี:
```bash
docker compose run --rm seed npm run admin:create -- T00001 "newPass"
```

### (ทางเลือก) นำเข้าข้อมูลตัวอย่างจากสคริปต์ (seed)
> ⚠️ ไฟล์ `.example/*.xlsx` เป็น **PII** จึง **ไม่อยู่ใน git และไม่อยู่ใน docker image** —
> ต้องนำไฟล์มาวางที่ `./.example/` บนเครื่องเป้าหมายเอง (ส่งแยกจาก git)

**บน host (dev):**
```bash
npm run seed            # = seed:teachers แล้ว seed:students
```

**ใน Docker (ปลายทาง):** service `seed` จะ bind-mount `./.example` เข้า container ตอนรัน
(ไฟล์ไม่เข้า image) — วาง `teachers.xlsx` + `students.xlsx` ไว้ที่ `./.example/` แล้ว:
```bash
docker compose run --rm seed
```
seed จะตั้ง `T00116` + `T00241` เป็น `teacher-admin` ให้อัตโนมัติ

---

## Environment (`.env`)

| ตัวแปร | หน้าที่ |
|---|---|
| `DATABASE_URL_INTERNAL` | DSN ที่ compose ใช้ — host = ชื่อคอนเทนเนอร์ DB (`postgres://users:...@postgres-core:5432/users`) |
| `DATABASE_URL` | DSN สำหรับรันบน host (`npm run dev`) — `postgres://users:...@localhost:5432/users` |
| `SEED_ADMIN_CODE` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | บัญชี teacher-admin แรกที่แอปสร้างให้ตอนบูต **เฉพาะเมื่อยังไม่มีแอดมินใน DB** (NAME ไม่บังคับ) |
| `FIELD_ENCRYPTION_KEY` | คีย์ AES-256-GCM (base64 32 ไบต์) — **อยู่นอก DB**. gen: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `JWT_SECRET` | secret สำหรับเซ็น session token ของแอป (HS256) |
| `JWT_EXPIRES_IN` | อายุ token (ดีฟอลต์ `8h`) |
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
- **Local login เท่านั้น** (ไม่มี SSO ภายนอก) — แอปเซ็น session JWT ของตัวเอง (jose/HS256) ตอนล็อกอิน.
- Middleware (edge) verify token แบบ **fail-closed** และรับเฉพาะ `teacher-admin` บน `/users/**` และ `/api/users/**`.
- Login API สาธารณะสำหรับนักเรียน/ครู (`/api/auth/{student,teacher}-login`) — decrypt แล้วเทียบรหัสผ่าน,
  มี rate-limit + lockout, ออก JWT ตาม role จริง. token `teacher`/`student` ผ่าน login ได้แต่ถูกโมดูลนี้ปฏิเสธ.

---

## โครงสร้างเส้นทาง

```
/login                         หน้าเข้าสู่ระบบ (รหัสครู + รหัสผ่าน)
/users                         dashboard ภาพรวมปีปัจจุบัน
/users/students                รายการ/ค้นหา/กรอง + เพิ่ม/นำเข้า/ส่งออก
/users/students/[id]           รายละเอียด/แก้ไข/reveal ข้อมูลอ่อนไหว
/users/teachers                รายการครู + จัดการ role
/users/teachers/[id]           รายละเอียด/แก้ไข/เปลี่ยน role/reveal
/users/academic-years          ตั้งปีปัจจุบัน / เก็บถาวร (soft-delete)
/users/audit                   บันทึกการใช้งาน (audit log)

/api/auth/{student-login,teacher-login,logout,session}
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
  (การเลื่อนเป็น teacher-admin ทำผ่าน UI). หมายเหตุ: สคริปต์ `npm run seed:teachers` ตั้ง
  `T00116` และ `T00241` เป็น `teacher-admin` ให้อัตโนมัติ (ที่เหลือเป็น `teacher`).

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
2. คีย์เข้ารหัสเก็บใน secret manager แยกจากฐานข้อมูลเสมอ.
