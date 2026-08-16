import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auravis",
  description:
    "Point at anything, say what you want, and let an agent act within a limit it cannot exceed.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d12",
};

import TopNav from "./TopNav";
import Footer from "./Footer";
import BottomNav from "./BottomNav";
import { WalletProvider } from "./wallet";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* pb-16 keeps content clear of the mobile bottom bar; sm:pb-0 removes it
          where the bar doesn't exist. */}
      <body className="flex min-h-dvh flex-col pb-16 sm:pb-0">
        <div className="aurora-ribbon" aria-hidden />
        <WalletProvider>
          <TopNav />
          <div className="flex flex-1 flex-col">{children}</div>
          <Footer />
          <BottomNav />
        </WalletProvider>
      </body>
    </html>
  );
}
