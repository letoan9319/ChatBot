import Link from "next/link";

export function Brand({ workspace = false }: { workspace?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="LearnStep - Trang chủ">
      LearnStep
      <span>{workspace ? "GÓC HỌC TẬP" : "HIỂU THÊM MỖI NGÀY"}</span>
    </Link>
  );
}
