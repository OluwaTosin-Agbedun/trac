import type { Metadata } from "next";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"], display: "swap" });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: {
    template: "%s · Nigerian Institution Compliance Monitoring Portal",
    default: "Nigerian Institution Compliance Monitoring Portal",
  },
  description:
    "Financial disclosure across Nigerian tertiary institutions. Athena Centre for Policy and Leadership, in partnership with the Federal Ministry of Education.",
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
