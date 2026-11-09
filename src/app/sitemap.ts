// sitemap.xml: the public pages and every verified register record. Addresses need SITE_URL (the
// public origin); without it there is no sitemap to give, so it is empty. Read per request from the
// cached register; if the register cannot be read, the fixed pages are still listed.
import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getRegister, getRegisterStatus } from "@/server/data/public";
import { absoluteUrl, siteConfig } from "@/components/site/siteConfig";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const cfg = siteConfig();
  if (!cfg.origin) return [];
  await connection();
  const at = (path: string) => absoluteUrl(path, cfg)!;
  const pages: MetadataRoute.Sitemap = [
    { url: at("/"), changeFrequency: "weekly", priority: 1 },
    { url: at("/institutions"), changeFrequency: "daily", priority: 0.9 },
    { url: at("/methodology"), changeFrequency: "monthly", priority: 0.6 },
    { url: at("/compare"), changeFrequency: "monthly", priority: 0.4 },
  ];
  try {
    const [register, status] = await Promise.all([getRegister(), getRegisterStatus()]);
    if (!status.visible) return pages;
    const records: MetadataRoute.Sitemap = register.rows
      .filter((r) => r.verified)
      .map((r) => ({ url: at(`/institutions/${r.slug}`), ...(r.verifiedAt ? { lastModified: r.verifiedAt } : {}), changeFrequency: "weekly", priority: 0.7 }));
    return [...pages, ...records];
  } catch (err) {
    console.error("[sitemap] could not load the register:", err instanceof Error ? err.message : err);
    return pages;
  }
}
