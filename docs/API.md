# SchoolOS Users — คู่มือใช้งาน Public API

เอกสารฉบับเต็มสำหรับ **นักพัฒนาระบบอื่น** ที่ต้องการดึงรายชื่อนักเรียน/ครู รูปภาพ ปีการศึกษา และใช้บัญชีของ SchoolOS ล็อกอิน โดยไม่ต้องต่อฐานข้อมูลตรง

| อยากรู้เรื่อง | อ่านที่ |
|---|---|
| ข้อมูลในระบบนี้จัดโครงสร้างยังไง | ข้อ 1 |
| ขอ API Key ยังไง · แอดมินออก/หมุน/ปิด key ยังไง | ข้อ 2 |
| มี endpoint อะไรบ้าง ส่งอะไร ได้อะไรกลับ | ข้อ 4 |
| **ข้อมูลเปลี่ยนตอนเลื่อนชั้น/ลาออก แล้วระบบผมจะพังไหม** | **ข้อ 5** ← สำคัญที่สุด |
| เขียนโค้ด sync ยังไงให้ถูก | ข้อ 6 |

ทุก endpoint อยู่ใต้ `/api/public/v1/*` และเรียกด้วย **API Key** เท่านั้น (หรือ session ของแอดมินที่มีสิทธิ์ `users:write` สำหรับเปิดดูใน browser)
เส้นทางนี้อยู่ **นอก middleware** ของระบบ (ที่บังคับ session แอดมิน) จึงเปิดให้เครื่องต่อเครื่อง (M2M) เรียกได้ — และตรวจสิทธิ์แบบ **fail-closed** ทุกกรณี: อะไรที่ไม่เข้าเงื่อนไขชัดเจน = ปฏิเสธ

**Base URL** (ปรับตาม deployment จริง):

| สภาพแวดล้อม | ตัวอย่าง |
|---|---|
| Docker / production (ยิงตรงพอร์ต) | `http://<host>:3002` |
| ผ่าน gateway ของโรงเรียน | `https://<gateway>/users` ← **มี `/users` นำหน้าทุก path** |
| Dev (`npm run dev`) | `http://localhost:3000` |

> ตัวอย่างทั้งเอกสารใช้ `https://schoolos.example.ac.th` แทน base URL จริง

**เรื่อง `/users` นำหน้า** — gateway ส่งเฉพาะ `/users/*` มาที่แอปนี้ ดังนั้นเมื่อเรียกผ่าน gateway
ทุก path ต้องมี `/users` นำหน้า (`…/users/api/public/v1/students`) แอปจะถอด prefix ออกให้เอง
ส่วนการยิงตรงพอร์ต 3002 ใช้ path ตามเอกสารได้เลยไม่ต้องเติมอะไร — **ทั้งสองแบบใช้ได้พร้อมกัน**
เลือกตามว่าระบบของคุณเข้าถึงเซิร์ฟเวอร์ทางไหน

---

## 1. แนวคิดของข้อมูล (อ่านก่อน เขียนโค้ดจะง่ายขึ้นมาก)

ระบบนี้แยกข้อมูลเป็น **3 ชั้น** ซึ่งเป็นที่มาของพฤติกรรมเกือบทั้งหมดใน API:

```
   ┌──────────────────────────────────────────────┐
   │  ชั้นที่ 1 — ตัวบุคคล (students / teachers)   │   id, รหัส, ชื่อ, สถานะปัจจุบัน
   │  1 คน = 1 แถว ตลอดชีวิตในระบบ                 │   ← id ไม่เคยเปลี่ยน
   └──────────────────────────────────────────────┘
                    │ 1 : N
   ┌──────────────────────────────────────────────┐
   │  ชั้นที่ 2 — การลงทะเบียนรายปี (enrollments)  │   ปีไหน ชั้นไหน ห้องไหน เลขที่เท่าไร
   │  1 คน = 1 แถว "ต่อปีการศึกษา"                 │   ← เลื่อนชั้น = เพิ่มแถวใหม่
   └──────────────────────────────────────────────┘
                    │
   ┌──────────────────────────────────────────────┐
   │  ชั้นที่ 3 — ปีการศึกษา (academic_years)      │   2568, 2569, ... มีปีเดียวที่ isActive
   └──────────────────────────────────────────────┘
```

**3 ประโยคที่ต้องจำ:**

1. **`id` คือกุญแจถาวร** — ใช้ `id` (หรือ `studentCode` / `teacherCode`) เป็น key ผูกกับระบบคุณ **ห้ามใช้ชื่อ-สกุล หรือ ชั้น/ห้อง เป็น key เด็ดขาด** เพราะสองอย่างหลังเปลี่ยนทุกปี
2. **ชั้น/ห้อง/เลขที่ เป็นข้อมูล "รายปี"** — ค่าที่ API ส่งให้คือของ **ปีที่คุณถาม** (ไม่ระบุ = ปีที่ active อยู่)
3. **สถานะ (`status` / `employmentStatus`) เป็นข้อมูล "ณ วันนี้"** ไม่ใช่รายปี — ถามข้อมูลปี 2567 ก็ยังได้สถานะปัจจุบันติดมา

---

## 2. API Key — ขอ ใช้ และจัดการ

### 2.1 สำหรับแอดมินโรงเรียน — วิธีออก key

Key ออกได้จาก UI เท่านั้น (dev ที่ต้องการ key ให้แจ้งแอดมิน):

1. ล็อกอินเป็นครูที่มีสิทธิ์ `users:write` (role `teacher-admin`)
2. ไปเมนู **API Manager** (`/users/api-manager`)
3. กด **สร้าง API Key ใหม่** แล้วกรอก
   - **ชื่อ** — ระบุว่าให้ระบบไหน เช่น `ระบบห้องสมุด`, `แอปผู้ปกครอง`
     (ชื่อนี้จะไปโผล่ใน audit log เป็น `apikey:<ชื่อ>` — ตั้งให้สื่อความหมาย)
   - **Scopes** — เลือกเท่าที่จำเป็น (ตารางข้อ 3)
   - **วันหมดอายุ** — ไม่บังคับ เว้นว่าง = ไม่หมดอายุ
4. ระบบแสดง key เต็ม `sk_live_…` ให้ **คัดลอกทันที** แล้วส่งให้ dev ผ่านช่องทางที่ปลอดภัย

**จัดการ key ที่ออกไปแล้ว**

| การกระทำ | ผล |
|---|---|
| **Reveal** (เปิดดูซ้ำ) | ดูค่า key เดิมได้ แต่ **ถูกบันทึก audit ทุกครั้ง** (`reveal_api_key`) — ฝั่ง dev ควรเก็บ key เอง อย่าพึ่งการเปิดดูซ้ำ |
| **Revoke** (ปิดใช้งาน) | key ตายทันที (คืน `403 key_revoked`) · เปิดกลับได้ |
| **Rotate** (หมุน) | สร้างค่าใหม่ ค่าเดิมตายทันที — ใช้เมื่อ key รั่ว |
| **Usage** | ระบบเก็บ `usageCount`, `lastUsedAt`, `lastUsedIp` ให้ตรวจย้อนได้ |

### 2.2 สำหรับ dev — เริ่มใน 3 ขั้นตอน

**1) รับ key จากแอดมิน** — ได้ค่าหน้าตาแบบ `sk_live_xxxxxxxx…`

**2) ทดสอบว่า key ใช้ได้** — ยิง `/me` ก่อนเสมอ ไม่แตะข้อมูลจริง

```bash
curl -H "X-API-Key: sk_live_..." https://schoolos.example.ac.th/api/public/v1/me
```

**3) เรียกข้อมูลจริง**

```bash
curl -H "X-API-Key: sk_live_..." \
  "https://schoolos.example.ac.th/api/public/v1/students?grade=ม.1&pageSize=200"
```

แนบ key ได้ 2 แบบ — `X-API-Key: sk_live_...` หรือ `Authorization: Bearer sk_live_...`
(เฉพาะค่าที่ขึ้นต้น `sk_live_` เท่านั้นที่ถือเป็น key — JWT ที่ส่งมาแบบ Bearer จะไม่ถูกสับสน)

---

## 3. Scopes — สิทธิ์ของ key

| Scope | ให้ทำอะไร | หมายเหตุ |
|---|---|---|
| `students:read` | อ่านรายชื่อนักเรียน + ชั้น/ห้อง | พื้นฐาน |
| `students:pii` | อ่าน **เลขบัตร ปชช.** นักเรียน | เสริม — ต้องมี `students:read` ด้วย · **ถูก audit ทุกครั้ง** |
| `students:photo` | ดึง **รูป** นักเรียน | เสริม — ต้องมี `students:read` ด้วย |
| `teachers:read` | อ่านรายชื่อครู + ครูประจำชั้น | ครอบคลุม `/homerooms` ด้วย |
| `teachers:pii` | อ่าน **เลขบัตร ปชช.** ครู | เสริม · ถูก audit ทุกครั้ง |
| `teachers:photo` | ดึง **รูป** ครู | เสริม |
| `workers:read` | อ่านรายชื่อ **คนงาน** (นักการภารโรง ฯลฯ) | แยกจาก `teachers:read` — คนงานเป็นคนละตาราง ไม่มีบัญชีล็อกอิน |
| `workers:pii` | อ่าน **เลขบัตร ปชช.** คนงาน | เสริม · ถูก audit ทุกครั้ง |
| `workers:photo` | ดึง **รูป** คนงาน | เสริม |
| `years:read` | อ่านปีการศึกษา + ช่วงภาคเรียน | ไม่มี PII — ระบบตารางสอน/เช็คชื่อควรได้แค่อันนี้ |
| `auth:students` | ตรวจรหัสผ่าน**นักเรียน** | ผ่าน `/auth/verify` |
| `auth:teachers` | ตรวจรหัสผ่าน**ครู** | แยกจากนักเรียน เพื่อไม่ให้ระบบของเด็กเดารหัสครูได้ |
| `auth:handoff` | แลกโค้ดสานต่อ session ที่ล็อกอินไว้แล้ว | ผ่าน `/auth/handoff/redeem` (ข้อ 4.11) · key ต้องระบุ **ระบบปลายทาง (audience)** ด้วย |

**กฎที่บังคับในโค้ด ไม่ว่ามี scope อะไรก็ตาม:**

- **รหัสผ่านไม่เคยถูกส่งกลับ** ทุกกรณี
- **รูปไม่เคยติดมากับรายชื่อ** (payload จะบวมเป็น 100 เท่า) — ต้องเรียก endpoint รูปแยก
- `:pii` / `:photo` เป็นสิทธิ์ **เสริม** ใช้เดี่ยว ๆ ไม่ได้ ต้องมี `:read` คู่เสมอ

---

## 4. Endpoint ทั้งหมด

| # | Method + Path | Scope | ใช้ตอนไหน |
|---|---|---|---|
| 4.1 | `GET /me` | — | ตรวจว่า key ใช้ได้/มีสิทธิ์อะไร |
| 4.2 | `GET /students` | `students:read` | ดึงรายชื่อนักเรียน |
| 4.3 | `GET /students/{id}` | `students:read` | ดึงนักเรียน **รายคน** + ประวัติทุกปี — ไม่ผูกกับปีการศึกษา |
| 4.4 | `GET /teachers` | `teachers:read` | ดึงรายชื่อครู |
| 4.4b | `GET /workers` | `workers:read` | ดึงรายชื่อคนงาน |
| 4.5 | `GET /academic-years` | `years:read` | ดูปีการศึกษา + ช่วงภาคเรียน |
| 4.6 | `GET /homerooms` | `teachers:read` | ดูครูประจำชั้นรายห้อง |
| 4.7 | `GET /students/{id}/photo`<br>`GET /teachers/{id}/photo`<br>`GET /workers/{id}/photo` | `*:read` + `*:photo` | แสดงรูปทีละคน |
| 4.8 | `GET /students/photos?ids=`<br>`GET /teachers/photos?ids=`<br>`GET /workers/photos?ids=` | `*:read` + `*:photo` | sync รูปจำนวนมาก |
| 4.9 | `POST /auth/verify` | `auth:students` / `auth:teachers` | ให้ผู้ใช้ล็อกอินด้วยบัญชี SchoolOS |
| 4.10 | `GET /api/auth/session` | — (cookie) | เช็คว่า **เบราว์เซอร์นี้ล็อกอินอยู่แล้วหรือยัง** ก่อนโชว์หน้า login ของตัวเอง |
| | `POST /api/auth/refresh` | — (cookie) | ต่ออายุ session เมื่อผู้ใช้ยังทำงานอยู่ในระบบคุณ |
| | `GET`/`POST /api/auth/logout` | — (cookie) | ออกจากระบบทั้งแพลตฟอร์ม |
| 4.11 | `GET /api/auth/handoff` | — (cookie) | ขอโค้ดครั้งเดียว เพื่อส่ง session ต่อให้ **เซิร์ฟเวอร์** ของระบบคุณรู้ด้วย |
| | `POST /auth/handoff/redeem` | `auth:handoff` | เซิร์ฟเวอร์ระบบคุณแลกโค้ดนั้นเป็นตัวตนของผู้ใช้ |

> ข้อ 4.10 และสองบรรทัดใต้มัน **ไม่ได้อยู่ใต้ `/api/public/v1`** และไม่ใช้ API key — เป็นคนละกลไกกัน ดูรายละเอียดในข้อ 4.10
> ข้อ 4.11 ใช้**ทั้งสองอย่างคนละครึ่ง**: เบราว์เซอร์ขอโค้ดด้วย cookie แล้วเซิร์ฟเวอร์คุณแลกโค้ดด้วย API key

---

### 4.1 `GET /api/public/v1/me` — ตรวจสอบ key

Endpoint เดียวที่ **ไม่ต้องมี scope** และตอบได้แม้ key หมดอายุ/ถูกปิด (เพราะมีไว้ debug) ไม่เคย echo ตัว key กลับมา

```json
{
  "authenticated": true,
  "type": "api_key",
  "name": "ระบบห้องสมุด",
  "keyPrefix": "sk_live_9f3c",
  "scopes": ["students:read", "years:read"],
  "status": "active",
  "expiresAt": null,
  "lastUsedAt": "2026-07-19T03:12:00.000Z",
  "usageCount": 42
}
```

`status` เป็น `active` \| `revoked` \| `expired` — ถ้าไม่ใช่ `active` ให้แจ้งแอดมิน

---

### 4.2 `GET /api/public/v1/students` — รายชื่อนักเรียน

**Query parameters**

| พารามิเตอร์ | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `yearId` | ปีที่ active | id ปีการศึกษา (ได้จากข้อ 4.5) — **นี่คือตัวย้อนดูปีเก่า** |
| `grade` | — | ชั้น เช่น `ม.1` (ต้องตรงเป๊ะ) |
| `classroom` | — | ห้อง เช่น `1` |
| `status` | `studying` | `studying` \| `withdrawn` \| `graduated` \| `all` |
| `q` | — | ค้นชื่อ/สกุล/รหัสนักเรียน แบบ **contains** (`%q%`) |
| `page` | `1` | หน้า |
| `pageSize` | `50` | สูงสุด `200` |

**Response**

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
      "birthDate": "01/05/2556",
      "email": null,
      "phone": null,
      "status": "studying",
      "gradeLevel": "ม.1",
      "classroom": "1",
      "classNumber": "5",
      "hasPhoto": true,
      "photoUrl": "/api/public/v1/students/123/photo"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 1200,
  "academicYear": {
    "id": 3, "year": 2569,
    "startDate": "2026-05-16", "endDate": "2027-03-31",
    "term1Start": "2026-05-16", "term1End": "2026-10-10",
    "term2Start": "2026-11-01", "term2End": "2027-03-31"
  }
}
```

**คำอธิบายฟิลด์ที่คนพลาดบ่อย**

| ฟิลด์ | ชนิด | ระวัง |
|---|---|---|
| `id` | number | **กุญแจถาวร** ใช้ผูกกับระบบคุณ |
| `studentCode` | string | รหัสนักเรียน — ใช้แสดงผล/เทียบกับระบบเดิมได้ แต่แอดมินแก้ได้ |
| `classNumber` | **string** | เลขที่ เป็น text ไม่ใช่ number (`"5"` ไม่ใช่ `5`) |
| `birthDate` | string | เก็บดิบตามต้นทาง มักเป็น **พ.ศ. `dd/mm/พพพพ`** ไม่ใช่ ISO — parse เองก่อนใช้ |
| `gradeLevel` / `classroom` | string \| null | **ของปีที่ถามเท่านั้น** เปลี่ยนทุกปี |
| `status` | enum | สถานะ **ณ วันนี้** ไม่ใช่ของปีที่ถาม |
| `photoUrl` | string \| null | เป็น path สัมพัทธ์ ต้องเติม base URL เอง |
| `citizenId` | string | โผล่เฉพาะเมื่อ key มี `students:pii` — และการเรียกครั้งนั้นถูกบันทึก audit |

> `academicYear` บอกว่าข้อมูลชุดนี้เป็นของปีไหน — **ควร log ไว้ทุกครั้งที่ sync** จะช่วยดีบักมหาศาลตอนโรงเรียนเปลี่ยนปีการศึกษา

---

### 4.3 `GET /api/public/v1/students/{id}` — รายคน + ประวัติทุกปี

**ใช้เมื่อคุณถือ `id` อยู่แล้ว แต่ไม่รู้ว่าเขาอยู่ปีไหน** — endpoint นี้ **ไม่ผูกกับปีการศึกษาเลย** ต่างจากข้อ 4.2 ที่ join กับ enrollment ของปีที่ถาม (นี่คือทางออกของกับดักข้อ 5.3)

`{id}` คือ `id` จากข้อ 4.2 — **ไม่ใช่รหัสนักเรียน** · ไม่มี query parameter

**Response**

```json
{
  "data": {
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
    "birthDate": "01/05/2556",
    "email": null,
    "phone": null,
    "status": "withdrawn",
    "gradeLevel": null,
    "classroom": null,
    "classNumber": null,
    "hasPhoto": true,
    "photoUrl": "/api/public/v1/students/123/photo",
    "exit": { "type": "ลาออก", "date": "12/08/2569", "yearId": 3, "year": 2569 },
    "enrollments": [
      { "yearId": 3, "year": 2569, "gradeLevel": "ม.1", "classroom": "1", "classNumber": "5" },
      { "yearId": 2, "year": 2568, "gradeLevel": "ป.6", "classroom": "2", "classNumber": "11" }
    ],
    "academicYear": {
      "id": 4, "year": 2570,
      "startDate": "2027-05-16", "endDate": "2028-03-31",
      "term1Start": "2027-05-16", "term1End": "2027-10-10",
      "term2Start": "2027-11-01", "term2End": "2028-03-31"
    }
  }
}
```

**ฟิลด์ที่ต่างจากข้อ 4.2**

| ฟิลด์ | ความหมาย |
|---|---|
| `gradeLevel` / `classroom` / `classNumber` | ชั้น/ห้อง/เลขที่ **ของปีที่ active** (`academicYear` ด้านล่าง) — **`null` ถ้าปีนี้เขาไม่มี enrollment** ซึ่งคือกรณีของตัวอย่างข้างบน |
| `enrollments[]` | **ประวัติครบทุกปี** เรียงปีใหม่→เก่า · `enrollments[0]` คือที่ล่าสุดที่เคยอยู่ (แม้จะไม่ใช่ปีปัจจุบัน) |
| `exit` | ข้อมูลการออก — `null` ถ้ายังเรียนอยู่ |
| `academicYear` | ปีที่ active ตอนนี้ — บอกว่า `gradeLevel` ด้านบนอ้างถึงปีไหน |

ฟิลด์อื่นชื่อและความหมายตรงกับ row ในข้อ 4.2 ทุกตัว → **ใช้ mapper ตัวเดิมได้เลย**

**สังเกตตัวอย่างข้างบน:** คนนี้ลาออกปี 2569 พอขึ้นปี 2570 เขาหายจากข้อ 4.2 ทุกแบบแม้ใส่ `status=all` แต่ที่นี่ยังเรียกได้ — และ `enrollments[0]` บอกว่าตอนออกอยู่ ม.1/1

**ข้อควรรู้**

| กรณี | ผลลัพธ์ |
|---|---|
| `id` ไม่ใช่ตัวเลข | `400 invalid_id` |
| ไม่มีคนนี้ / **อยู่ในถังขยะ** | `404 not_found` — ถังขยะยังหายจากทุก endpoint ตามข้อ 5.4 |
| ไม่เคยมี enrollment เลย | `enrollments: []` (ไม่ใช่ error) |
| key มี `students:pii` | ได้ `citizenId` เพิ่ม + ถูกบันทึก audit เหมือนข้อ 4.2 |

> **ไม่ส่ง `exitReason`** โดยตั้งใจ — เหตุผลการออกเป็น free text ที่อาจมีเรื่องครอบครัวเด็กอยู่ ระบบปลายทางที่ทำ reconcile ใช้แค่ `type`/`date`/`year` ก็พอ (PDPA)

---

### 4.4 `GET /api/public/v1/teachers` — รายชื่อครู

**Query:** `yearId` (ใช้กับฟิลด์ `homerooms`), `subjectGroup`, `role` (`teacher` \| `teacher-admin`), `status` (`active` \| `resigned` \| `all`, default `active`), `q`, `page`, `pageSize` (สูงสุด 200)

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
      "phone": "0812345678",
      "lineId": "artit.s",
      "birthDate": "14/02/2530",
      "subjectGroup": "คณิตศาสตร์",
      "gradeTaught": "ม.ปลาย",
      "role": "teacher-admin",
      "employmentStatus": "active",
      "homerooms": [{ "gradeLevel": "ม.1", "classroom": "1" }],
      "hasPhoto": true,
      "photoUrl": "/api/public/v1/teachers/7/photo"
    }
  ],
  "page": 1, "pageSize": 50, "total": 110,
  "academicYear": { "id": 3, "year": 2569 }
}
```

- **`role` คือแหล่งความจริงเรื่องสิทธิ์ระดับระบบ** — `teacher-admin` = ผู้ดูแล ระบบปลายทางควร map สิทธิ์จากฟิลด์นี้
- `homerooms` = ห้องที่ครูคนนี้เป็นครูประจำชั้น **ในปีที่ถาม** (ว่างได้)
- `q` ค้นได้ทั้งชื่อ/สกุล/`teacherCode`/อีเมล
- `phone` / `lineId` / `birthDate` เป็นข้อมูลติดต่อในทำเนียบบุคลากร มากับ `teachers:read` เหมือน `email` (null ได้ถ้ายังไม่กรอก) · `birthDate` เป็นข้อความ **พ.ศ. `ว/ด/ปปปป`** เหมือนของนักเรียน — ไม่ใช่ ISO date
- เลขบัตร ปชช. ยังคงเป็นฟิลด์เดียวที่ต้องใช้ `teachers:pii`

---

### 4.4b `GET /api/public/v1/workers` — รายชื่อคนงาน

Scope `workers:read` · เลขบัตร ปชช. ต้องมี `workers:pii` เพิ่ม (ถูก audit ทุกครั้ง)

**Query:** `position`, `status` (`active` \| `resigned` \| `all`, default `active`), `q`, `page`, `pageSize` (สูงสุด 200)

```json
{
  "data": [
    {
      "id": 4,
      "workerCode": "W005",
      "prefix": "นาง",
      "firstName": "สมศรี",
      "lastName": "ใจดี",
      "fullName": "นางสมศรี ใจดี",
      "position": "นักการภารโรง",
      "phone": "0898765432",
      "employmentStatus": "active",
      "exitDate": null,
      "hasPhoto": true,
      "photoUrl": "/api/public/v1/workers/4/photo"
    }
  ],
  "page": 1, "pageSize": 50, "total": 12
}
```

- **คนงานไม่มีบัญชีล็อกอิน** — ไม่มี `role`, ไม่มี `email`, ไม่มีรหัสผ่าน ระบบปลายทางจึงใช้ข้อมูลนี้ให้สิทธิ์ใครไม่ได้ ใช้ได้แค่แสดงทำเนียบ/ติดต่อ
- `q` ค้นได้ทั้งชื่อ/สกุล/`workerCode`/ตำแหน่ง
- `exitDate` เป็นข้อความ **พ.ศ. `ว/ด/ปปปป`** (null ถ้ายังทำงานอยู่)

---

### 4.5 `GET /api/public/v1/academic-years` — ปฏิทินการศึกษา

Scope `years:read` · ไม่มี PII · ไม่มี pagination (โรงเรียนหนึ่งมีไม่กี่ปี) · ปีที่ถูก archive ไม่ถูกส่งกลับ

**Query:** `?active=1` (เอาเฉพาะปีปัจจุบัน) หรือ `?year=2569` (พ.ศ.)

```json
{
  "data": [
    {
      "id": 3,
      "year": 2569,
      "startDate": "2026-05-16",
      "endDate": "2027-03-31",
      "isActive": true,
      "terms": [
        { "term": 1, "startDate": "2026-05-16", "endDate": "2026-10-10" },
        { "term": 2, "startDate": "2026-11-01", "endDate": "2027-03-31" }
      ]
    }
  ]
}
```

- `year` เป็น **number พ.ศ.** (2569) — ไม่ใช่ string ไม่ใช่ ค.ศ.
- วันที่เป็น ISO `yyyy-mm-dd` **หรือ `null`** ถ้าโรงเรียนยังไม่ได้กรอก — ต้องเผื่อ null เสมอ
- นี่คือที่เดียวที่จะได้ `id` ของปีเก่า เพื่อเอาไปใส่ `?yearId=` ในข้อ 4.2

---

### 4.6 `GET /api/public/v1/homerooms` — ครูประจำชั้นรายห้อง

Scope `teachers:read` (ใช้ scope เดิม ไม่ต้องออก key ใหม่) · **Query:** `yearId`, `grade`, `classroom`

```json
{
  "data": [
    {
      "gradeLevel": "ม.1",
      "classroom": "1",
      "studentCount": 38,
      "homeroomTeachers": [
        { "id": 7, "teacherCode": "T00116", "fullName": "นายอาทิตย์ แสงทอง",
          "email": "artit@example.ac.th", "subjectGroup": "คณิตศาสตร์",
          "employmentStatus": "active" }
      ]
    }
  ],
  "academicYear": { "id": 3, "year": 2569, "startDate": "2026-05-16", "…": "…" }
}
```

- ห้องหนึ่งมีครูประจำชั้นได้ **หลายคน** (ครูคู่ชั้น) → `homeroomTeachers` เป็น array
- ห้องที่ยังไม่มีครูประจำชั้นก็ถูกส่งกลับ (array ว่าง) เพื่อให้แยก "ยังไม่ได้กำหนด" ออกจาก "ไม่มีห้องนี้"
- `studentCount` นับเฉพาะนักเรียนที่ **ยังเรียนอยู่** ในปีนั้น

---

### 4.7 รูปทีละคน — `GET /students/{id}/photo` · `GET /teachers/{id}/photo` · `GET /workers/{id}/photo`

Scope: `*:read` **และ** `*:photo`

- `{id}` คือ **`id`** จากรายชื่อ **ไม่ใช่รหัสนักเรียน** (ในรายชื่อมี `photoUrl` ให้พร้อมแล้ว)
- ตอบเป็น **ไฟล์รูปดิบ** (`image/webp` ฯลฯ) ไม่ใช่ JSON — เอาไปใส่ `<img src>` ได้เลย
- ขนาด 480×640 ประมาณ 40–60 KB (ระบบครอบตัดใบหน้าให้ตอนนำเข้า)
- **รองรับ ETag** — ส่ง `If-None-Match` แล้วได้ `304` ถ้ารูปไม่เปลี่ยน เหมาะกับ sync ประจำ
- `Cache-Control: private, max-age=300, must-revalidate` (เป็น `private` เพราะใบหน้าคือข้อมูลส่วนบุคคล ห้ามลง shared cache)
- **ไม่ถูก audit รายครั้ง** โดยตั้งใจ (sync 2000 คนจะท่วม log)

| HTTP | code | ความหมาย |
|---|---|---|
| 400 | `invalid_id` | id ไม่ใช่ตัวเลข (มักเพราะเผลอส่งรหัสนักเรียน) |
| 404 | `not_found` | ไม่มีคน id นี้ |
| 404 | `no_photo` | มีคนนี้ แต่ยังไม่มีรูป |

> กรองด้วย `hasPhoto` จากรายชื่อก่อน จะไม่เจอ 404 เลย

---

### 4.8 รูปหลายคนพร้อมกัน — `GET /students/photos?ids=1,2,3`

Scope เดียวกับ 4.7 · ครูใช้ `/teachers/photos?ids=` · คนงานใช้ `/workers/photos?ids=`

ใช้เมื่อต้อง sync รูปทั้งโรงเรียน: ยิงทีละคน 2000 ครั้งจะชน rate limit (600/นาที = รอ 4 นาทีเปล่า ๆ) แบบนี้เหลือ ~40 ครั้ง

- `ids` **สูงสุด 50 ต่อครั้ง** เกินกว่านั้นได้ `400 invalid_ids`
- รูปมาเป็น **base64 data URL** (JSON บรรทุกไฟล์ดิบหลายไฟล์ไม่ได้) ใหญ่กว่าไฟล์ดิบ ~33%
- คนที่ไม่มีรูป **หรือ** ไม่มี id นั้นจริง จะไปรวมกันใน `missing` (เพราะทางแก้เหมือนกันคือ "อย่าถามซ้ำ")
- **ถูก audit 1 บรรทัดต่อ 1 การเรียก**

```json
{
  "data": [
    { "id": 123, "studentCode": "10234", "mime": "image/webp",
      "etag": "\"k9Xq…\"", "bytes": 48213, "dataUrl": "data:image/webp;base64,UklGRi…" }
  ],
  "missing": [124, 125],
  "limit": 50
}
```

---

### 4.9 `POST /api/public/v1/auth/verify` — ตรวจรหัสผ่าน (ล็อกอิน)

Scope `auth:students` หรือ `auth:teachers` ตาม `role` ที่ส่งมา

> **นี่คือ endpoint "ตรวจสอบ" ไม่ใช่ "ออก token"** — ระบบผู้เรียกต้องสร้าง session ของตัวเอง
> เหตุผล: การแจก JWT ของ SchoolOS ต้องแชร์ `JWT_SECRET` (HS256) ให้ทุกระบบ ซึ่งแปลว่าใครถือ secret ก็ปลอม token เป็นแอดมินได้

**Request**

```bash
curl -X POST -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{"role":"teacher","username":"T00116","password":"secret"}' \
  https://schoolos.example.ac.th/api/public/v1/auth/verify
```

- `role`: `student` \| `teacher`
- `username`: รหัสประจำตัว **หรือ** อีเมล
  - รหัสประจำตัวเทียบตรงตัว (case-sensitive)
  - อีเมลไม่สนตัวพิมพ์เล็ก-ใหญ่
  - **ถ้าอีเมลนั้นซ้ำกันหลายคน จะถือว่าไม่ผ่าน** เพื่อไม่ให้ล็อกอินสลับคน — ให้แอดมินแก้อีเมลซ้ำก่อน

**สำเร็จ (200)**

```json
{
  "valid": true,
  "user": { "id": 7, "code": "T00116", "name": "นายอาทิตย์ แสงทอง",
            "role": "teacher-admin", "active": true, "status": "active" }
}
```

**ล้มเหลว (401)** — ข้อความเดียวกันทั้ง "ไม่มีผู้ใช้" และ "รหัสผิด" เพื่อกันการไล่เดาว่าใครมีบัญชี

```json
{ "valid": false, "error": { "code": "invalid_credentials", "message": "รหัสผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง" } }
```

#### ⚠️ กฎเหล็ก: `valid` ไม่ได้แปลว่า "ให้เข้าใช้งานได้"

`valid: true` ตอบแค่ว่า **รหัสผ่านถูก** เท่านั้น ระบบนี้ **จงใจ** ปล่อยให้นักเรียนที่จบ/ลาออก และครูที่ลาออกแล้ว ยังผ่านการตรวจรหัสได้ พร้อมส่ง `active: false` มาให้

เพราะกติกาต่างกันไปตามระบบ — เด็กที่จบแล้วอาจต้องล็อกอินมาโหลดเอกสาร แต่ครูที่ลาออกไม่ควรเข้าระบบวัดผลได้ **SchoolOS ไม่ตัดสินใจแทน ระบบผู้เรียกต้องเช็ค `active` เอง**

```js
if (!data.valid) return null;        // รหัสผิด
if (!data.user.active) return null;  // ← ห้ามลืมบรรทัดนี้
```

คนเดียวที่ถูกปฏิเสธตั้งแต่ต้นทางคือคนที่ถูก **ย้ายเข้าถังขยะ** (ดูข้อ 5.4)

**Rate limit เฉพาะทาง:** รหัสผิด **5 ครั้งใน 15 นาที** ของ username เดิม → ล็อก 15 นาที คืน `429 too_many_attempts` + header `Retry-After` (นับแยกตาม username ไม่ใช่ตาม key — ต่อให้เปลี่ยน key ก็ยังโดนล็อก)

---

### 4.10 `GET /api/auth/session` — SSO: ล็อกอินอยู่แล้วหรือยัง?

**ไม่ใช้ API key** — ใช้ **cookie ของผู้ใช้** แทน ต่างจากข้อ 4.9 ตรงนี้:

| | 4.9 `POST /auth/verify` | 4.10 `GET /api/auth/session` |
|---|---|---|
| ใครเรียก | **server** ของคุณ | **เบราว์เซอร์** ของผู้ใช้ |
| ยืนยันตัวตนด้วย | API key | cookie `sso_session` ที่ผู้ใช้มีอยู่แล้ว |
| ตอบอะไร | "รหัสผ่านนี้ถูกไหม" | "คนนี้ล็อกอิน SchoolOS อยู่แล้วไหม เป็นใคร" |
| ใช้ตอน | ผู้ใช้กรอกรหัสในระบบคุณ | **ก่อน**จะโชว์หน้า login ของระบบคุณ |

**หลักการ:** เมื่อผู้ใช้ล็อกอินที่ Users แล้ว แอปจะเซ็ต cookie `sso_session` (HttpOnly, `Path=/`, `SameSite=Lax`) ระบบอื่นเช็ค session ได้โดย**ถาม** endpoint นี้ — จงใจไม่ให้ระบบอื่น verify JWT เอง เพราะนั่นแปลว่าต้องแจก `JWT_SECRET` (เหตุผลเดียวกับข้อ 4.9)

**เรียกยังไง** — ต้องมี `credentials: 'include'` ไม่งั้นเบราว์เซอร์ไม่ส่ง cookie ข้ามพอร์ตมาให้

```js
const res  = await fetch('http://localhost:3002/api/auth/session', {
  credentials: 'include',           // ← ขาดบรรทัดนี้ = ได้ valid:false ตลอด
});
const data = await res.json();

if (data.valid) {
  // ล็อกอินอยู่แล้ว — ข้ามหน้า login ไปเลย
  showApp(data.user);
} else {
  // ยังไม่ล็อกอิน — ส่งไป portal ของแพลตฟอร์ม **ไม่ใช่**หน้า login ของระบบคุณ
  const url = new URL(data.loginUrl);          // = https://schoolos.sukhon.ac.th/
  url.searchParams.set('next', location.href); // ล็อกอินเสร็จให้พากลับมาที่นี่
  location.href = url.toString();
}
```

> ⚠️ **ห้ามเด้งไปหน้า login ของระบบคุณเอง** — นี่คือข้อผิดพลาดที่เจอบ่อยที่สุด ผู้ใช้ที่ล็อกอินที่ระบบคุณจะได้ session ของระบบคุณระบบเดียว ส่วนแพลตฟอร์มยังมองว่าเขาเป็นคนแปลกหน้า พอเปิดระบบถัดไปก็ต้องล็อกอินใหม่อีก ซึ่งทำลายจุดประสงค์ของ SSO ทั้งหมด ปลายทางที่ถูกคือ `loginUrl` ที่เราส่งมาให้ในคำตอบเสมอ (อย่า hardcode — วันไหนย้ายโดเมน portal ค่านี้เปลี่ยนให้เอง)

**ล็อกอินอยู่ (200)**

```json
{
  "valid": true,
  "user": {
    "sub": "T00116",
    "role": "teacher",
    "name": "นายอาทิตย์ แสงทอง",
    "code": "T00116",
    "permissions": ["users:read", "users:write"]
  },
  "expiresAt": 1785312000000
}
```

**ยังไม่ได้ล็อกอิน (ก็ยัง 200)**

```json
{
  "valid": false,
  "user": null,
  "loginUrl": "https://schoolos.sukhon.ac.th/"
}
```

> ตอบ **200 ทั้งสองกรณี** — "ยังไม่ล็อกอิน" เป็นคำตอบ ไม่ใช่ error ให้เช็คที่ฟิลด์ `valid` ไม่ใช่ status code

**ฟิลด์ที่ต้องรู้**

- `role` — `teacher` \| `student` (ระดับ session) ส่วน `teacher-admin` สะท้อนมาเป็น `permissions` ที่มี `users:*`
- `permissions` — สิทธิ์ในโมดูล Users เท่านั้น **ไม่ใช่**สิทธิ์ในระบบคุณ ระบบคุณตัดสินใจเอง
- `expiresAt` — เวลาที่ session นี้จะตาย (epoch ms) แคชคำตอบได้ถึงเวลานี้ ไม่ต้องยิงทุกหน้า
- `loginUrl` — มาเฉพาะตอน `valid:false` ปลายทางที่ต้องส่งผู้ใช้ไปล็อกอิน (portal ของแพลตฟอร์ม) ใส่ `?next=` ต่อท้ายเองได้
- ไม่มี `active`/`status` แบบข้อ 4.9 — ถ้าต้องรู้ว่าคนนี้ยังเรียน/ยังทำงานอยู่ไหม ให้ถาม `GET /students` / `GET /teachers` ด้วย key ของคุณ

**ตั้งค่าฝั่ง SchoolOS ก่อนใช้** — origin ของระบบคุณต้องถูกใส่ใน `SSO_ALLOWED_ORIGINS` ของ Users service (แจ้งแอดมิน) ไม่งั้นเบราว์เซอร์จะบล็อกเพราะไม่มี CORS header กลับมา ต้องเป็น origin เป๊ะ ๆ (scheme + host + port) เช่น `http://localhost:3017` — ใช้ `*` ไม่ได้เพราะเป็น request ที่พก cookie

**ล็อกอินจากระบบคุณ** — `POST /api/auth/teacher-login` (body `{teacher_code, password}`) และ `POST /api/auth/student-login` (body `{identifier, password}`) เปิด CORS ด้วยเหมือนกัน สำเร็จแล้วจะเซ็ต `sso_session` ให้เอง

**ต่ออายุ session** — `POST /api/auth/refresh` (`credentials: 'include'`, ไม่ต้องมี body)

การใช้งานในระบบคุณ **ไม่**นับเป็น activity ของ session โดยอัตโนมัติ — ตัวที่เลื่อน idle window ออกไปทำงานเฉพาะกับหน้าและ API ของโมดูล Users เท่านั้น ถ้าผู้ใช้ทำงานในระบบคุณ 15 นาทีโดยไม่แตะ Users เลย session จะหมดอายุกลางคัน ระบบคุณจึงต้องเรียก endpoint นี้เองเมื่อเห็นว่าผู้ใช้ยังใช้งานอยู่จริง

> ⚠️ **ข้อนี้ไม่ใช่ของแถม — ไม่เรียกแล้วระบบอื่นพังตามด้วย** `sso_session` เป็นคุกกี้ใบเดียวกันทั้งแพลตฟอร์ม ถ้าระบบคุณออก session ของตัวเองไว้แล้วไม่เคย refresh ผู้ใช้จะยังทำงานในระบบคุณได้เรื่อย ๆ (เพราะอยู่ด้วยคุกกี้ของคุณ) แต่คุกกี้กลางตายไปตั้งแต่นาทีที่ 15 — พอเขาสลับไป**ระบบอื่น** ระบบนั้นจะเจอ `valid:false` แล้วเด้งออกทั้งที่เพิ่งทำงานอยู่แท้ ๆ อาการ "ระบบนี้ใช้ได้ แต่อีกระบบตัดเวลา" มาจากตรงนี้เกือบทุกครั้ง

```js
const res = await fetch('http://localhost:3002/api/auth/refresh', {
  method: 'POST',
  credentials: 'include',
});
if (res.status === 401) {
  // หมดเวลาไปแล้ว — ไป portal เหมือนกรณี valid:false ข้างบน ไม่ใช่หน้า login ของคุณ
  const { loginUrl } = await res.json();
  const url = new URL(loginUrl);
  url.searchParams.set('next', location.href);
  return (location.href = url.toString());
}
const { expiresAt, absoluteEndsAt } = await res.json();
```

- `expiresAt` — deadline ใหม่ (epoch ms) เอาไปแทนค่าที่แคชไว้
- `absoluteEndsAt` — เพดาน 8 ชั่วโมงนับจากตอนล็อกอินครั้งแรก **ไม่ขยับ** ไม่ว่าจะ refresh กี่ครั้ง พอถึงเวลานี้คือจบ
- `GET /api/auth/session` **ไม่**ต่ออายุให้ (จงใจ — ถ้าต่อ แท็บที่เปิดค้างไว้แล้ว poll เรื่อย ๆ จะทำให้ session ไม่มีวันหมดอายุ ซึ่งทำลายจุดประสงค์ของ idle timeout) การต่ออายุต้องเป็นสิ่งที่ระบบคุณขอเองเมื่อเห็น activity จริง

**ล็อกเอาต์** — ออกจากระบบทั้งแพลตฟอร์มพร้อมกัน (cookie ทั้งชุดถูกลบ ทุกบริการจะเห็น `valid:false` ทันที) เลือกได้สองแบบ

| แบบ | ใช้ตอน |
|---|---|
| `GET /api/auth/logout?next=<url>` | ทำเป็น**ลิงก์**ธรรมดา — พาผู้ใช้ออกแล้ว redirect กลับมาที่ `next` |
| `POST /api/auth/logout` (`credentials: 'include'`) | อยากล้าง state ของระบบคุณเองแล้วอยู่หน้าเดิม ไม่ต้อง navigate |

`next` รับได้เฉพาะ path ในโดเมน Users หรือ URL ที่ origin อยู่ใน `SSO_ALLOWED_ORIGINS` เท่านั้น (กัน open redirect) — ถ้าไม่ผ่าน หรือไม่ใส่ `next` มาเลย จะพาไปที่หน้าแรกของแพลตฟอร์ม (`https://schoolos.sukhon.ac.th/`)

> ⚠️ ล้าง state ฝั่งคุณอย่างเดียวไม่พอ — ถ้าไม่เรียก endpoint นี้ `sso_session` จะยังอยู่ พอผู้ใช้กลับเข้าหน้าคุณอีกครั้ง probe จะตอบ `valid:true` แล้วล็อกอินกลับเข้าไปเอง เรื่องนี้สำคัญมากกับเครื่องที่ใช้ร่วมกัน

**ข้อควรรู้เรื่อง cookie**

- `SameSite=Lax` ดูที่ *site* ไม่สนพอร์ต — `localhost:3002` กับ `localhost:3017` จึงถือเป็น site เดียวกัน cookie ส่งถึงกันได้ แต่ถ้าย้ายไปคนละโดเมนจริง ๆ ต้องเปลี่ยนเป็น `SameSite=None; Secure` (ต้อง HTTPS ทั้งคู่)
- cookie นี้ถูกลบพร้อม session ปกติตอน logout และหมดอายุตามกติกา idle 15 นาที / เพดาน 8 ชั่วโมงเดียวกัน
- **`sso_session` เป็น session cookie** — ไม่มี `Max-Age`/`Expires` เบราว์เซอร์จึงลบทิ้งเองตอนปิดโปรแกรม **ปิดเบราว์เซอร์ = หลุดทั้งแพลตฟอร์ม** ต่อให้เพิ่งใช้งานไปเมื่อนาทีที่แล้ว (ตั้งใจ — เครื่องส่วนกลางในโรงเรียนต้องไม่มีบัญชีคนก่อนค้างไว้ให้คนถัดไป) ระบบคุณจึงต้องรับมือกับ `valid:false` ที่โผล่มาตอนเปิดเบราว์เซอร์ใหม่เสมอ อย่าแคชคำตอบข้ามการปิดเบราว์เซอร์ (เก็บใน `sessionStorage` ได้ อย่าเก็บใน `localStorage`)

---

### 4.11 SSO handoff — เมื่อ**เซิร์ฟเวอร์**ของคุณต้องรู้ด้วยว่าใครล็อกอินอยู่

ข้อ 4.10 ตอบไปที่**เบราว์เซอร์** ซึ่งพอสำหรับแอปที่ตัดสินใจในฝั่ง client แต่ถ้าระบบคุณกันหน้าเว็บด้วย **middleware / server component** (เช่น Next.js App Router) คำตอบนั้นอยู่ผิดฝั่ง — และ `sso_session` เป็น HttpOnly หน้าเว็บจึงส่งต่อให้เซิร์ฟเวอร์ตัวเองก็ไม่ได้

วิธีที่ถูกต้องคือ **ให้เบราว์เซอร์มาขอโค้ดใช้ครั้งเดียว** แล้วส่งโค้ดนั้นให้เซิร์ฟเวอร์ของคุณเอาไปแลกกับเราผ่าน API key

```
เบราว์เซอร์ผู้ใช้                     เซิร์ฟเวอร์ของคุณ              SchoolOS Users
   │
   ├─ GET /api/auth/session ─────────────────────────────────────▶ valid:true
   ├─ GET /api/auth/handoff?audience=arena ─────────────────────▶ code (60 วิ, ครั้งเดียว)
   ├─ POST /your/sso {code} ──────▶
   │                               ├─ POST /auth/handoff/redeem ─▶ user
   │                               ├─ ออก session cookie ของคุณเอง
   │◀──────────────────────────────┤
```

> **ทำไมไม่ให้ระบบอื่นอ่าน token ตรง ๆ:** ถ้าเปิดให้ JS หยิบ session token ไปได้ ก็เท่ากับทิ้ง HttpOnly ที่ป้องกัน XSS มาตลอด โค้ดนี้จึงถูกออกแบบให้เป็นของที่**อ่อนที่สุด**เท่าที่จะเป็นได้ — อายุ 60 วินาที ใช้ได้ครั้งเดียว และ**ไร้ค่าถ้าไม่มี API key** ของระบบปลายทาง

#### `GET /api/auth/handoff?audience=<ชื่อระบบ>` — เบราว์เซอร์เรียก (cookie)

```js
const res = await fetch('http://localhost:3002/api/auth/handoff?audience=arena', {
  credentials: 'include',          // ← ขาดบรรทัดนี้ = valid:false ตลอด
});
const { valid, code, loginUrl } = await res.json();
if (!valid) return (location.href = loginUrl);   // portal ไม่ใช่หน้า login ของคุณ — ดูข้อ 4.10

await fetch('/your/sso', { method: 'POST', body: JSON.stringify({ code }) });
```

**ล็อกอินอยู่ (200)**

```json
{ "valid": true, "code": "hc_kZ8…", "expiresIn": 60, "audience": "arena" }
```

**ยังไม่ได้ล็อกอิน (ก็ยัง 200)** — เหมือนข้อ 4.10 ให้ดูที่ `valid`

```json
{ "valid": false, "code": null, "loginUrl": "https://schoolos.sukhon.ac.th/" }
```

| สถานะอื่น | เมื่อไหร่ |
|---|---|
| `400 invalid_audience` | ไม่ได้ใส่ `?audience=` หรือใส่อักขระนอก `a-z 0-9 - _` |
| `403 forbidden_origin` | origin ของคุณไม่อยู่ใน `SSO_ALLOWED_ORIGINS` |
| `429 rate_limited` | ขอเกิน **10 ครั้ง/นาที** ต่อ 1 session (มี `Retry-After`) |

- **ไม่ต่ออายุ session ให้** เจตนาเดียวกับข้อ 4.10 — ถ้าผู้ใช้ยังทำงานอยู่จริงให้เรียก `POST /api/auth/refresh`
- `audience` ต้องตรงกับที่แอดมินตั้งไว้ในหน้า API Manager ของ key คุณ **เป๊ะ ๆ**

#### `POST /api/public/v1/auth/handoff/redeem` — เซิร์ฟเวอร์คุณเรียก (API key)

```bash
curl -X POST -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \
  -d '{"code":"hc_kZ8…"}' \
  https://schoolos.example.ac.th/api/public/v1/auth/handoff/redeem
```

**สำเร็จ (200)**

```json
{
  "valid": true,
  "user": {
    "sub": "T00116", "role": "teacher", "name": "นายอาทิตย์ แสงทอง",
    "code": "T00116", "permissions": ["users:read", "users:write"]
  },
  "audience": "arena",
  "expiresAt": 1785678052000,
  "absoluteEndsAt": 1785700000000
}
```

`user` เป็น **โครงเดียวกันเป๊ะกับข้อ 4.10** — mapper ตัวเดียวใช้ได้ทั้งสองทาง และกติกาเรื่อง `role` ก็เหมือนกัน: มีแค่ `teacher` \| `student` ส่วน `teacher-admin` สะท้อนมาเป็น `permissions` **ถ้าระบบคุณต้องรู้ role ในฐานข้อมูลจริง ๆ ให้ถาม `GET /teachers` ด้วย key ของคุณ** (ข้อ 4.4)

**ล้มเหลว** — แยก error ของ *โค้ด* (400/403) ออกจาก error ของ *key* (401/403 จากตัว guard) เพื่อให้ระบบคุณแยกออกว่า "โค้ดเก่าไปแล้ว ขอใหม่" กับ "ตั้งค่า key ผิด ตามแอดมิน"

| HTTP | `error.code` | แปลว่า |
|---|---|---|
| 400 | `invalid_code` | ไม่มีโค้ดนี้ในระบบ |
| 400 | `expired_code` | เกิน 60 วินาที (หรือ session ตายไปก่อนแล้ว) |
| 400 | `used_code` | โค้ดนี้ถูกแลกไปแล้ว — มัก = ระบบคุณยิงซ้ำสองครั้ง |
| 403 | `audience_mismatch` | โค้ดนี้ออกให้ระบบอื่น ไม่ใช่ของ key นี้ |
| 403 | `key_audience_unset` | key มี scope แล้วแต่แอดมินยังไม่ได้ระบุ audience |
| 401/403 | `invalid_key` / `insufficient_scope` / `key_revoked` | ปัญหาที่ตัว key เอง (เหมือนทุก endpoint) |

#### สิ่งที่ต้องให้แอดมิน SchoolOS ตั้งก่อนใช้

1. เพิ่ม origin ของคุณใน `SSO_ALLOWED_ORIGINS` (เหมือนข้อ 4.10)
2. ติ๊ก scope `auth:handoff` ให้ key ของคุณ **และกรอกช่อง "ระบบปลายทาง (audience)"** — key ที่มี scope แต่ไม่มี audience จะแลกโค้ดไม่ได้เลย (`key_audience_unset`) และ key ของระบบ A จะแลกโค้ดของระบบ B ไม่ได้

#### ข้อจำกัดที่ต้องรู้ (จงใจให้เป็นแบบนี้)

- **โค้ดเก็บในหน่วยความจำของ process** เหมือน rate limit / login lockout ถ้าวันหนึ่ง Users รันหลาย instance ต้องย้ายไปเก็บที่ Redis พร้อมกันทั้งชุด — ตอนนี้รัน instance เดียว การ "ใช้ได้ครั้งเดียว" จึงเป็น atomic จริง
- **restart แล้วโค้ดที่ยังไม่ถูกแลกจะหาย** — ไม่เป็นไร เบราว์เซอร์ขอใหม่ได้ทันที
- **logout ระหว่าง 60 วินาทีนั้นไม่เพิกถอนโค้ด** ระบบนี้ไม่มี blocklist ของ token (logout = ลบ cookie) โค้ดจึงยังแลกได้จนกว่าจะหมดอายุ ถ้ามันสำคัญกับระบบคุณ ให้เช็ค `GET /api/auth/session` ซ้ำอีกทีตอนผู้ใช้กลับมา
- ทุกครั้งที่มีการแลก (สำเร็จหรือไม่สำเร็จ) จะถูกบันทึกใน **บันทึกการใช้งาน** พร้อมชื่อ key และ audience

---

## 5. วงจรชีวิตข้อมูล — สิ่งที่เกิดขึ้นเมื่อโรงเรียนเลื่อนชั้น / มีคนลาออก

**หัวใจของเอกสารนี้** ถ้าอ่านข้ออื่นไม่ครบไม่เป็นไร แต่ต้องอ่านข้อนี้

### 5.1 เลื่อนชั้นขึ้นปีใหม่ — ระบบคุณ **ไม่พัง** แต่ข้อมูลจะเปลี่ยน

การเลื่อนชั้น **ไม่ได้สร้างคนใหม่** — แค่เพิ่มแถว enrollment ของปีถัดไป ดังนั้น

| สิ่งที่ | เกิดอะไรขึ้น |
|---|---|
| `id`, `studentCode` | ✅ **คงเดิมตลอด** — การผูกข้อมูลของคุณไม่หลุด |
| ล็อกอิน | ✅ ใช้ได้ตามปกติ ไม่เกี่ยวกับการเลื่อนชั้น |
| `gradeLevel`, `classroom`, `classNumber` | ⚠️ **เปลี่ยน** ทันทีที่โรงเรียนสลับปี active |

**ผลกระทบจริง:** ถ้าระบบคุณ cache ค่า "ป.5/2" ไว้เป็นข้อมูลถาวร มันจะเพี้ยนเงียบ ๆ ตอนขึ้นปีการศึกษา — ให้ sync ชั้น/ห้องใหม่อย่างน้อยปีละครั้ง หรือเก็บคู่กับ `academicYear.year` เสมอ

### 5.2 นักเรียนลาออก / จำหน่าย / จบการศึกษา

**ข้อมูลไม่ถูกลบ** — ระบบแค่เปลี่ยน `status` เป็น `withdrawn` / `graduated` แล้วบันทึกวันที่+เหตุผล+ปีที่ออกไว้

แต่เพราะ `/students` มีค่า default `status=studying` → **คนเหล่านี้จะหายไปจากผลลัพธ์ที่คุณเคยได้**

| ถ้าโค้ดคุณเขียนแบบ | ผลที่ได้ |
|---|---|
| "id ไหนไม่อยู่ในผลลัพธ์รอบนี้ = ลบทิ้ง" | ❌ ข้อมูลเก่าหายยกชุด |
| "หาไม่เจอ = โยน error" | ❌ พังเมื่อเปิดข้อมูลย้อนหลัง |
| "หาไม่เจอ = ทำเครื่องหมาย inactive เก็บ snapshot ชื่อไว้" | ✅ ถูกต้อง |

**พักการเรียนไม่ใช่การออก** — เด็กที่พักการเรียนยังเป็น `status: "studying"` อยู่ในบัญชีรายชื่อห้อง และเลื่อนชั้นตามปกติ ระบบเก็บช่วงที่พักไว้แยกต่างหาก (ตาราง `student_leaves`) ไม่ผูกกับ `status` ดังนั้น **API ฝั่งคุณจะเห็นเขาเหมือนนักเรียนทั่วไป ซึ่งถูกต้องแล้ว** — ค่า `status` ยังมีแค่ 3 ค่าเท่าเดิม (`studying` / `withdrawn` / `graduated`) ไม่มีค่าใหม่ให้ต้องรองรับ ถ้าระบบคุณจำเป็นต้องรู้ว่าใครพักอยู่ แจ้งแอดมินเพื่อเปิดฟิลด์เพิ่ม

### 5.3 ⚠️ กับดักตัวจริง — คนที่ไม่มี enrollment ในปีที่ถาม จะ "หาย" แม้ใส่ `status=all`

`/students` ใช้ **inner join** กับ enrollment ของปีที่ถาม ผลคือ:

```
เด็กลาออกกลางปี 2569  → ยังมี enrollment ปี 2569 → ?status=all ยังหาเจอ ✅
พอขึ้นปี 2570 (เขาไม่ถูกเลื่อนชั้น จึงไม่มี enrollment ปี 2570)
                       → หายจาก /students ทุกแบบ แม้ ?status=all ❌
                       → ต้องถามย้อนด้วย ?yearId=<ปี 2569>
                       → หรือถ้าถือ id อยู่: GET /students/{id} (ข้อ 4.3) ✅
```

**ถ้าคุณถือ `id` อยู่ เรื่องนี้จบที่ข้อ 4.3** — `GET /students/{id}` ไม่ผูกกับปีการศึกษา จึงแปลง `id` กลับเป็นชื่อได้เสมอ ไม่ต้องรู้ว่าเขาออกปีไหน และได้ `enrollments[]` ประวัติครบมาด้วย

ที่ยัง**ไม่มี**ทางออกคือกรณี "ไม่มีทั้ง `id` และปี" เช่นถือแต่รหัสนักเรียนเก่า — `?q=` ค้นได้เฉพาะในปีที่ระบุ ต้องไล่ `yearId` ทีละปี

**ยังควรทำในฝั่งคุณอยู่ดี:** เก็บ **snapshot ชื่อ + ชั้น/ห้อง + ปี** ตอนที่ sync สำหรับข้อมูลย้อนหลัง (คะแนนเก่า ใบเสร็จเก่า) — ข้อ 4.3 แก้ปัญหา "resolve ไม่ได้" แต่ไม่ได้กัน "ชื่อถูกแก้ทีหลัง" หรือ "ถูกย้ายเข้าถังขยะ" ใบเสร็จปี 2568 ควรพิมพ์ชื่อ ณ ปี 2568 ไม่ใช่ชื่อที่ resolve สดวันนี้

### 5.4 ถังขยะ (archive) — อันนี้ **หายจริง**

เมื่อแอดมินกด "ย้ายไปถังขยะ" (`is_archived`) คนนั้นจะ:

- หายจาก **ทุก endpoint** ทันที (รวม `?status=all`)
- **ล็อกอินไม่ได้อีก** — `/auth/verify` ตอบ `invalid_credentials`

และถ้าแอดมิน **ลบถาวร** จากถังขยะ `id` จะหายจริงจากฐานข้อมูล → reference ที่ระบบคุณเก็บไว้จะกลายเป็น orphan อันนี้แก้ไม่ได้ที่ฝั่ง API เป็นเรื่องที่ต้องตกลงกับแอดมินโรงเรียนว่าจะไม่ลบถาวรกับคนที่เคยมีข้อมูลในระบบอื่น

### 5.5 ครูลาออก

ตรรกะเดียวกับนักเรียน: `employmentStatus` เปลี่ยนเป็น `resigned` แถวยังอยู่ แต่หายจาก default `status=active` — และ **ยังล็อกอินผ่านได้พร้อม `active:false`** (ดูข้อ 4.9)

### 5.6 ตารางสรุป

| เหตุการณ์ | `id` | ล็อกอิน | อยู่ใน list ปกติ | ยังหาเจอไหม |
|---|---|---|---|---|
| เลื่อนชั้น | คงเดิม | ได้ | ✅ | ปกติ (ชั้น/ห้องเปลี่ยน) |
| ลาออก/จบ (ปีปัจจุบัน) | คงเดิม | ได้ (`active:false`) | ❌ | `?status=all` |
| ลาออก/จบ (ข้ามปีไปแล้ว) | คงเดิม | ได้ (`active:false`) | ❌ | `GET /students/{id}` หรือระบุ `?yearId=` ปีที่ออก |
| ย้ายเข้าถังขยะ | คงเดิมใน DB | **ไม่ได้** | ❌ | **หาไม่เจอ** |
| ลบถาวร | **หาย** | ไม่ได้ | ❌ | หาไม่เจอถาวร |

---

## 6. สูตรสำเร็จ (Recipes)

### 6.1 Sync รายชื่อทั้งโรงเรียนแบบไม่ทำข้อมูลเก่าหาย

```js
const BASE = process.env.SCHOOLOS_BASE;
const KEY  = process.env.SCHOOLOS_API_KEY;
const h    = { 'X-API-Key': KEY };

async function fetchAll(path, params = {}) {
  const out = [];
  let page = 1, total = Infinity, year = null;
  while (out.length < total) {
    const qs = new URLSearchParams({ ...params, page, pageSize: 200 });
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: h });
    if (res.status === 429) {                     // เคารพ Retry-After เสมอ
      await sleep((+res.headers.get('Retry-After') || 60) * 1000);
      continue;                                   // ไม่ต้องขยับ page
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.json()).error?.code}`);
    const body = await res.json();
    out.push(...body.data);
    total = body.total;
    year  = body.academicYear;
    if (body.data.length === 0) break;            // กันลูปไม่รู้จบ
    page += 1;
  }
  return { rows: out, year };
}

// status=all แล้วค่อยกรองเอง — จะได้รู้ว่าใคร "ยังอยู่แต่เปลี่ยนสถานะ"
const { rows, year } = await fetchAll('/api/public/v1/students', { status: 'all' });
console.log(`sync ปีการศึกษา ${year.year}: ${rows.length} คน`);

const seen = new Set(rows.map((r) => r.id));
for (const r of rows) await upsertStudent(r);            // ตาม id
for (const local of await myStudents())
  if (!seen.has(local.schoolosId)) await markInactive(local); // ← ไม่ลบทิ้ง
```

### 6.2 ย้อนดูประวัติชั้น/ห้องของเด็กคนหนึ่ง

**ถ้าคุณมี `id` อยู่แล้ว — คำขอเดียวจบ ได้ครบทุกปี** (ข้อ 4.3)

```js
const { data: s } = await (await fetch(
  `${BASE}/api/public/v1/students/${id}`, { headers: h }
)).json();

for (const e of s.enrollments)                       // เรียงปีใหม่ → เก่าให้แล้ว
  console.log(e.year, e.gradeLevel, e.classroom, e.classNumber);
// 2569 ม.1 1 5
// 2568 ป.6 2 11

const y2568 = s.enrollments.find((e) => e.year === 2568);   // เจาะปีเดียว
console.log(s.fullName, y2568?.gradeLevel);                  // ← ใช้ได้แม้เขาออกไปแล้ว
```

**ถ้ามีแต่รหัสนักเรียน** (ไม่มี `id`) ต้องค้นในปีที่เขายังอยู่ เพราะ `?q=` ผูกกับปี

```js
// 1) หา id ของปีที่ต้องการ
const years = (await (await fetch(`${BASE}/api/public/v1/academic-years`, { headers: h })).json()).data;
const y2568 = years.find((y) => y.year === 2568);

// 2) ถามรายชื่อของ "ปีนั้น" — ต้องใส่ status=all ไม่งั้นคนที่ตอนนี้จบแล้วจะหาย
const qs = new URLSearchParams({ yearId: y2568.id, status: 'all', q: 'ST00123' });
const { data } = await (await fetch(`${BASE}/api/public/v1/students?${qs}`, { headers: h })).json();

// 3) q เป็น contains — ต้องเทียบรหัสให้ตรงเป๊ะเองอีกชั้น
const hit = data.find((s) => s.studentCode === 'ST00123');
console.log(hit?.gradeLevel, hit?.classroom, hit?.classNumber); // ม.2 / 2 / 11
```

> ได้ `hit.id` มาแล้วให้ **เก็บไว้** — ครั้งต่อไปใช้วิธีแรก ไม่ต้องเดาปีอีก

### 6.3 ล็อกอินผู้ใช้

```js
async function login(role, username, password) {
  const res = await fetch(`${BASE}/api/public/v1/auth/verify`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, username, password }),
  });
  if (res.status === 429) throw new Error('ลองบ่อยเกินไป รอ ' + res.headers.get('Retry-After') + ' วิ');
  const data = await res.json();
  if (!data.valid) return null;                       // รหัสผิด
  if (!data.user.active) return null;                 // จบ/ลาออกแล้ว — กติกาของเราคือไม่ให้เข้า
  return mySession.create(data.user);                 // ระบบเราออก session เอง
}
```

### 6.4 Sync รูปแบบประหยัด (ใช้ ETag ไม่โหลดซ้ำ)

```js
const ids = rows.filter((s) => s.hasPhoto).map((s) => s.id);
for (let i = 0; i < ids.length; i += 50) {
  const qs = new URLSearchParams({ ids: ids.slice(i, i + 50).join(',') });
  const { data } = await (await fetch(`${BASE}/api/public/v1/students/photos?${qs}`, { headers: h })).json();
  for (const p of data) {
    if (await etagOf(p.id) === p.etag) continue;      // รูปไม่เปลี่ยน ข้าม
    fs.writeFileSync(`photos/${p.studentCode}.webp`, Buffer.from(p.dataUrl.split(',')[1], 'base64'));
    await saveEtag(p.id, p.etag);
  }
}
```

### 6.5 Python (requests)

```python
import os, requests

BASE = "https://schoolos.example.ac.th"
HEADERS = {"X-API-Key": os.environ["SCHOOLOS_API_KEY"]}

def get_students(year_id=None, status="all"):
    """วนอ่านครบทุกหน้า — คืน (รายชื่อ, ปีการศึกษาที่ข้อมูลชุดนี้เป็นของ)"""
    rows, page, year = [], 1, None
    while True:
        params = {"status": status, "page": page, "pageSize": 200}
        if year_id:
            params["yearId"] = year_id
        r = requests.get(f"{BASE}/api/public/v1/students", params=params, headers=HEADERS)
        r.raise_for_status()
        body = r.json()
        rows += body["data"]
        year = body["academicYear"]
        if len(rows) >= body["total"] or not body["data"]:
            return rows, year
        page += 1

def login(username, password, role="student"):
    r = requests.post(f"{BASE}/api/public/v1/auth/verify", headers=HEADERS,
                      json={"role": role, "username": username, "password": password})
    data = r.json()
    if not data.get("valid"):
        return None                       # รหัสผิด
    if not data["user"]["active"]:
        return None                       # จบ/ลาออกแล้ว — กติกาของเราคือไม่ให้เข้า
    return data["user"]
```

---

## 7. ข้อผิดพลาดและขีดจำกัด

Error ของ public API อยู่ในรูป **`{ "error": { "code": "...", "message": "..." } }`** เสมอ — ให้ตรวจ `code` ไม่ใช่ข้อความ

| HTTP | code | ความหมาย | วิธีแก้ |
|---|---|---|---|
| 401 | `unauthorized` | ไม่ได้แนบ key | ใส่ `X-API-Key` |
| 401 | `invalid_key` | key ผิด | ตรวจว่าคัดลอกครบ ขึ้นต้น `sk_live_` |
| 403 | `key_revoked` | key ถูกปิดใช้งาน | ให้แอดมินเปิด หรือออกใหม่ |
| 403 | `key_expired` | key หมดอายุ | ให้แอดมินต่ออายุ/หมุน |
| 403 | `insufficient_scope` | ไม่มี scope ที่ต้องใช้ | ขอแอดมินเพิ่ม scope (ข้อความบอกชื่อ scope ที่ขาด) |
| 400 | `invalid_id` / `invalid_ids` | id ไม่ใช่ตัวเลข / ไม่ส่ง `ids` / เกิน 50 | ใช้ `id` จากรายชื่อ, แบ่งชุดละ 50 |
| 404 | `not_found` / `no_photo` | ไม่มีคนนี้ / ยังไม่มีรูป | กรองด้วย `hasPhoto` ก่อน |
| 401 | `invalid_credentials` | รหัสผู้ใช้/รหัสผ่านผิด | — |
| 429 | `rate_limited` | ยิงถี่เกินโควตา | backoff ตาม `Retry-After` |
| 429 | `too_many_attempts` | ล็อกอินผิดซ้ำ ๆ | รอตาม `Retry-After` |

**Rate limit:** **600 requests / นาที ต่อ key** เกินแล้วได้ `429` พร้อม `Retry-After` เป็นวินาที

อีกชั้นหนึ่งนับต่อ **IP** แต่**นับเฉพาะคำขอที่ auth ไม่ผ่าน** (key ผิด/ถูกเพิกถอน/หมดอายุ/ไม่มีสิทธิ์) — **100 ครั้ง/นาที** ชั้นนี้มีไว้กันคนยิง key มั่ว ๆ ถล่ม DB คำขอที่ใช้ key ถูกต้องไม่กินโควตานี้เลย เพราะทุกระบบในแพลตฟอร์มวิ่งเข้ามาทาง docker bridge เป็น IP เดียวกันหมด ถ้านับคำขอที่สำเร็จด้วยก็เท่ากับทุกระบบแย่งโควตาเดียวกันเอง

> ตัวนับเก็บใน memory ของ process — ถ้า deploy หลาย instance โควตาจะนับแยกกันต่อ instance

---

## 8. ข้อจำกัดที่รู้อยู่ (ยังไม่รองรับ)

| ยังไม่มี | ผลกระทบ | ทางเลี่ยงตอนนี้ |
|---|---|---|
| `GET /teachers/{id}` (รายคน) | ฝั่งครูยังไม่มีคู่ของข้อ 4.3 — ครูที่ลาออกแล้วต้องใช้ `?status=all` | `GET /teachers?status=all` |
| ค้น**รายคน**ด้วยรหัสนักเรียนข้ามปี | `?q=` ผูกกับปีเสมอ ถ้ามีแต่รหัสเก่าไม่มี `id` ต้องไล่ทีละปี | ข้อ 6.2 ท่อนหลัง แล้วเก็บ `id` ไว้ |
| Endpoint ศิษย์เก่า (list) ใน public API | ดึง "ทุกคนที่ออกไปแล้ว" เป็นชุดไม่ได้ — รายคนใช้ข้อ 4.3 ได้แล้ว | ระบุ `?yearId=` ปีที่ออก |
| Webhook / event แจ้งเตือน | ต้อง poll เอง | ตั้ง cron sync (แนะนำวันละครั้ง + หลังเลื่อนชั้น) |
| ข้อมูลคนงาน (workers) ใน public API | ดึงไม่ได้ | — |
| ฟิลด์ที่อยู่ / ผู้ปกครอง / สุขภาพ | ไม่เปิดผ่าน public API โดยตั้งใจ (PDPA) | — |

---

## 9. เช็คลิสต์ก่อน go-live

- [ ] เก็บ key ไว้ใน env/secret ฝั่ง **server** — ห้าม commit, ห้ามฝังในแอปมือถือ/เว็บฝั่ง client
- [ ] เรียก API **จากฝั่ง server ของคุณ** เท่านั้น (กัน key รั่ว + ไม่ติด CORS)
- [ ] ขอ scope **เท่าที่ใช้** — ไม่ต้องใช้เลขบัตร ปชช. ก็อย่าขอ `:pii`
- [ ] ผูกข้อมูลด้วย **`id`** ไม่ใช่ชื่อหรือชั้น/ห้อง
- [ ] sync ด้วย `status=all` แล้วกรองเอง และ **mark inactive แทนการลบ**
- [ ] เก็บ **snapshot ชื่อ/ชั้น/ห้อง + ปีการศึกษา** สำหรับข้อมูลย้อนหลัง — ถึงจะ resolve ย้อนหลังได้ด้วยข้อ 4.3 แต่ snapshot กัน "ชื่อถูกแก้ทีหลัง" ซึ่ง API กันให้ไม่ได้
- [ ] `/auth/verify` — เช็ค **`user.active`** ทุกครั้ง และ map สิทธิ์จาก `role`
- [ ] จัดการ `429` ด้วย backoff ตาม `Retry-After` (ทั้ง `rate_limited` และ `too_many_attempts`)
- [ ] ตั้งชื่อ key ให้สื่อความหมาย — audit log บันทึกเป็น `apikey:<ชื่อ key>` ทุกครั้งที่อ่าน PII หรือมีการล็อกอิน
- [ ] ถ้า key รั่ว แจ้งแอดมิน **Rotate ทันที** (key เดิมตายทันที)
