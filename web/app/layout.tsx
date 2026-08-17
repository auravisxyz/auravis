import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.auravis.xyz"),
  title: "Auravis",
  description:
    "Point at anything, say what you want, and let an agent act within a limit it cannot exceed.",
  // icon.png, apple-icon.png, opengraph-image.png and twitter-image.png sit in
  // app/ and are wired up by file convention. Declared here so the card has a
  // title and description of its own when a link is pasted somewhere.
  openGraph: {
    title: "Auravis",
    description:
      "An agent that shops for you. A limit it can never break, enforced by a smart contract on X Layer.",
    url: "https://www.auravis.xyz",
    siteName: "Auravis",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Auravis",
    description:
      "An agent that shops for you. A limit it can never break, enforced by a smart contract on X Layer.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d12",
};

import TopNav from "./TopNav";
import Footer from "./Footer";
import BottomNav from "./BottomNav";
import WalletPicker from "./WalletPicker";
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
          <WalletPicker />
        </WalletProvider>
      </body>
    </html>
  );
}
