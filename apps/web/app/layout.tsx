import type { Metadata } from "next";

import "./styles.css";

export const metadata: Metadata = {
  title: "SANSUN学園 成績管理システム",
  description: "SANSUN学園の成績管理システム",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
