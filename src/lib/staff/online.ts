/**
 * Ai đang online (supabase/019_online_presence.sql): mỗi trình duyệt đang mở phần mềm báo vào kênh
 * Realtime "smh-online" một dòng như dưới đây, khoá theo id tài khoản. Một người mở nhiều tab thì có
 * nhiều dòng cùng khoá → gom lại còn một người.
 */
export type OnlineMeta = {
  name: string;
  avatar_url: string | null;
  /** Vị trí công việc (hoặc vai trò) để hiện dưới tên. */
  position: string;
  /** Lúc mở phần mềm (ISO). */
  since: string;
};

export type OnlinePerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  position: string;
  /** Lúc sớm nhất trong các tab đang mở. */
  since: string;
  me: boolean;
};

export const ONLINE_CHANNEL = "smh-online";

const isMeta = (value: unknown): value is OnlineMeta => {
  const m = value as Partial<OnlineMeta> | null;
  return !!m && typeof m.name === "string" && typeof m.since === "string";
};

/** Trạng thái kênh → danh sách người, mỗi người một dòng; người khác xếp theo tên, mình ở cuối. */
export function onlinePeople(state: Record<string, unknown[]>, myId: string): OnlinePerson[] {
  const people: OnlinePerson[] = [];
  for (const [userId, metas] of Object.entries(state)) {
    const valid = metas.filter(isMeta).sort((a, b) => a.since.localeCompare(b.since));
    if (valid.length === 0) continue;
    const latest = valid[valid.length - 1]; // tab mở gần nhất mang tên / ảnh mới nhất
    people.push({
      userId,
      name: latest.name,
      avatarUrl: latest.avatar_url ?? null,
      position: typeof latest.position === "string" ? latest.position : "",
      since: valid[0].since,
      me: userId === myId,
    });
  }
  return people.sort((a, b) => Number(a.me) - Number(b.me) || a.name.localeCompare(b.name, "vi"));
}

const vnParts = (date: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );

/** "từ 08:15" (hôm nay, giờ Việt Nam) hoặc "từ 08:15 12/11" (mở từ hôm trước). */
export function sinceLabel(since: string, now: Date): string {
  const at = new Date(since);
  if (Number.isNaN(at.getTime())) return "";
  const a = vnParts(at);
  const n = vnParts(now);
  const time = `${a.hour}:${a.minute}`;
  return a.day === n.day && a.month === n.month ? `từ ${time}` : `từ ${time} ${a.day}/${a.month}`;
}
