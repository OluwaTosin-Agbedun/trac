"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { readonly href: string; readonly label: string };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Primary navigation on the dark bar. Scrolls sideways on phones rather than wrapping. */
function Bar({ items, pathname }: { items: readonly Item[]; pathname: string | null }) {
  return (
    <nav aria-label="Main" className="-mx-1 flex overflow-x-auto text-[15px] font-semibold">
      {items.map((it) => {
        const active = pathname ? isActive(pathname, it.href) : false;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-12 shrink-0 items-center whitespace-nowrap border-b-[3px] px-4 no-underline ${
              active ? "border-[#e8b021] bg-white/10 text-white" : "border-transparent text-[#dbe4f3] hover:bg-white/5 hover:text-white"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function NavBarLinks({ items }: { items: readonly Item[] }) {
  return <Bar items={items} pathname={usePathname()} />;
}

export function StaticNavBarLinks({ items }: { items: readonly Item[] }) {
  return <Bar items={items} pathname={null} />;
}
