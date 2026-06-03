import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forza Road Finder",
  description: "Find unexplored roads in Forza Horizon 6 instantly",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Content-Security-Policy" content="img-src 'self' data: blob: https://*.xboxlive.com https://*.xbox.com;" />
      </head>
      <body>{children}</body>
    </html>
  );
}
