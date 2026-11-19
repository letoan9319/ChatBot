export const groupReactionOptions = {
  like: { code: 0x1f44d, label: "Thích" },
  love: { code: 0x2764, label: "Yêu thích" },
  laugh: { code: 0x1f602, label: "Buồn cười" },
  surprised: { code: 0x1f62e, label: "Ngạc nhiên" },
  sad: { code: 0x1f622, label: "Buồn" },
  celebrate: { code: 0x1f389, label: "Chúc mừng" },
} as const;

export type GroupReaction = keyof typeof groupReactionOptions;
export type GroupReactionSummary = {
  reaction: GroupReaction;
  count: number;
  reacted: boolean;
};
