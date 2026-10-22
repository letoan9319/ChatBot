import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { THEME_INIT_SCRIPT } from "@/core/theme";
import "@fontsource-variable/nunito";
import "@fontsource-variable/jetbrains-mono";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "LearnStep - Hiểu thêm mỗi ngày",
    template: "%s | LearnStep",
  },
  applicationName: "LearnStep",
  description:
    "LearnStep giúp bạn tự học Giải tích, Đại số tuyến tính và Vật lý từ tài liệu riêng, với trợ giảng AI giải thích từng bước và trích dẫn nguồn.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
