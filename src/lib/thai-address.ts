/**
 * ตำบล → อำเภอ → จังหวัด → รหัสไปรษณีย์, for filling an address from a postal
 * code (or a ตำบล name) instead of typing four fields.
 *
 * The data is thai-address-data.json, built from kongvut/thai-province-data
 * (MIT, © Kongvut Sangkla — https://github.com/kongvut/thai-province-data),
 * file api/latest/province_with_district_and_sub_district.json, packed as
 *   p: province names
 *   d: [district name, province index]
 *   t: [sub-district name, district index, postal code]
 * which is ~320 KB raw / ~60 KB gzipped. It is imported dynamically, so it is a
 * separate chunk under /_next/ (public, cached) that only an address form loads.
 *
 * Suggestions only: nothing here validates or rewrites what is saved. A value
 * the list does not know (a new ตำบล, an old spelling) is still typed as-is.
 * Refresh the JSON from the source repo when ตำบล or postal codes change.
 */

export interface AddressArea {
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

interface Packed {
  p: string[];
  d: [string, number][];
  t: [string, number, string][];
}

let rows: AddressArea[] | null = null;
let loading: Promise<AddressArea[]> | null = null;

export function loadAddressData(): Promise<AddressArea[]> {
  if (rows) return Promise.resolve(rows);
  loading ??= import('./thai-address-data.json').then((m) => {
    const data = (m.default ?? m) as unknown as Packed;
    rows = data.t.map(([subDistrict, di, postalCode]) => {
      const [district, pi] = data.d[di];
      return { subDistrict, district, province: data.p[pi], postalCode };
    });
    return rows;
  });
  loading.catch(() => { loading = null; });
  return loading;
}

/** Every ตำบล that uses this five-digit code, in the source's own order. */
export function byPostalCode(all: AddressArea[], code: string): AddressArea[] {
  const c = code.trim();
  if (!/^\d{5}$/.test(c)) return [];
  return all.filter((r) => r.postalCode === c);
}

/**
 * ตำบล by name. Every word typed must appear somewhere in ตำบล/อำเภอ/จังหวัด,
 * so "ศรีภูมิ เชียงใหม่" narrows a common name to one province. A ตำบล that
 * STARTS with the first word is listed before one that merely contains it.
 */
export function searchSubDistrict(all: AddressArea[], query: string, limit = 30): AddressArea[] {
  const words = query.trim().replace(/^(ตำบล|ต\.|แขวง)\s*/, '').split(/\s+/).filter(Boolean);
  if (!words.length || words.join('').length < 2) return [];
  const first = words[0];
  const hits = all.filter((r) => {
    const hay = `${r.subDistrict} ${r.district} ${r.province}`;
    return words.every((w) => hay.includes(w));
  });
  hits.sort((a, b) => Number(!a.subDistrict.startsWith(first)) - Number(!b.subDistrict.startsWith(first)));
  return hits.slice(0, limit);
}

/**
 * Does the form already hold exactly this ตำบล/อำเภอ/จังหวัด (and this postal
 * code, when one is filled in)? Then there is nothing to suggest.
 */
export function sameArea(a: { [K in keyof AddressArea]?: string | null }, b: AddressArea): boolean {
  const n = (s?: string | null) => (s ?? '').trim().replace(/^(ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.)\s*/, '');
  const zip = (a.postalCode ?? '').trim();
  return n(a.subDistrict) === b.subDistrict && n(a.district) === b.district && n(a.province) === b.province
    && (!zip || zip === b.postalCode);
}
