import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Procurement CheckBot",
  description: "Check for the best supplier for given material for a site",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
