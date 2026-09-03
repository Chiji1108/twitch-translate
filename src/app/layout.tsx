import type { Metadata } from "next";
import { Geist, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const noto = Noto_Sans_JP({ variable: "--font-noto", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Miri Translator by ミリちゃんねる｜日本語配信向けAI翻訳字幕",
  description:
    "日本語を学ぶ海外の視聴者へ。ふりがな付き日本語字幕と翻訳を届ける、精度重視の配信字幕ツール。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${geist.variable} ${noto.variable}`}>
      <body>{children}</body>
    </html>
  );
}
