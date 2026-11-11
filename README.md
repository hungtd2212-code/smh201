# Smile Hub ERP — Phòng khám nha khoa (cơ sở Hà Nội)

Hệ thống quản lý nội bộ. Hiện có màn hình **Telesale → Leads**; các mục khác trong menu là trang giữ chỗ.

- **Giao diện:** Next.js 16 + Tailwind + shadcn/ui
- **Dữ liệu & đăng nhập:** Supabase
- **Triển khai:** GitHub → Vercel

## Chạy trên máy

```bash
npm run dev
```

Mở http://localhost:3000. Khi chưa kết nối Supabase, ứng dụng chạy bằng **dữ liệu mẫu** và không cần đăng nhập.

---

## 1. Kết nối Supabase

### Bước 1 — Tạo bảng dữ liệu

1. Vào [supabase.com/dashboard](https://supabase.com/dashboard) → chọn (hoặc tạo) project. Nên chọn vùng **Singapore** cho gần Việt Nam.
2. Menu trái → **SQL Editor** → **New query**.
3. Mở file [`supabase/schema.sql`](supabase/schema.sql), sao chép toàn bộ, dán vào và bấm **Run**.

File này tạo 2 bảng `leads` và `staff`, kèm phân quyền: chỉ tài khoản có tên trong bảng `staff` mới xem/sửa được lead.

### Bước 2 — Tạo tài khoản đăng nhập cho bạn

1. **Authentication → Users → Add user → Create new user**: nhập email + mật khẩu, tick **Auto Confirm User**.
2. Quay lại **SQL Editor**, chạy lệnh sau (đổi email và tên):

```sql
insert into public.staff (user_id, full_name, role)
select id, 'Tên của bạn', 'admin'
from auth.users
where email = 'email-cua-ban@example.com';
```

Thêm nhân viên khác: làm lại 2 việc trên, `role` là `'lead'` hoặc `'sale'`.

3. Nên tắt tự đăng ký: **Authentication → Sign In / Providers** → tắt **Allow new users to sign up**.

### Bước 3 — Đưa khoá kết nối vào ứng dụng

1. Trong Supabase bấm nút **Connect** (trên cùng), hoặc vào **Project Settings → API Keys**. Cần 2 giá trị:
   - **Project URL** — dạng `https://xxxx.supabase.co`
   - **Publishable key** — dạng `sb_publishable_...` (project cũ gọi là `anon` key)
2. Trong thư mục dự án chạy lệnh dưới đây rồi dán lần lượt 2 giá trị khi được hỏi. Lệnh tự kiểm tra (từ chối nếu dán nhầm khoá bí mật) và ghi vào file **`.env.local`**:

```bash
npm run setup:supabase
```

   Hoặc tự tạo file `.env.local` theo mẫu [`.env.example`](.env.example):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

3. Dừng rồi chạy lại `npm run dev`. Ứng dụng sẽ chuyển sang trang đăng nhập — dùng tài khoản ở Bước 2.

> **Không bao giờ** dán khoá `secret` / `service_role` vào file này hay gửi cho ai — khoá đó bỏ qua mọi phân quyền.
> File `.env.local` đã được loại khỏi Git nên sẽ không bị đẩy lên GitHub.

---

## 2. Đưa mã lên GitHub

1. Vào [github.com/new](https://github.com/new) → đặt tên (vd `smh-erp`) → chọn **Private** → **Create repository** (không tick thêm README).
2. Trong thư mục dự án, chạy lần lượt (thay `TEN-GITHUB`):

```bash
git init
git add .
git commit -m "Khởi tạo SMH ERP: màn hình Telesale Leads"
git branch -M main
git remote add origin https://github.com/TEN-GITHUB/smh-erp.git
git push -u origin main
```

Khi `git push` hỏi mật khẩu, GitHub yêu cầu **Personal Access Token** chứ không nhận mật khẩu tài khoản
(tạo tại GitHub → Settings → Developer settings → Personal access tokens). Cách dễ hơn: cài
[GitHub Desktop](https://desktop.github.com), đăng nhập, rồi **Add existing repository** → **Publish**.

## 3. Triển khai lên Vercel

1. Vào [vercel.com/new](https://vercel.com/new) → **Import** repo `smh-erp` (Vercel tự nhận ra Next.js).
2. Mở mục **Environment Variables**, thêm đúng 2 biến như trong `.env.local`:
   `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Bấm **Deploy**. Từ đó, mỗi lần `git push` Vercel tự cập nhật bản mới.
4. Trong Supabase: **Authentication → URL Configuration → Site URL** → điền địa chỉ Vercel vừa có (dùng cho email đặt lại mật khẩu).

Nếu sửa biến môi trường trên Vercel sau khi đã deploy, phải **Redeploy** thì mới có hiệu lực.

---

## Cấu trúc mã

| Đường dẫn | Nội dung |
|---|---|
| `src/lib/config.ts` | Tên ứng dụng, tên cơ sở |
| `src/assets/brand/`, `src/app/icon.png` | Logo Smile Hub (nền trong suốt) và biểu tượng tab trình duyệt |
| `src/app/globals.css` | Bảng màu giao diện (lấy từ hai màu xanh của logo) |
| `src/lib/nav.ts` | Các mục trong menu trái |
| `src/lib/leads/status.ts` | 13 trạng thái lead (nhãn, màu) và công thức “số thực nhận” |
| `src/lib/leads/repo.ts` | Đọc / ghi lead (Supabase, hoặc dữ liệu mẫu khi chưa kết nối) |
| `src/components/telesale/` | Màn hình Leads: bộ lọc, thẻ số liệu, lịch, biểu đồ, bảng |
| `src/proxy.ts` | Chặn người chưa đăng nhập, chuyển về `/login` |
| `supabase/schema.sql` | Bảng dữ liệu và phân quyền |

### Cách tính các chỉ số

- **Tổng số** — mọi lead tạo trong khoảng ngày đang lọc.
- **Số sale thực nhận** — tổng số trừ đi *Số trùng*, *Trùng dịch vụ khác* và *Số huỷ*.
- **Số lịch** — số lead đã có lịch hẹn.
- **Tiềm năng** — số lead đang ở trạng thái *Tiềm năng*.

Muốn đổi công thức: sửa `NOT_RECEIVED_STATUSES` trong `src/lib/leads/status.ts` và hàm `computeLeadStats` trong `src/lib/leads/stats.ts`.
