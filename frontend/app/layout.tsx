import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forza Road Finder",
  description: "Find unexplored roads in Forza Horizon instantly",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* CSP мета-тег — явно разрешаем blob: для отображения скриншотов */}
        <meta
          httpEquiv="Content-Security-Policy"
          content="img-src 'self' data: blob: https://*.xboxlive.com https://*.xbox.com;"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
