import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Store Checks",
  description: "Monitors all store domains twice a day and reports issues to Discord",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
