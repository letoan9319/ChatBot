import Image from "next/image";
import { avatarIds, type AvatarId } from "@/core/pixel-packs";

export function PixelAvatar({ avatar, username, className }: {
  avatar?: AvatarId | null;
  username: string;
  className: string;
}) {
  return <span className={className} aria-hidden="true">
    {avatar && avatarIds.includes(avatar)
      ? <Image src={`/avatars/${avatar}.webp`} width={48} height={48} alt="" unoptimized
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
      : username.slice(0, 2).toUpperCase()}
  </span>;
}
