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
| Docker / production | `http://<host>:3002` |
| Dev (`npm run dev`) | `http://localhost:3000` |

> ตัวอย่างทั้งเอกสารใช้ `https://schoolos.example.ac.th` แทน base URL จริง

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
| `years:read` | อ่านปีการศึกษา + ช่วงภาคเรียน | ไม่มี PII — ระบบตารางสอน/เช็คชื่อควรได้แค่อันนี้ |
| `auth:students` | ตรวจรหัสผ่าน**นักเรียน** | ผ่าน `/auth/verify` |
| `auth:teachers` | ตรวจรหัสผ่าน**ครู** | แยกจากนักเรียน เพื่อไม่ให้ระบบของเด็กเดารหัสครูได้ |

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
| 4.3 | `GET /teachers` | `teachers:read` | ดึงรายชื่อครู |
| 4.4 | `GET /academic-years` | `years:read` | ดูปีการศึกษา + ช่วงภาคเรียน |
| 4.5 | `GET /homerooms` | `teachers:read` | ดูครูประจำชั้นรายห้อง |
| 4.6 | `GET /students/{id}/photo`<br>`GET /teachers/{id}/photo` | `*:read` + `*:photo` | แสดงรูปทีละคน |
| 4.7 | `GET /students/photos?ids=`<br>`GET /teachers/photos?ids=` | `*:read` + `*:photo` | sync รูปจำนวนมาก |
| 4.8 | `POST /auth/verify` | `auth:students` / `auth:teachers` | ให้ผู้ใช้ล็อกอินด้วยบัญชี SchoolOS |

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
| `yearId` | ปีที่ active | id ปีการศึกษา (ได้จากข้อ 4.4) — **นี่คือตัวย้อนดูปีเก่า** |
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

### 4.3 `GET /api/public/v1/teachers` — รายชื่อครู

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

---

### 4.4 `GET /api/public/v1/academic-years` — ปฏิทินการศึกษา

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

### 4.5 `GET /api/public/v1/homerooms` — ครูประจำชั้นรายห้อง

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

### 4.6 รูปทีละคน — `GET /students/{id}/photo` · `GET /teachers/{id}/photo`

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

### 4.7 รูปหลายคนพร้อมกัน — `GET /students/photos?ids=1,2,3`

Scope เดียวกับ 4.6 · ครูใช้ `/teachers/photos?ids=`

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

### 4.8 `POST /api/public/v1/auth/verify` — ตรวจรหัสผ่าน (ล็อกอิน)

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

### 5.3 ⚠️ กับดักตัวจริง — คนที่ไม่มี enrollment ในปีที่ถาม จะ "หาย" แม้ใส่ `status=all`

`/students` ใช้ **inner join** กับ enrollment ของปีที่ถาม ผลคือ:

```
เด็กลาออกกลางปี 2569  → ยังมี enrollment ปี 2569 → ?status=all ยังหาเจอ ✅
พอขึ้นปี 2570 (เขาไม่ถูกเลื่อนชั้น จึงไม่มี enrollment ปี 2570)
                       → หายจาก API ทุกแบบ แม้ ?status=all ❌
                       → ต้องถามย้อนด้วย ?yearId=<ปี 2569> เท่านั้น
```

และตอนนี้ **ยังไม่มี endpoint สำหรับดูรายคนด้วย `id`** (มีแต่ `/photo`) แปลว่า ถ้าคุณถือ `id` ค้างไว้แต่ไม่รู้ว่าเขาออกปีไหน จะแปลง `id` กลับเป็นชื่อไม่ได้เลย

**ทางแก้ที่ควรทำในฝั่งคุณ:** เก็บ **snapshot ชื่อ + ชั้น/ห้อง + ปี** ไว้ในระบบตัวเองตอนที่ยัง sync ได้ อย่า resolve ชื่อสด ๆ ทุกครั้งสำหรับข้อมูลย้อนหลัง (คะแนนเก่า ใบเสร็จเก่า ฯลฯ)

### 5.4 ถังขยะ (archive) — อันนี้ **หายจริง**

เมื่อแอดมินกด "ย้ายไปถังขยะ" (`is_archived`) คนนั้นจะ:

- หายจาก **ทุก endpoint** ทันที (รวม `?status=all`)
- **ล็อกอินไม่ได้อีก** — `/auth/verify` ตอบ `invalid_credentials`

และถ้าแอดมิน **ลบถาวร** จากถังขยะ `id` จะหายจริงจากฐานข้อมูล → reference ที่ระบบคุณเก็บไว้จะกลายเป็น orphan อันนี้แก้ไม่ได้ที่ฝั่ง API เป็นเรื่องที่ต้องตกลงกับแอดมินโรงเรียนว่าจะไม่ลบถาวรกับคนที่เคยมีข้อมูลในระบบอื่น

### 5.5 ครูลาออก

ตรรกะเดียวกับนักเรียน: `employmentStatus` เปลี่ยนเป็น `resigned` แถวยังอยู่ แต่หายจาก default `status=active` — และ **ยังล็อกอินผ่านได้พร้อม `active:false`** (ดูข้อ 4.8)

### 5.6 ตารางสรุป

| เหตุการณ์ | `id` | ล็อกอิน | อยู่ใน list ปกติ | ยังหาเจอไหม |
|---|---|---|---|---|
| เลื่อนชั้น | คงเดิม | ได้ | ✅ | ปกติ (ชั้น/ห้องเปลี่ยน) |
| ลาออก/จบ (ปีปัจจุบัน) | คงเดิม | ได้ (`active:false`) | ❌ | `?status=all` |
| ลาออก/จบ (ข้ามปีไปแล้ว) | คงเดิม | ได้ (`active:false`) | ❌ | ต้องระบุ `?yearId=` ปีที่ออก |
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

### 6.2 ย้อนดูว่าปีที่แล้วเด็กคนนี้อยู่ชั้นไหน ห้องไหน

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

> อยากได้ประวัติทั้งหมดของคนเดียว ต้องวนถามทีละปี (ยังไม่มี endpoint ประวัติรายคน — ดูข้อ 8)

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

**Rate limit:** **600 requests / นาที** นับ 2 ชั้น — ต่อ **key** และต่อ **IP** (ชั้น IP มีไว้กันคนยิง key มั่ว ๆ ถล่ม DB) เกินแล้วได้ `429` พร้อม `Retry-After` เป็นวินาที

> ตัวนับเก็บใน memory ของ process — ถ้า deploy หลาย instance โควตาจะนับแยกกันต่อ instance

---

## 8. ข้อจำกัดที่รู้อยู่ (ยังไม่รองรับ)

| ยังไม่มี | ผลกระทบ | ทางเลี่ยงตอนนี้ |
|---|---|---|
| `GET /students/{id}` (รายคน) | แปลง `id` เป็นชื่อไม่ได้ ถ้าคนนั้นไม่มี enrollment ในปีที่ถาม | เก็บ snapshot ชื่อไว้ฝั่งคุณ |
| ประวัติการเรียนรายคน | ต้องวนถามทีละปี | ข้อ 6.2 ทำซ้ำทุกปี |
| Endpoint ศิษย์เก่าใน public API | คนที่ออกไปแล้วข้ามปี หาจาก API ปกติไม่เจอ | ระบุ `?yearId=` ปีที่ออก |
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
- [ ] เก็บ **snapshot ชื่อ/ชั้น/ห้อง + ปีการศึกษา** สำหรับข้อมูลย้อนหลัง
- [ ] `/auth/verify` — เช็ค **`data.user.active`** ทุกครั้ง และ map สิทธิ์จาก `role`
- [ ] จัดการ `429` ด้วย backoff ตาม `Retry-After` (ทั้ง `rate_limited` และ `too_many_attempts`)
- [ ] ตั้งชื่อ key ให้สื่อความหมาย — audit log บันทึกเป็น `apikey:<ชื่อ key>` ทุกครั้งที่อ่าน PII หรือมีการล็อกอิน
- [ ] ถ้า key รั่ว แจ้งแอดมิน **Rotate ทันที** (key เดิมตายทันที)
