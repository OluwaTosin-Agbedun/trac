"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type CmsNavItem = { href: string; label: string; roles: string[] };

export function CmsNavLinks({ items }: { items: CmsNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="CMS" className="flex flex-col gap-1">
      {items.map((it) => {
        const active = it.href === "/admin" ? pathname === "/admin" : pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`rounded px-3 py-2.5 no-underline ${active ? "bg-[#1d3a6b] font-semibold text-white" : "text-[#d6deea] hover:bg-[#17325f] hover:text-white"}`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
