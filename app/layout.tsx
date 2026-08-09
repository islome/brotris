import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BOOTSTRAP } from "./lib/settings";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BROTRIS · 2026",
  description: "Falling-blocks like my hope for the future.",
  applicationName: "BROTRIS",
  manifest: "/manifest.webmanifest",
  // Installed to the home screen, the game runs without browser chrome — which
  // is where the board finally gets the full width of the phone.
  appleWebApp: {
    capable: true,
    title: "BROTRIS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // An explicit link wins over the legacy /apple-touch-icon.png convention.
    apple: [{ url: "/apple-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  // Next emits the modern `mobile-web-app-capable`; iOS before 16.4 only reads
  // the prefixed one, and without it the app opens inside Safari's chrome.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // lets the page own the notch area; CSS pads it back
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#060609" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // THEME_BOOTSTRAP stamps data-theme before hydration, so the server markup
    // legitimately differs from the client here.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {children}
      </body>
    </html>
  );
}
