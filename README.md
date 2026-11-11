# Smile Hub ERP — Phòng khám nha khoa (cơ sở 201 Trường Chinh)

Hệ thống quản lý nội bộ. Các màn hình đã có:

- **Telesale → Leads**: bảng điều khiển lead, form Thêm lead (dán đoạn chat, kiểm tra trùng số, chia telesale), form telesale xử lý lead.
- **Telesale → Chia lead / Chia ca**: bật / tắt nhận lead, thứ tự xoay vòng (xếp ca làm: đợt 2).
- **Marketing → Nhân viên Ads**, **TKQC & Page**, **Chiến dịch & Bài post**: danh mục của phân hệ Marketing (giai đoạn 1 — xem mục “Phân hệ Marketing” bên dưới).
- **Cài đặt → Dịch vụ & Bảng giá**: danh mục dịch vụ.
- **Cài đặt → Tài khoản & Phân quyền**, **Thùng rác**, **Nhật ký hệ thống**, **Sao lưu & Khôi phục**: vai trò, quyền tick theo tài khoản và an toàn dữ liệu (xem mục “An toàn dữ liệu” bên dưới).

Các mục khác trong menu là trang giữ chỗ.

- **Giao diện:** Next.js 16 + Tailwind + shadcn/ui
- **Dữ liệu & đăng nhập:** Supabase
- **Triển khai:** GitHub → Vercel

## Chạy trên máy

```bash
npm run dev
```

Mở http://localhost:3000. Ứng dụng cần kết nối Supabase (mục 1 bên dưới) mới dùng được.

---

## 1. Kết nối Supabase

### Bước 1 — Tạo bảng dữ liệu

1. Vào [supabase.com/dashboard](https://supabase.com/dashboard) → chọn (hoặc tạo) project. Nên chọn vùng **Singapore** cho gần Việt Nam.
2. Menu trái → **SQL Editor** → **New query**.
3. Mở file [`supabase/schema.sql`](supabase/schema.sql), sao chép toàn bộ, dán vào và bấm **Run**.
4. Làm tương tự, lần lượt theo số thứ tự, với các file còn lại trong thư mục `supabase/`:
   [`002_marketing_lead.sql`](supabase/002_marketing_lead.sql), [`003_data_safety.sql`](supabase/003_data_safety.sql),
   [`004_delete_permission.sql`](supabase/004_delete_permission.sql), [`005_marketing_catalog.sql`](supabase/005_marketing_catalog.sql),
   [`006_ad_daily_reports.sql`](supabase/006_ad_daily_reports.sql), [`007_ad_account_setup.sql`](supabase/007_ad_account_setup.sql),
   [`008_staff_accounts.sql`](supabase/008_staff_accounts.sql), [`009_admin_account.sql`](supabase/009_admin_account.sql),
   rồi [`010_ads_daily_data.sql`](supabase/010_ads_daily_data.sql) (010 không phụ thuộc 009).
5. (Tuỳ chọn) Chạy [`supabase/seeds/005_marketing_sample.sql`](supabase/seeds/005_marketing_sample.sql) để có sẵn 7 nhân viên Ads,
   2 TKQC và 1 chiến dịch + 1 bài post mẫu (có chữ “(mẫu)”). Chạy lại nhiều lần không sinh dòng trùng.

`schema.sql` tạo 2 bảng `leads` và `staff`, kèm phân quyền: chỉ tài khoản có tên trong bảng `staff` mới xem/sửa được lead.

> **Lưu ý thứ tự.** Chạy lại *cùng một file* thì không sao. Nhưng **đã chạy file số lớn hơn thì
> không chạy lại file số nhỏ hơn nữa** (ví dụ đã chạy 004 thì không chạy lại `schema.sql`, 002, 003) —
> file cũ sẽ ghi đè quy tắc mà file mới vừa đặt.
>
> Trước khi đem một file SQL mới lên Supabase, chạy `npm run test:db`: lệnh này chạy tất cả các file
> trên một cơ sở dữ liệu giả lập ngay trong máy và kiểm tra hơn 400 tình huống, không đụng tới dữ liệu thật.
>
> Ứng dụng vẫn chạy được khi cơ sở dữ liệu chưa có file mới nhất: các màn hình cũ hoạt động bình thường,
> màn hình cần file mới sẽ báo “chưa dùng được” và chỉ rõ file nào chưa chạy.

### Bước 2 — Tạo tài khoản đăng nhập cho bạn

1. **Authentication → Users → Add user → Create new user**: nhập email + mật khẩu, tick **Auto Confirm User**.
2. Quay lại **SQL Editor**, chạy lệnh sau (đổi email và tên):

```sql
insert into public.staff (user_id, full_name, role)
select id, 'Tên của bạn', 'admin'
from auth.users
where email = 'email-cua-ban@example.com';
```

Thêm nhân viên khác: làm lại 2 việc trên (để `role` là `'sale'`), rồi đổi vai trò ngay trong ứng dụng ở
**Cài đặt → Tài khoản & Phân quyền** (cần đã chạy file 005). Các vai trò:

| `role` | Tên trong ứng dụng | Được làm gì |
|---|---|---|
| `super_admin` | Quản trị cấp cao | Mọi thứ, kể cả xoá vĩnh viễn, đổi ngưỡng an toàn, cấp / thu vai trò Quản trị |
| `admin` | Quản trị | Toàn quyền nghiệp vụ; thùng rác, khôi phục, nhật ký hệ thống, hoàn tác theo lô, khoá tài khoản, đổi vai trò |
| `marketing_manager` | Trưởng Marketing | Toàn bộ Marketing: nhân viên Ads, TKQC và phân công, page, kênh, chiến dịch, bài post |
| `ads_staff` | Nhân viên Ads | Chỉ thấy TKQC được giao; thêm / sửa chiến dịch và bài post trong TKQC đang phụ trách. Không thấy lead |
| `lead` | Trưởng Telesale | Sửa dịch vụ, chia lead, hoàn tác một lead về phiên bản cũ |
| `sale` | Telesale | Xử lý lead được giao |
| `page` | Trực page | Dán lead |

Khi chạy `003_data_safety.sql`, tài khoản `admin` được tạo sớm nhất tự động trở thành `super_admin`.

Hai quyền không theo vai trò mà theo **ô tick riêng của từng tài khoản** (Cài đặt → Tài khoản & Phân quyền):
**Xoá dữ liệu** (chuyển vào thùng rác — xem mục “An toàn dữ liệu”) và **Xuất file** (nút “Tải Excel”; Quản trị luôn có,
người khác phải được Quản trị tick; mỗi lần xuất được ghi vào sổ `export_log`).

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
| `src/lib/leads/repo.ts` | Đọc / ghi lead, dán lead (`intake_lead`), kiểm tra trùng số |
| `src/lib/leads/phone.ts` | Chuẩn hoá SĐT, tách SĐT và tên từ đoạn chat |
| `src/lib/catalog/` | Danh mục: kênh, page, TKQC và phân công, nhân viên Ads, chiến dịch, bài post, dịch vụ, tài khoản |
| `src/components/catalog/` | Các trang danh mục (Nhân viên Ads, TKQC & Page, Chiến dịch & Bài post, Dịch vụ) |
| `src/lib/ad-reports/` | Báo cáo ads hằng ngày: đọc / gửi / sửa, xử lý ô nhập số (dấu chấm hàng nghìn, dán số), ngày giờ, mốc 24 giờ |
| `src/components/ad-reports/` | Màn Marketing → Nhập liệu và Marketing → Tổng quan |
| `src/components/telesale/` | Màn hình Leads: bộ lọc, thẻ số liệu, lịch, biểu đồ, bảng |
| `src/proxy.ts` | Chặn người chưa đăng nhập, chuyển về `/login` |
| `supabase/schema.sql` | Bảng `leads`, `staff` và phân quyền ban đầu |
| `supabase/002_marketing_lead.sql` | Phân hệ Marketing → Lead: danh mục, lần tiếp cận, quy tắc trùng số, chia telesale |
| `supabase/003_data_safety.sql` | An toàn dữ liệu: không ai xoá được, thùng rác, khoá số điện thoại, nhật ký thay đổi, hoàn tác, cảnh báo bất thường, khoá tài khoản |
| `supabase/004_delete_permission.sql` | Quyền “Xoá dữ liệu” tick theo từng tài khoản |
| `supabase/005_marketing_catalog.sql` | Phân hệ Marketing giai đoạn 1: vai trò mới, quyền “Xuất file”, nhân viên Ads, TKQC + phân công theo ngày, bài post, tách ID bài từ link |
| `supabase/006_ad_daily_reports.sql` | Báo cáo ads hằng ngày (`ad_daily_reports`): mỗi (ngày, TK ADS) một báo cáo, nhân viên sửa trong 24 giờ, không ai xoá |
| `supabase/008_staff_accounts.sql` | Danh sách cơ sở, thêm người dùng ngay trong ứng dụng (tạo luôn tài khoản đăng nhập), vị trí, phân quyền xem từng trang, khoá = cấm đăng nhập |
| `supabase/010_ads_daily_data.sql` | “Data xin được” ghi chung một dòng cho mỗi (ngày, nhân viên Ads) thay vì theo từng TKQC |
| `supabase/009_admin_account.sql` | Quản trị cấp cao: tên đăng nhập mặc định `admin`, tự sửa tên / tên đăng nhập; xoá cơ sở chưa có nhân sự |
| `supabase/007_ad_account_setup.sql` | Nhân viên tự cài đặt TKQC: loại tài khoản, thanh toán, `add_ad_account` / `remove_ad_account`; tài khoản vai trò Nhân viên Ads tự có dòng nhân viên Ads |
| `supabase/seeds/` | Dữ liệu mẫu (không bắt buộc) |
| `supabase/tests/` | Kiểm thử các file SQL trên Postgres giả lập (`npm run test:db`): `data-safety` (schema → 004), `marketing-catalog` (schema → 005), `ad-reports` (schema → 006), `ad-account-setup` (schema → 007), `staff-accounts` (schema → 009), `ads-daily-data` (schema → 010). `npm test` chạy thêm `tests/number-input.test.mjs` (ô nhập số) |
| `src/lib/safety/`, `src/components/safety/` | Tài khoản & Phân quyền, Thùng rác, Nhật ký hệ thống, Sao lưu & Khôi phục, tab Lịch sử của lead |

### Cách tính các chỉ số

- **Tổng số** — mọi lead tạo trong khoảng ngày đang lọc.
- **Số sale thực nhận** — tổng số trừ đi *Số trùng*, *Trùng dịch vụ khác* và *Số huỷ*.
- **Số lịch** — số lead đã có lịch hẹn.
- **Tiềm năng** — số lead đang ở trạng thái *Tiềm năng*.

Muốn đổi công thức: sửa `NOT_RECEIVED_STATUSES` trong `src/lib/leads/status.ts` và hàm `computeLeadStats` trong `src/lib/leads/stats.ts`.

### Quy tắc của phân hệ Marketing → Lead

- **Mỗi số điện thoại một lead.** Trực page dán lại số cũ thì không tạo lead mới; mỗi lần dán được lưu thành một “lần tiếp cận”.
- **Nguồn của lead = lần tiếp cận gần nhất.**
- **Lead đang xử lý** bị dán lại → cập nhật nguồn, giữ telesale cũ, hiện nhãn “Nhắn lại” cho telesale.
- **Lead đã Số huỷ / Fail / Số hết nhu cầu quá 30 ngày** bị dán lại → mở lại thành “Số mới” và chia lại. Số ngày nằm ở bảng `app_settings`, khoá `lead_reopen_days`.
- **Lead đã làm dịch vụ** bị dán lại → ghi nhận là khách cũ cho CSKH, không tính là lead marketing.
- **Chia lead**: xoay vòng trong những người đang bật nhận lead (ai lâu chưa được chia nhất thì nhận); trực page chọn tay thì vẫn tính một lượt.

### Phân hệ Marketing (đang xây theo giai đoạn)

Giai đoạn 1 — danh mục (file `005_marketing_catalog.sql`):

- **Chỉ quản lý một cơ sở.** Không có danh mục Miền (Miền Bắc / Miền Nam). Cột `branch` sẵn có ở page, chiến dịch, lead, tài khoản giữ nguyên giá trị mặc định `HN` và không hiện trên form; khi mở thêm cơ sở chỉ cần hiện cột này lên và thêm một bộ lọc.
- **Nhân viên Ads**: tên, mã nhân viên nội bộ, tài khoản đăng nhập (nếu có), Đang làm / Nghỉ. Người đã nghỉ vẫn giữ nguyên lịch sử.
- **TKQC** và **phân công theo ngày**: mỗi TKQC tại một thời điểm chỉ có một người phụ trách; giao cho người mới thì phân công cũ tự kết thúc vào hôm trước. Số liệu của ngày nào tính cho người phụ trách ngày đó.
- **Page**: kênh, link, các tài khoản Trực page phụ trách.
- **Chiến dịch**: thuộc một TKQC; mục tiêu (Tin nhắn / Tương tác / Chuyển đổi), dịch vụ, ngày chạy, ngân sách, ID camp.
- **Bài post**: thuộc một chiến dịch; hệ thống tự tách **ID bài** và **ID ads** từ link Facebook / TikTok. Mỗi bài chỉ thuộc một chiến dịch. Link rút gọn / link chia sẻ (fb.watch, /share/, vm.tiktok…) không chứa ID bài nên chỉ khớp khi dán đúng link đó. Bài “Chưa khai báo” là bài trực page dán mà chưa ai khai (dùng từ giai đoạn 2).
- **Quyền** (chặn ngay trong cơ sở dữ liệu): Quản trị và Trưởng Marketing quản lý mọi danh mục Marketing; Nhân viên Ads chỉ thấy TKQC từng được giao và chỉ thêm / sửa chiến dịch, bài post trong TKQC **đang** phụ trách; Nhân viên Ads không đọc được lead.
- Mọi bảng mới đều có thùng rác (không xoá hẳn), nhật ký thay đổi, người tạo / ngày tạo / ngày sửa.

Báo cáo ads hằng ngày (file `006_ad_daily_reports.sql`, bản đơn giản theo yêu cầu 11/11/2026). Menu Marketing tạm thời chỉ có 2 mục:

- **Nhập liệu** (`/marketing/nhap-lieu`): chọn ngày [Hôm nay] [Hôm qua] [Tuỳ chỉnh] (không chọn được ngày chưa tới). Mỗi TK ADS nhân viên phụ trách ngày đó là một nhóm cột nền xanh lá với 2 ô bắt buộc: Chi tiêu, Số lượng tin nhắn; bên dưới là một dòng **Data xin được** chung cho tất cả TKQC (số điện thoại lấy từ trực page nên không tách được theo TKQC — file `010_ads_daily_data.sql`). Điện thoại: mỗi TK ADS một thẻ. Ô chỉ nhận số nguyên ≥ 0, tự thêm dấu chấm hàng nghìn; gõ / dán “1.000.000”, “235,335”, “235 335” đều được. Nút **Gửi báo cáo** chỉ sáng khi đủ mọi ô (nhập 0 là hợp lệ). Mỗi (ngày, TK ADS) gửi một lần; ngày đã gửi thì chỉ xem, kèm nút đi tới Tổng quan. Quản trị / Trưởng Marketing chọn được nhân viên để nhập thay.
- **Tổng quan** (`/marketing/tong-quan`): lọc Hôm nay / Hôm qua / Tuỳ chỉnh (khoảng ngày); mỗi nhân viên một bảng, dòng = ngày, nhóm cột = TK ADS, kèm giờ gửi và nút **Sửa**. Nhân viên sửa được trong 24 giờ kể từ lúc gửi lần đầu (hiện “Còn sửa được … ”, quá hạn thì “Đã khoá”); sửa không làm mới mốc 24 giờ; dòng đã sửa hiện “Đã sửa lúc …”. Quản trị / Trưởng Marketing xem tất cả, lọc theo nhân viên, sửa bất kỳ lúc nào.
- Cơ sở dữ liệu tự chặn: gửi cho TK ADS không phụ trách, ngày chưa tới, gửi trùng, số âm / số thập phân / ô trống, nhân viên sửa quá 24 giờ (“Báo cáo đã quá 24 giờ, không thể sửa”), mọi lệnh xoá. Mọi lần gửi / sửa vào Nhật ký hệ thống (số cũ → số mới, ai, lúc nào).
- **Cài đặt TKQC** (thẻ thứ hai của màn Nhập liệu, file `007_ad_account_setup.sql`): mỗi nhân viên chạy quảng cáo tự khai báo các TKQC mình cầm bằng nút **+ Thêm TKQC** (Tên tài khoản, ID tài khoản, Loại tài khoản: TK thuê / Tự build, Thanh toán: Tài khoản cá nhân / Thẻ công ty). Lưu xong TKQC xuống bảng bên dưới; nút thùng rác hỏi “Xác nhận xoá? Không / Có, xoá”. TKQC chưa có báo cáo → vào Thùng rác (Quản trị khôi phục được); đã có báo cáo → chỉ chuyển sang Ngừng dùng, báo cáo cũ giữ nguyên. Ở màn Nhập số liệu và Tổng quan, ô “Tài khoản quảng cáo” chỉ liệt kê TKQC của chính người đó. Quản trị / Trưởng Marketing thấy TKQC của mọi người, có hai ô lọc Nhân viên quảng cáo → Tài khoản quảng cáo (ô sau chỉ liệt kê TKQC của người đã chọn), và thêm TKQC cho bất kỳ ai.
- Tài khoản được đặt vai trò **Nhân viên Ads** ở Cài đặt → Tài khoản & Phân quyền tự có mặt trong danh sách nhân viên quảng cáo (trùng tên một nhân viên Ads chưa có tài khoản thì gắn vào người đó).
- Các trang Chiến dịch & Bài post, TKQC & Page, Nhân viên Ads tạm ẩn khỏi menu nhưng vẫn mở được; quản lý có đường vào từ thẻ Cài đặt TKQC (vd để chuyển một TKQC sang người khác).

Các giai đoạn sau (chưa làm): 2 — Nhập lead (dán link bài, tự điền Bài → Camp → TKQC → Nhân viên Ads, “Số tôi đã dán”); 3 — nhập file CSV từ Ads Manager; 4 — báo cáo tới mức chiến dịch / bài post; 5 — Mục tiêu & Ngân sách, công trực page, khoá sổ tháng; 6 — Nhập dữ liệu T9–T10/2026.

### Tài khoản, vị trí và phân quyền (file `008_staff_accounts.sql`)

- **Thêm người** ở Cài đặt → Tài khoản & Phân quyền: Tên đăng nhập, Mật khẩu (điền sẵn `123456789@`), Tên nhân viên, Vị trí, Nơi làm việc. Tài khoản đăng nhập được tạo luôn — không phải vào Supabase nữa. Nhân viên đăng nhập bằng **tên đăng nhập** (hệ thống tự đổi thành `<tên>@smilehub.local`); tài khoản cũ vẫn đăng nhập bằng email.
- **Vị trí** quyết định được đọc / sửa dữ liệu gì: COO → Quản trị, Lead Ads → Trưởng Marketing, Nhân viên quảng cáo → Nhân viên Ads, Trực page → Trực page. Chỉ Quản trị cấp cao thêm / sửa người ở vị trí COO.
- **Phân quyền**: tick trang nào thì trang đó hiện ở menu trái của người đó (và mở được); người mới thêm chưa có trang nào. Tài khoản cũ chưa phân quyền vẫn thấy menu theo vai trò. Quản trị cấp cao luôn thấy mọi trang. Trong hộp Phân quyền còn có hai quyền riêng: Xoá dữ liệu, Xuất file.
- Mỗi dòng nhân sự: bút = sửa (kể cả đặt lại mật khẩu), thùng rác = xoá (ẩn khỏi danh sách + cấm đăng nhập, dữ liệu cũ giữ nguyên; cần tick “Xoá dữ liệu”), khoá đóng = cấm đăng nhập / khoá mở = hoạt động.
- **Danh sách cơ sở** (Cài đặt → Danh sách cơ sở): tên, địa chỉ; là danh sách “Nơi làm việc” khi thêm người.
- Bấm “⋮” cạnh tên ở cuối menu trái: xem tên đăng nhập, vị trí; **Đổi mật khẩu**, **Đăng xuất**.
- Quản trị cấp cao (file `009_admin_account.sql`): tên đăng nhập mặc định **admin**; nút bút ở dòng của mình để sửa tên, tên đăng nhập, đặt mật khẩu mới. Chỉ Quản trị cấp cao thấy nút xoá ở Danh sách cơ sở (chỉ xoá được cơ sở chưa có nhân sự).
- Mọi thông báo góc phải trên có dấu ✕ để tắt.

### An toàn dữ liệu

**Lớp 1 — Không ai xoá được.** Số điện thoại đã thêm vào thì không ai xoá được. Ứng dụng không có nút “Xoá”, chỉ có **Chuyển vào thùng rác** (ẩn đi, khôi phục lại được) — áp dụng cho lead và mọi danh mục (kênh, page, TKQC, phân công TKQC, nhân viên Ads, chiến dịch, bài post, dịch vụ).

- **Chuyển vào thùng rác**: chỉ tài khoản được Quản trị cấp cao **tick quyền “Xoá dữ liệu”** ở **Cài đặt → Tài khoản & Phân quyền** — chỉ những tài khoản đó mới thấy nút. Mặc định không ai được tick; Quản trị cấp cao luôn có quyền. Người không được tick chỉ đổi trạng thái (Fail, Số huỷ…). Với danh mục, ngoài ô tick còn phải đúng vai trò quản lý: Quản trị hoặc Trưởng Marketing (danh mục Marketing), Quản trị hoặc Trưởng Telesale (dịch vụ).
- **Khôi phục** (Cài đặt → Thùng rác): Quản trị trở lên.
- **Xoá vĩnh viễn**: chỉ Quản trị cấp cao (chủ phòng khám), phải nhập lại mật khẩu, và chỉ với bản ghi đã nằm trong thùng rác đủ 90 ngày. Không có gì tự bị xoá vĩnh viễn.
- **Số điện thoại của một lead không sửa hay gỡ được** (trừ Quản trị cấp cao). Số sai thì đánh dấu “Số sai”.
- Chuyển hơn 20 bản ghi vào thùng rác (tính dồn trong 10 phút) phải nhập lại mật khẩu.
- Các điều trên được chặn ngay trong cơ sở dữ liệu, không chỉ ở giao diện: gọi thẳng API cũng không xoá hay sửa số được.
- Số điện thoại của lead trong thùng rác được coi là số mới: dán lại sẽ tạo lead mới. Khi đó khôi phục lead cũ sẽ báo trùng số.

**Lớp 2 — Nhật ký thay đổi.** Mọi lần thêm / sửa / chuyển vào thùng rác / khôi phục đều được cơ sở dữ liệu tự ghi lại: bảng nào, bản ghi nào, giá trị cũ, giá trị mới, ai, lúc nào, địa chỉ IP. Ứng dụng không sửa hay xoá được nhật ký.

- Mở một lead → tab **Lịch sử thay đổi** → **Hoàn tác về phiên bản này** (Trưởng Telesale trở lên).
- **Cài đặt → Nhật ký hệ thống**: lọc theo người / thời gian / hành động / loại dữ liệu; **Hoàn tác theo lô** — gỡ mọi thay đổi của một tài khoản trong một khoảng thời gian (xem trước rồi mới áp dụng; cột nào đã có người khác sửa tiếp thì được giữ nguyên và báo là xung đột).
- **Cảnh báo bất thường**: một tài khoản sửa / chuyển vào thùng rác quá 150 bản ghi trong một giờ → hiện cảnh báo cho Quản trị và tự khoá tài khoản đó (không bao giờ tự khoá Quản trị cấp cao). Quản trị mở khoá ở Nhật ký hệ thống.
- Nhật ký chỉ có từ lúc chạy `003_data_safety.sql`; thay đổi trước đó không được ghi.

**Các ngưỡng** (90 ngày, 20 bản ghi, 150 bản ghi / giờ, có tự khoá hay không) nằm ở **Cài đặt → Sao lưu & Khôi phục**, chỉ Quản trị cấp cao đổi được.

**Lớp 3 và 4 — Sao lưu.** *Chưa thiết lập.* Trang **Sao lưu & Khôi phục** đã có chỗ hiển thị lần sao lưu gần nhất, dung lượng, thành công / lỗi và sổ ghi “chạy thử khôi phục” hằng quý, nhưng:

- Lớp 3 (sao lưu hằng ngày + PITR của Supabase) cần nâng gói Supabase. Khôi phục kiểu này là khôi phục **cả cơ sở dữ liệu** — muốn lấy lại vài bản ghi thì khôi phục ra một project tạm rồi chép sang.
- Lớp 4 (bản sao lưu riêng hằng đêm, mã hoá, lưu ngoài Supabase; giữ 30 bản ngày + 12 bản tháng) chưa có — cần chọn nơi lưu và tạo khoá mã hoá.

