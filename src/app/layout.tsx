import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Complete IBM Plex Sans faces (latin and cyrillic), SIL OFL.
 * Files live in the repo so the production build does not fetch Google Fonts.
 */
const ibmPlexSans = localFont({
  variable: "--font-ibm-plex-sans",
  display: "swap",
  src: [
    { path: "./fonts/IBMPlexSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexSans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexSans-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/IBMPlexSans-Bold.woff2", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Finenumbers OSS Platform",
  description: "Внутренняя платформа мониторинга SIP-регистраций",
  icons: {
    icon: [{ url: "/brand/favicon.jpg", type: "image/jpeg" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${ibmPlexSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
