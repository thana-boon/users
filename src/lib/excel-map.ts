import { clean, cleanStr, toInt } from './thai';

/**
 * Canonical column layout of the source spreadsheets, and the transform from a
 * raw row (array indexed by column) into structured entities. Shared by the
 * one-off migration scripts AND the runtime import endpoint so both stay in
 * lockstep with the exact students.xlsx / teachers.xlsx shape.
 */

export interface ParsedStudent {
  core: {
    studentCode: string;
    email: string | null;
    plainPassword: string | null; // to be encrypted by caller
    citizenId: string | null; // to be encrypted by caller
    admissionDate: string | null;
    gender: string | null;
    prefix: string | null;
    firstName: string;
    lastName: string;
    nickname: string | null;
    firstNameEn: string | null;
    lastNameEn: string | null;
    nicknameEn: string | null;
    birthDate: string | null;
    religion: string | null;
    nationality: string | null;
    ethnicity: string | null;
    siblingsTotal: number | null;
    siblingOrder: number | null;
    hasSiblingInSchool: string | null;
    phone: string | null;
  };
  enrollment: {
    gradeLevel: string | null;
    classroom: string | null;
    classNumber: string | null;
    seqOrder: number | null;
  };
  addresses: Array<Record<string, string | null> & { addressType: string }>;
  previousSchool: Record<string, string | null> | null;
  guardians: Array<Record<string, string | null> & { guardianType: string }>;
  health: Record<string, string | null> | null;
}

const g = (r: unknown[], i: number) => clean(r[i]);

function addrHasData(a: Record<string, string | null>): boolean {
  return Object.entries(a).some(([k, v]) => k !== 'addressType' && v);
}

/** Transform a raw students row (0-indexed array) into structured entities. */
export function parseStudentRow(r: unknown[]): ParsedStudent | null {
  const studentCode = cleanStr(r[7]).trim();
  const firstName = cleanStr(r[11]).trim();
  const lastName = cleanStr(r[12]).trim();
  if (!studentCode || (!firstName && !lastName)) return null; // skip blank rows

  const email = g(r, 4)?.toLowerCase() ?? null;

  const household = {
    addressType: 'household',
    houseRegCode: g(r, 25),
    houseNo: g(r, 26),
    soi: g(r, 27),
    moo: g(r, 28),
    road: g(r, 29),
    subDistrict: g(r, 30),
    district: g(r, 31),
    province: g(r, 32),
    postalCode: g(r, 33),
    phone: g(r, 34),
  };
  const birthPlace = {
    addressType: 'birth_place',
    hospitalName: g(r, 35),
    subDistrict: g(r, 36),
    district: g(r, 37),
    province: g(r, 38),
  };
  const current = {
    addressType: 'current',
    houseNo: g(r, 39),
    moo: g(r, 40),
    soi: g(r, 41),
    road: g(r, 42),
    subDistrict: g(r, 43),
    district: g(r, 44),
    province: g(r, 45),
    postalCode: g(r, 46),
    phone: g(r, 47),
    livingWith: g(r, 48),
    livingWithLastname: g(r, 49),
    houseType: g(r, 50),
    emergencyEmail: g(r, 51),
    emergencyPhone: g(r, 52),
    nearbyFriendName: g(r, 53),
    nearbyFriendLastname: g(r, 54),
    nearbyFriendPhone: g(r, 55),
  };
  const hometown = {
    addressType: 'hometown',
    houseNo: g(r, 63),
    moo: g(r, 64),
    soi: g(r, 65),
    road: g(r, 66),
    subDistrict: g(r, 67),
    district: g(r, 68),
    province: g(r, 69),
    postalCode: g(r, 70),
    phone: g(r, 71),
  };

  const previousSchoolRaw = {
    schoolName: g(r, 56),
    subDistrict: g(r, 57),
    district: g(r, 58),
    province: g(r, 59),
    qualification: g(r, 60),
    gpa: g(r, 61),
    transferReason: g(r, 62),
  };

  const guardian = {
    guardianType: 'guardian',
    relationship: g(r, 72),
    prefix: g(r, 73),
    firstName: g(r, 74),
    lastName: g(r, 75),
    firstNameEn: g(r, 76),
    lastNameEn: g(r, 77),
    birthDate: g(r, 78),
    religion: g(r, 79),
    nationality: g(r, 80),
    ethnicity: g(r, 81),
    houseNo: g(r, 82),
    moo: g(r, 83),
    soi: g(r, 84),
    road: g(r, 85),
    subDistrict: g(r, 86),
    district: g(r, 87),
    province: g(r, 88),
    postalCode: g(r, 89),
    homePhone: g(r, 90),
    mobilePhone: g(r, 91),
    workPhone: g(r, 92),
    familyStatus: g(r, 93),
    education: g(r, 94),
    occupation: g(r, 95),
    workplace: g(r, 96),
    incomeMonthly: g(r, 97),
    incomeYearly: g(r, 98),
  };
  const father = {
    guardianType: 'father',
    prefix: g(r, 99),
    firstName: g(r, 100),
    lastName: g(r, 101),
    firstNameEn: g(r, 102),
    lastNameEn: g(r, 103),
    birthDate: g(r, 104),
    religion: g(r, 105),
    nationality: g(r, 106),
    ethnicity: g(r, 107),
    houseNo: g(r, 108),
    moo: g(r, 109),
    soi: g(r, 110),
    road: g(r, 111),
    subDistrict: g(r, 112),
    district: g(r, 113),
    province: g(r, 114),
    postalCode: g(r, 115),
    homePhone: g(r, 116),
    mobilePhone: g(r, 117),
    workPhone: g(r, 118),
    education: g(r, 119),
    occupation: g(r, 120),
    workplace: g(r, 121),
    incomeMonthly: g(r, 122),
    incomeYearly: g(r, 123),
  };
  const mother = {
    guardianType: 'mother',
    prefix: g(r, 124),
    firstName: g(r, 125),
    lastName: g(r, 126),
    firstNameEn: g(r, 127),
    lastNameEn: g(r, 128),
    birthDate: g(r, 129),
    religion: g(r, 130),
    nationality: g(r, 131),
    ethnicity: g(r, 132),
    houseNo: g(r, 133),
    moo: g(r, 134),
    soi: g(r, 135),
    road: g(r, 136),
    subDistrict: g(r, 137),
    district: g(r, 138),
    province: g(r, 139),
    postalCode: g(r, 140),
    homePhone: g(r, 141),
    mobilePhone: g(r, 142),
    workPhone: g(r, 143),
    education: g(r, 144),
    occupation: g(r, 145),
    workplace: g(r, 146),
    incomeMonthly: g(r, 147),
    incomeYearly: g(r, 148),
  };

  const health = {
    weight: g(r, 149),
    height: g(r, 150),
    bloodType: g(r, 151),
    foodAllergy: g(r, 152),
    drugAllergy: g(r, 153),
    otherAllergy: g(r, 154),
    chronicDisease: g(r, 155),
    seriousDisease: g(r, 156),
  };

  const addresses = [household, birthPlace, current, hometown].filter(addrHasData);
  const guardians = [guardian, father, mother].filter(
    (x) => x.firstName || x.lastName,
  );
  const previousSchool = Object.values(previousSchoolRaw).some(Boolean)
    ? previousSchoolRaw
    : null;
  const healthOut = Object.values(health).some(Boolean) ? health : null;

  return {
    core: {
      studentCode,
      email,
      plainPassword: g(r, 5),
      citizenId: g(r, 6),
      admissionDate: g(r, 8),
      gender: g(r, 9),
      prefix: g(r, 10),
      firstName,
      lastName,
      nickname: g(r, 13),
      firstNameEn: g(r, 14),
      lastNameEn: g(r, 15),
      nicknameEn: g(r, 16),
      birthDate: g(r, 17),
      religion: g(r, 18),
      nationality: g(r, 19),
      ethnicity: g(r, 20),
      siblingsTotal: toInt(r[21]),
      siblingOrder: toInt(r[22]),
      hasSiblingInSchool: g(r, 23),
      phone: g(r, 24),
    },
    enrollment: {
      gradeLevel: g(r, 1),
      classroom: r[2] === null || r[2] === undefined ? null : cleanStr(r[2]),
      classNumber: r[3] === null || r[3] === undefined ? null : cleanStr(r[3]),
      seqOrder: toInt(r[0]),
    },
    addresses,
    previousSchool,
    guardians,
    health: healthOut,
  };
}

// -- Teachers: 11 columns ------------------------------------------
export interface ParsedTeacher {
  teacherCode: string;
  citizenId: string | null;
  prefix: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  plainPassword: string | null;
  gradeTaught: string | null;
  subjectGroup: string | null;
}

export function parseTeacherRow(r: unknown[]): ParsedTeacher | null {
  // 0:ลำดับ 1:รหัสบัตร 2:คำนำหน้า 3:ชื่อ 4:นามสกุล 5:รหัสครูผู้สอน
  // 6:Username 7:Password 8:Email 9:ชั้นที่สอน 10:กลุ่มสาระที่สอน
  const teacherCode = (cleanStr(r[5]) || cleanStr(r[6])).trim();
  const firstName = cleanStr(r[3]).trim();
  const lastName = cleanStr(r[4]).trim();
  if (!teacherCode || (!firstName && !lastName)) return null;
  return {
    teacherCode,
    citizenId: g(r, 1),
    prefix: g(r, 2),
    firstName,
    lastName,
    email: g(r, 8)?.toLowerCase() ?? null,
    plainPassword: g(r, 7),
    gradeTaught: g(r, 9),
    subjectGroup: g(r, 10),
  };
}
