export type SidebarDestination = "overview" | "study" | "documents" | "history" | "groups" | "settings";

export function SidebarIcon({ name, className }: { name: SidebarDestination; className?: string }) {
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
