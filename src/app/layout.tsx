import type { Metadata } from "next";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import { siteConfig } from "@/components/site/siteConfig";
import "./globals.css";

const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"], display: "swap" });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], display: "swap" });

const SITE_NAME = "Nigerian Institution Compliance Monitoring Portal";
const DESCRIPTION =
  "Financial disclosure across Nigerian tertiary institutions. Athena Centre for Policy and Leadership, in partnership with the Federal Ministry of Education.";
// Absolute addresses (Open Graph, canonical links) are built from SITE_URL and the base path; with no
// SITE_URL set, no absolute address is claimed.
const site = siteConfig();

export const metadata: Metadata = {
  ...(site.origin ? { metadataBase: new URL(`${site.origin}${site.basePath}/`) } : {}),
  title: {
    template: `%s · ${SITE_NAME}`,
    default: SITE_NAME,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "en_NG",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: DESCRIPTION,
  },
  twitter: { card: "summary", title: SITE_NAME, description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG" className={`${publicSans.variable} ${sourceSerif.variable} antialiased`}>
      <body className="min-h-screen flex flex-col bg-white text-ink">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
