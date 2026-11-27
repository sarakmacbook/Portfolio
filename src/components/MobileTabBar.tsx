"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, isSettingsPath } from "@/lib/nav-links";
import { usePrivacy } from "./PrivacyProvider";

const tabs = [
  { href: "/", label: "Home", icon: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" },
  { href: "/activity", label: "Activity", icon: "M3 12h4l3-7 4 14 3-7h4" },
  { href: "/exchanges", label: "Imports", icon: "M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" },
  { href: "/settings", label: "Settings", icon: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" },
];

export default function MobileTabBar() {
  const path = usePathname();
  const { locked } = usePrivacy();
  if (locked) return null;

  return (
    <nav className="mobile-tab-bar md:hidden" aria-label="Quick navigation">
      {tabs.map((tab) => {
        const active = tab.href === "/settings" ? isSettingsPath(path) :
          tab.href === "/exchanges" ? isActivePath(path, "/exchanges") || isActivePath(path, "/imports") :
          isActivePath(path, tab.href);
        return (
          <Link key={tab.href} href={tab.href} className="mobile-tab" aria-current={active ? "page" : undefined}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={tab.icon} />
            </svg>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
