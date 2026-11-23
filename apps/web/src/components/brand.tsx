import Link from "next/link";

export function Brand({ workspace = false, onWorkspaceHome }: {
  workspace?: boolean;
  onWorkspaceHome?: () => void;
}) {
  return (
    <Link
      className="brand"
      href={workspace ? "/study" : "/"}
      aria-label={workspace ? "LearnStep - Tổng quan học tập" : "LearnStep - Trang chủ"}
      onNavigate={onWorkspaceHome ? (event) => {
        event.preventDefault();
        onWorkspaceHome();
      } : undefined}
    >
      LearnStep
      <span>{workspace ? "GÓC HỌC TẬP" : "HIỂU THÊM MỖI NGÀY"}</span>
    </Link>
  );
}
