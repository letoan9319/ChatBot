export type SidebarDestination = "overview" | "study" | "plans" | "documents" | "history" | "groups" | "settings" | "new" | "search";

export function SidebarIcon({ name, className }: { name: SidebarDestination | "attach" | "signout"; className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {name === "overview" && <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>}
      {name === "study" && <>
        <path d="M12 5.5C9 3.5 5.5 3 2.5 4v15c3-1 6.5-.5 9.5 1.5 3-2 6.5-2.5 9.5-1.5V4c-3-1-6.5-.5-9.5 1.5Z" />
        <path d="M12 5.5v15" />
      </>}
      {name === "plans" && <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4m10-4v4M3 10h18m-12 5 2 2 4-4" />
      </>}
      {name === "new" && <path d="M12 5v14M5 12h14" />}
      {name === "attach" && <path d="m9 14 6.6-6.6a2 2 0 0 1 2.8 2.8l-8 8a4 4 0 0 1-5.7-5.7l8.2-8.2a5 5 0 0 1 7.1 7.1l-8.2 8.2" />}
      {name === "signout" && <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5m4-12 4 4-4 4m-5-4h9" />}
      {name === "search" && <>
        <circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" />
      </>}
      {name === "documents" && <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </>}
      {name === "history" && <>
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </>}
      {name === "groups" && <>
        <circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2" />
      </>}
      {name === "settings" && <>
        <path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10" />
        <circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="9" cy="18" r="2" />
      </>}
    </svg>
  );
}
