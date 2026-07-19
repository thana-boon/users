# SchoolOS Users — คู่มือการใช้ API Key

เอกสารนี้อธิบายวิธีให้ระบบอื่น (หรือแอปของ dev คนอื่น) เชื่อมต่อกับ **SchoolOS – ทะเบียนนักเรียนและครู** ผ่าน **API Key** เพื่อดึงรายชื่อนักเรียน/ครู และตรวจสอบรหัสผ่าน (ล็อกอิน) โดยไม่ต้องเข้าถึงฐานข้อมูลโดยตรง

> สรุปสั้น: แอดมินออก API Key ให้จากหน้า **API Manager** → dev เอา key ไปแนบใน header ทุก request → เรียก `/api/public/v1/*`

---

## 1. ภาพรวม

- Base path ของ public API คือ `/api/public/v1/*`
- เส้นทางนี้ **อยู่นอก middleware** ของระบบ (ที่บังคับ session ของแอดมิน) — จึงเปิดให้เครื่องต่อเครื่อง (M2M) เรียกได้ด้วย API Key เท่านั้น
- ทุก endpoint ตรวจสิทธิ์แบบ **fail-closed**: ถ้า key ไม่ถูกต้อง/หมดสิทธิ์ จะถูกปฏิเสธเสมอ

**Base URL** (ปรับตาม deployment จริง):

| สภาพแวดล้อม | ตัวอย่าง Base URL |
|---|---|
| Docker / production | `http://<host>:3002` |
| Dev (npm run dev) | `http://localhost:3000` (หรือพอร์ตที่ dev server แจ้ง) |

ตัวอย่างในเอกสารใช้ `https://schoolos.example.ac.th` แทน base URL จริง

---

## 2. การขอ / ออก API Key (สำหรับแอดมิน)

Key ออกได้จาก UI เท่านั้น — dev ที่ต้องการ key ให้แจ้งแอดมินระบบ

1. ล็อกอินเป็นครูที่มีสิทธิ์ `users:write` (`teacher-admin`)
2. ไปที่เมนู **API Manager** (`/users/api-manager`)
3. กด **สร้าง API Key ใหม่** แล้วกรอก:
   - **ชื่อ** (name) — ใช้ระบุว่า key นี้ให้ระบบไหน เช่น `ระบบห้องสมุด`, `แอปผู้ปกครอง`
   - **Scopes** — สิทธิ์ที่จะให้ (ดูตารางข้อ 4) เลือกเท่าที่จำเป็น
   - **วันหมดอายุ** (ไม่บังคับ) — เว้นว่าง = ไม่หมดอายุ
4. ระบบจะแสดง key เต็ม **`sk_live_...`** ให้ **คัดลอกทันที** แล้วส่งให้ dev ผ่านช่องทางที่ปลอดภัย

> Key สามารถ **เปิดดูซ้ำได้ภายหลัง** (Reveal) โดยแอดมิน แต่ทุกครั้งจะถูกบันทึกลง audit log (`reveal_api_key`) เพราะฉะนั้นควรเก็บ key ไว้ในฝั่ง dev เอง อย่าพึ่งพาการเปิดดูซ้ำ

### การจัดการ key ที่ออกไปแล้ว
- **ปิดใช้งาน (Revoke)** — key ใช้ไม่ได้ทันที (คืนค่า `403 key_revoked`); เปิดกลับได้
- **หมุน key (Rotate)** — สร้างค่าใหม่ ทำให้ key เดิมใช้ไม่ได้ทันที ใช้เมื่อ key รั่ว
- **Usage** — ระบบเก็บ `usageCount`, `lastUsedAt`, `lastUsedIp` ให้ตรวจการใช้งานได้

---

## 3. การส่ง API Key ในทุก request (สำหรับ dev)

แนบ key ได้ **สองแบบ** (เลือกอย่างใดอย่างหนึ่ง):

```http
X-API-Key: sk_live_xxxxxxxxxxxxxxxxxxxx
```

หรือ

```http
Authorization: Bearer sk_live_xxxxxxxxxxxxxxxxxxxx
```

> เฉพาะค่าที่ขึ้นต้นด้วย `sk_live_` เท่านั้นที่ถูกตีความเป็น API Key — token อื่นที่ส่งมาแบบ Bearer จะไม่ถูกสับสนกับ key

**ตัวอย่าง curl:**

```bash
curl -H "X-API-Key: sk_live_xxxxxxxxxxxxxxxxxxxx" \
  "https://schoolos.example.ac.th/api/public/v1/students?grade=ม.1&pageSize=50"
```

---

## 4. Scopes (สิทธิ์)

เลือกเฉพาะที่จำเป็น — `:pii` และ `auth:*` เป็นสิทธิ์อ่อนไหว

| Scope | อนุญาตให้ทำ | หมายเหตุ |
|---|---|---|
| `students:read` | อ่านรายชื่อนักเรียน (identity + ชั้น/ห้อง) | ไม่รวมข้อมูลอ่อนไหว |
| `students:pii` | อ่าน **เลขบัตร ปชช.** นักเรียน | ต้องมี `students:read` ด้วย · ทุกครั้งถูก audit |
| `teachers:read` | อ่านรายชื่อครู | ไม่รวมข้อมูลอ่อนไหว |
| `teachers:pii` | อ่าน **เลขบัตร ปชช.** ครู | ต้องมี `teachers:read` ด้วย · ทุกครั้งถูก audit |
| `auth:students` | ตรวจรหัสผ่าน**นักเรียน** (ล็อกอิน) | ผ่าน `/auth/verify` |
| `auth:teachers` | ตรวจรหัสผ่าน**ครู** (ล็อกอิน) | ผ่าน `/auth/verify` |

**หลักการสำคัญ:**
- `:pii` เป็น **สิทธิ์เสริม (additive)** — ต้องมี `:read` คู่กันเสมอ ถึงจะได้เลขบัตร ปชช. กลับมาในผลลัพธ์
- **รหัสผ่านและรูปภาพ (`password`, `photo_base64`) ไม่ถูกส่งกลับทุกกรณี** ไม่ว่ามี scope อะไร
- `auth:students` / `auth:teachers` แยกกัน — ระบบที่ให้บริการเฉพาะนักเรียนจะทดสอบรหัสผ่านครูไม่ได้

---

## 5. Endpoints

### 5.1 ตรวจสอบ key ของตัวเอง — `GET /api/public/v1/me`

ใช้ debug ว่า key ใช้ได้ไหมและมี scope อะไร **ไม่แตะข้อมูลจริง** และไม่ echo ตัว key กลับมา
> endpoint นี้ตอบสถานะได้แม้ key หมดอายุ/ถูกปิด (จะบอกสถานะ ไม่ปฏิเสธ)

```bash
curl -H "X-API-Key: sk_live_..." \
  https://schoolos.example.ac.th/api/public/v1/me
```

```json
{
  "authenticated": true,
  "type": "api_key",
  "name": "ระบบห้องสมุด",
  "keyPrefix": "sk_live_9f3c",
  "scopes": ["students:read"],
  "status": "active",
  "expiresAt": null,
  "lastUsedAt": "2026-07-19T03:12:00.000Z",
  "usageCount": 42
}
```

### 5.2 รายชื่อนักเรียน — `GET /api/public/v1/students`

ต้องมี scope `students:read` (เลขบัตร ปชช. ต้องมี `students:pii` เพิ่ม)

**Query parameters:**

| พารามิเตอร์ | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `yearId` | ปีการศึกษาปัจจุบัน | id ปีการศึกษา |
| `grade` | — | ชั้น เช่น `ม.1` |
| `classroom` | — | ห้อง เช่น `1` |
| `status` | `studying` | `studying` \| `withdrawn` \| `graduated` \| `all` |
| `q` | — | ค้นหาชื่อ/นามสกุล/รหัส |
| `page` | `1` | หน้า |
| `pageSize` | `50` | จำนวนต่อหน้า (สูงสุด `200`) |

```bash
curl -H "X-API-Key: sk_live_..." \
  "https://schoolos.example.ac.th/api/public/v1/students?grade=ม.1&status=studying&page=1&pageSize=50"
```

**Response:**

```json
{
  "data": [
    {
      "id": 123,
      "studentCode": "10234",
      "prefix": "เด็กชาย",
      "firstName": "สมชาย",
      "lastName": "ใจดี",
      "fullName": "เด็กชายสมชาย ใจดี",
      "nickname": "ชาย",
      "firstNameEn": "Somchai",
      "lastNameEn": "Jaidee",
      "gender": "ชาย",
      "birthDate": "2013-05-01",
      "email": null,
      "phone": null,
      "status": "studying",
      "gradeLevel": "ม.1",
      "classroom": "1",
      "classNumber": 5
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 1200,
  "academicYear": { "id": 3, "year": "2568" }
}
```

> ถ้า key มี scope `students:pii` แต่ละรายการจะมีฟิลด์เพิ่ม `"citizenId": "1103700xxxxxx"` และการเรียกครั้งนั้นจะถูกบันทึกใน audit log

### 5.3 รายชื่อครู — `GET /api/public/v1/teachers`

ต้องมี scope `teachers:read` (เลขบัตร ปชช. ต้องมี `teachers:pii` เพิ่ม)

**Query parameters:** `subjectGroup`, `role` (`teacher` \| `teacher-admin`), `status` (`active` \| `resigned` \| `all`, ค่าเริ่มต้น `active`), `q`, `page`, `pageSize` (สูงสุด `200`)

```bash
curl -H "X-API-Key: sk_live_..." \
  "https://schoolos.example.ac.th/api/public/v1/teachers?status=active"
```

```json
{
  "data": [
    {
      "id": 7,
      "teacherCode": "T00116",
      "prefix": "นาย",
      "firstName": "อาทิตย์",
      "lastName": "แสงทอง",
      "fullName": "นายอาทิตย์ แสงทอง",
      "email": "artit@example.ac.th",
      "subjectGroup": "คณิตศาสตร์",
      "gradeTaught": "ม.ปลาย",
      "role": "teacher-admin",
      "employmentStatus": "active"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 110
}
```

### 5.4 ตรวจรหัสผ่าน (ล็อกอิน) — `POST /api/public/v1/auth/verify`

ให้ระบบอื่นใช้ล็อกอินด้วยบัญชีของ SchoolOS **นี่คือ endpoint ตรวจสอบ ไม่ใช่ตัวออก token** — ระบบผู้เรียกต้องสร้าง session ของตัวเอง (ไม่มีการแชร์ JWT secret ให้ใคร)

ต้องมี scope `auth:students` หรือ `auth:teachers` ตาม `role` ที่ส่งมา

**Body (JSON):**

```json
{ "role": "student", "username": "10234", "password": "รหัสผ่าน" }
```

- `role`: `student` หรือ `teacher`
- `username`: นักเรียน = รหัสนักเรียน **หรือ** อีเมล; ครู = รหัสครู
- `Content-Type: application/json`

```bash
curl -X POST \
  -H "X-API-Key: sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"role":"teacher","username":"T00116","password":"secret"}' \
  https://schoolos.example.ac.th/api/public/v1/auth/verify
```

**สำเร็จ (200):**

```json
{
  "valid": true,
  "user": {
    "id": 7,
    "code": "T00116",
    "name": "นายอาทิตย์ แสงทอง",
    "role": "teacher-admin",
    "active": true,
    "status": "active"
  }
}
```

**ล้มเหลว (401):** ข้อความเหมือนกันทั้งกรณี "ไม่มีผู้ใช้" และ "รหัสผ่านผิด" (กันการ enumerate)

```json
{ "valid": false, "error": { "code": "invalid_credentials", "message": "รหัสผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง" } }
```

> **ข้อควรระวัง:** ฟิลด์ `active` (นักเรียน `studying`, ครู `active`) ระบบ **ไม่บังคับ** ให้เอง — นักเรียนที่จบแล้ว/ครูที่ลาออกแล้วก็ยังได้ `valid:true` พร้อม `active:false` ระบบผู้เรียกต้องตรวจ `active` เองว่าจะให้เข้าใช้งานหรือไม่

**Rate limit:** ตรวจรหัสผิดของ username เดิมหลายครั้งจะถูกล็อกชั่วคราว คืนค่า `429 too_many_attempts` พร้อม header `Retry-After` (วินาที)

---

## 6. รหัสข้อผิดพลาด (Error codes)

Error จะอยู่ในรูป `{ "error": { "code": "...", "message": "..." } }`

| HTTP | code | ความหมาย | วิธีแก้ |
|---|---|---|---|
| 401 | `unauthorized` | ไม่ได้ส่ง key มา | แนบ `X-API-Key` หรือ `Authorization: Bearer` |
| 401 | `invalid_key` | key ไม่ถูกต้อง | ตรวจว่าคัดลอกครบ ขึ้นต้น `sk_live_` |
| 403 | `key_revoked` | key ถูกปิดใช้งาน | ให้แอดมินเปิดใช้งาน หรือออก key ใหม่ |
| 403 | `key_expired` | key หมดอายุ | ให้แอดมินหมุน/ต่ออายุ key |
| 403 | `insufficient_scope` | key ไม่มี scope ที่ต้องใช้ | ให้แอดมินเพิ่ม scope |
| 401 | `invalid_credentials` | (auth/verify) รหัสผู้ใช้/รหัสผ่านผิด | — |
| 429 | `too_many_attempts` | (auth/verify) ลองบ่อยเกินไป | รอตาม `Retry-After` |

---

## 7. แนวปฏิบัติที่แนะนำ (Best practices)

- **เก็บ key เป็นความลับ** — วางไว้ใน env / secret manager ฝั่ง server ห้าม commit ลง repo หรือฝังใน client/แอปมือถือ (ใครถอด APK ก็เห็น)
- **ขอ scope เท่าที่ใช้** — ระบบที่ต้องการแค่รายชื่อ อย่าขอ `:pii`
- **เรียก API จากฝั่ง server** ของแอปตัวเอง ไม่ใช่จาก browser/มือถือโดยตรง (กัน key รั่ว + กัน CORS)
- **จัดการ pagination** — วนอ่านด้วย `page` จนครบ `total`; `pageSize` สูงสุด 200
- **เผื่อ error** — จัดการ 401/403/429 ให้ดี โดยเฉพาะ `429` ให้ backoff ตาม `Retry-After`
- **key รั่วให้แจ้งแอดมันหมุน (Rotate) ทันที** — key เดิมจะใช้ไม่ได้ทันที
- ทุกการอ่านเลขบัตร ปชช. และทุกการล็อกอินผ่าน API **ถูกบันทึก audit** attribute เป็น `apikey:<ชื่อ key>` — ตั้งชื่อ key ให้สื่อความหมาย

---

## 8. ตัวอย่างเชิงโค้ด

**Node.js (fetch):**

```js
const BASE = 'https://schoolos.example.ac.th';
const API_KEY = process.env.SCHOOLOS_API_KEY; // sk_live_...

async function getStudents(grade) {
  const res = await fetch(
    `${BASE}/api/public/v1/students?grade=${encodeURIComponent(grade)}&pageSize=200`,
    { headers: { 'X-API-Key': API_KEY } },
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`${res.status} ${err.error?.code}: ${err.error?.message}`);
  }
  return res.json();
}

async function login(username, password) {
  const res = await fetch(`${BASE}/api/public/v1/auth/verify`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'student', username, password }),
  });
  const data = await res.json();
  if (!data.valid) return null;      // รหัสผ่านผิด
  if (!data.user.active) return null; // จบ/ลาออกแล้ว — ระบบผู้เรียกตัดสินใจเอง
  return data.user;
}
```

**Python (requests):**

```python
import os, requests

BASE = "https://schoolos.example.ac.th"
HEADERS = {"X-API-Key": os.environ["SCHOOLOS_API_KEY"]}

def get_teachers(status="active"):
    r = requests.get(f"{BASE}/api/public/v1/teachers",
                     params={"status": status, "pageSize": 200}, headers=HEADERS)
    r.raise_for_status()
    return r.json()["data"]
```
