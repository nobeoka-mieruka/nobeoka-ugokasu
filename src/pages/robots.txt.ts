import type { APIRoute } from "astro";
import { siteConfig } from "../config/siteConfig";

export const GET: APIRoute = () => {
  const body = siteConfig.allowIndexing
    ? `User-agent: *
Allow: /

Sitemap: ${siteConfig.siteUrl}/sitemap-index.xml
`
    : `User-agent: *
Disallow: /

Sitemap: ${siteConfig.siteUrl}/sitemap-index.xml
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
