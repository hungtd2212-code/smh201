import * as React from "react"

/**
 * Giao diện sáng / tối: class `dark` trên thẻ <html>, lựa chọn lưu ở localStorage.
 * Đoạn script nhỏ trong src/app/layout.tsx đọc lại lựa chọn này trước khi trang
 * được vẽ, nên không bị nháy sáng khi tải lại.
 */
export const THEME_STORAGE_KEY = "theme"

/** Chạy ngay trong <head>, trước khi trình duyệt vẽ trang. */
export const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => observer.disconnect()
}

export function useIsDark() {
  return React.useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false
  )
}

export function setDarkMode(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light")
  } catch {
    // localStorage bị chặn (chế độ riêng tư) → chỉ đổi cho lần xem này.
  }
}
