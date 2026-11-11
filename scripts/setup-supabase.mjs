#!/usr/bin/env node
// Hỏi 2 giá trị kết nối Supabase, kiểm tra cho đúng loại, rồi ghi vào .env.local.
// Chạy: npm run setup:supabase

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const ENV_FILE = process.env.ENV_FILE ?? ".env.local";

/** Bỏ dấu cách, dấu ngoặc và phần "TÊN_BIẾN=" nếu lỡ dán kèm. */
const clean = (text) =>
  text
    .trim()
    .replace(/^[A-Z_]+=/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

/** Trả về chuỗi lỗi, hoặc null nếu hợp lệ. */
function checkUrl(value) {
  if (!value) return "Chưa dán gì cả.";
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(value))
    return "Không đúng dạng. Project URL trông như: https://abcdxyz.supabase.co";
  return null;
}

function checkKey(value) {
  if (!value) return "Chưa dán gì cả.";
  if (value.startsWith("sb_secret_"))
    return "Đây là khoá SECRET — không được dùng ở đây. Hãy sao chép khoá PUBLISHABLE (bắt đầu bằng sb_publishable_).";
  if (value.startsWith("sb_publishable_")) return null;

  // Project cũ dùng khoá dạng JWT: chỉ nhận loại "anon", từ chối "service_role".
  if (value.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(
        Buffer.from(value.split(".")[1], "base64url").toString("utf8"),
      );
      if (payload.role === "anon") return null;
      if (payload.role === "service_role")
        return "Đây là khoá service_role (bí mật) — không được dùng ở đây. Hãy sao chép khoá anon / publishable.";
    } catch {
      // rơi xuống thông báo chung bên dưới
    }
  }
  return "Không đúng dạng. Publishable key bắt đầu bằng sb_publishable_";
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

// Hàng đợi các dòng người dùng nhập (chạy đúng cả khi gõ tay lẫn khi dán nhiều dòng một lúc).
const pendingLines = [];
let waiting = null;
let inputEnded = false;
rl.on("line", (line) => {
  if (waiting) {
    waiting(line);
    waiting = null;
  } else pendingLines.push(line);
});
rl.on("close", () => {
  inputEnded = true;
  waiting?.(null);
});
const nextLine = () =>
  pendingLines.length > 0
    ? Promise.resolve(pendingLines.shift())
    : inputEnded
      ? Promise.resolve(null)
      : new Promise((resolve) => (waiting = resolve));

async function ask(question, check) {
  for (;;) {
    process.stdout.write(question);
    const line = await nextLine();
    if (line === null) {
      console.log("\nĐã huỷ — chưa ghi gì vào file.");
      process.exit(1);
    }
    const value = clean(line);
    const problem = check(value);
    if (!problem) return value;
    console.log(`  ✗ ${problem}\n`);
  }
}

console.log("\nKết nối Supabase — lấy 2 giá trị ở Supabase: nút Connect, hoặc Project Settings → API Keys.\n");

const url = (await ask("1) Dán Project URL rồi nhấn Enter:\n> ", checkUrl)).replace(/\/$/, "");
console.log("  ✓ Project URL hợp lệ\n");

const key = await ask("2) Dán Publishable key rồi nhấn Enter:\n> ", checkKey);
console.log("  ✓ Publishable key hợp lệ\n");

rl.close();

writeFileSync(
  ENV_FILE,
  [
    "# Kết nối Supabase — tạo bởi `npm run setup:supabase`. File này không được đưa lên GitHub.",
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${key}`,
    "",
  ].join("\n"),
);

console.log(`Đã lưu vào ${ENV_FILE}. Chạy lại ứng dụng (npm run dev) để dùng dữ liệu thật.\n`);
