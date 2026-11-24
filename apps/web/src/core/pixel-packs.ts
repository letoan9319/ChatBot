export const avatarIds = ["frog", "owl", "rabbit", "cat", "capybara", "axolotl"] as const;
export type AvatarId = (typeof avatarIds)[number];

export const avatarLabels: Record<AvatarId, string> = {
  frog: "Ếch đeo kính",
  owl: "Cú mèo",
  rabbit: "Thỏ hồng",
  cat: "Mèo khăn xanh",
  capybara: "Capybara",
  axolotl: "Kỳ giông hồng",
};

export const stickerIds = ["thumbs-up", "trophy", "thinking", "reading", "hello", "celebrate"] as const;
export type StickerId = (typeof stickerIds)[number];

export const stickerLabels: Record<StickerId, string> = {
  "thumbs-up": "Hay lắm",
  trophy: "Làm được rồi",
  thinking: "Để mình nghĩ",
  reading: "Đang học bài",
  hello: "Chào cả nhóm",
  celebrate: "Ăn mừng",
};
