// robots.txt: the public site may be crawled; the team area and any API may not. The sitemap is
// named only when SITE_URL gives the site's public address.
import type { MetadataRoute } from "next";
import { absoluteUrl, siteConfig } from "@/components/site/siteConfig";

export default function robots(): MetadataRoute.Robots {
  const cfg = siteConfig();
  const sitemap = absoluteUrl("/sitemap.xml", cfg);
  return {
    rules: { userAgent: "*", allow: `${cfg.basePath}/`, disallow: [`${cfg.basePath}/admin`, `${cfg.basePath}/api`] },
    ...(sitemap ? { sitemap } : {}),
  };
}
