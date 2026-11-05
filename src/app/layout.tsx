import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Throughline",
  description:
    "Keeps your product roadmap and technical roadmap in sync with what engineering ships.",
};

// Runs before the first paint, so the page never flashes the wrong theme. "theme" in localStorage
// holds "light" or "dark" when the reader picked one (see ThemeControl); otherwise the system decides.
const THEME_SCRIPT = `(function(){
var m=matchMedia("(prefers-color-scheme: dark)");
function apply(){var t;try{t=localStorage.getItem("theme")}catch(e){}
document.documentElement.classList.toggle("dark",t==="dark"||(t!=="light"&&m.matches))}
apply();m.addEventListener("change",apply);addEventListener("storage",apply)})()`;

/**
 * The document around every page: fonts, global styles and the theme.
 *
 * Args:
 *   children: The page.
 *
 * Returns:
 *   The html element.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script adds the "dark" class before React hydrates, so the class differs from the server's.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
