export const welcomeGuidePath = "/study?welcome=1";

export function shouldShowWelcomeGuide(welcome: unknown, hasConversation: boolean, hasLibrary: boolean) {
  return welcome === "1" && !hasConversation && !hasLibrary;
}

export const guideTopics = {
  study: {
    title: "Trợ giảng",
    intro: "Hỏi về một khái niệm, gửi đề bài và mở nguồn để đối chiếu lời giải.",
    art: "tutor",
    steps: [
      "Vào Học tập. Nhập câu hỏi hoặc dán ảnh đề bài vào ô chat, rồi chọn môn học nếu muốn thu hẹp phạm vi.",
      "Chọn Theo tài liệu để tra kho chung hoặc các tài liệu bạn chọn qua nút cộng. Chọn Tìm kiếm để tra web hoặc Nghiên cứu để tìm thêm bài báo và đọc phần tổng hợp chi tiết.",
      "Bấm Dừng khi muốn ngắt phản hồi. Chọn trích dẫn dưới câu trả lời hoặc mở Nguồn để xem đoạn trích, trang gốc hay liên kết tham khảo.",
    ],
    action: "Mở trợ giảng",
  },
  library: {
    title: "Kho tài liệu",
    intro: "Tìm giáo trình trong kho chung hoặc tải tài liệu của riêng bạn lên.",
    art: "library",
    steps: [
      "Vào Kho tài liệu, chọn Tài liệu chung, rồi tìm theo tên, môn học hoặc khoảng trang.",
      "Trong Tài liệu của tôi, chọn môn học và bấm Tải tài liệu lên để thêm PDF hoặc DOCX. Chờ đến khi tài liệu báo Sẵn sàng.",
      "Chọn Mở PDF hoặc Tải DOCX để xem bản gốc. Đánh dấu Chọn hỏi đáp để dùng tài liệu làm nguồn trong phiên học.",
    ],
    action: "Mở kho tài liệu",
  },
  history: {
    title: "Phiên học",
    intro: "Tiếp tục câu hỏi cũ hoặc mở một phiên tạm thời.",
    art: "history",
    steps: [
      "Chọn một phiên ở mục Gần đây hoặc mở Lịch sử để tìm lại hội thoại.",
      "Trong Học tập, chọn Chat tạm thời khi muốn đặt câu hỏi mà không đưa phiên vào lịch sử.",
      "Trong Lịch sử, bấm Xóa ở một phiên hoặc Xóa toàn bộ lịch sử. Kiểm tra lựa chọn trước khi xác nhận vì nội dung đã xóa không thể khôi phục.",
    ],
    action: "Mở lịch sử",
  },
  plans: {
    title: "Kế hoạch",
    intro: "Chia mục tiêu học thành các việc có thể theo dõi.",
    art: "planner",
    steps: [
      "Vào Kế hoạch, chọn Học theo tiến trình hoặc Tự học rồi bấm Tạo kế hoạch.",
      "Điền Chủ đề, Mục tiêu và ngày ôn nếu cần. Chọn Tài liệu nguồn rồi bấm Lưu kế hoạch.",
      "Trong Học theo tiến trình, trả lời câu tự kiểm tra để mở bài tiếp theo. Trong Tự học, dùng Thêm ghi chú và Thêm thẻ để ôn lại.",
    ],
    action: "Mở kế hoạch",
  },
  groups: {
    title: "Nhóm học",
    intro: "Trao đổi bài tập và chia sẻ cách giải với bạn học.",
    art: "groups",
    steps: [
      "Vào Nhóm học. Chọn Tạo nhóm để mở nhóm mới hoặc chọn một nhóm rồi bấm Tham gia nhóm học.",
      "Dán ảnh vào ô chat hoặc dùng Đính kèm ảnh. Mở Sticker và emoji để gửi sticker hoặc chèn emoji. Dùng Thả cảm xúc bên dưới tin nhắn để phản hồi.",
      "Nếu là chủ nhóm, mở Thành viên để sửa thông tin, loại thành viên hoặc xóa nhóm. Xóa nhóm cũng xóa lịch sử chat của nhóm.",
    ],
    action: "Mở nhóm học",
  },
  overview: {
    title: "Tiến độ và thông báo",
    intro: "Xem nhịp học và theo dõi các cập nhật trong app.",
    art: "progress",
    steps: [
      "Vào Tổng quan để xem chuỗi ngày học, tổng số ngày học, tài liệu sẵn sàng và những phiên đã lưu.",
      "Trong Học tập, chọn chuỗi ngày học trên thanh đầu trang để xem các ngày đã được ghi nhận.",
      "Mở Thông báo trên thanh đầu trang để xem cập nhật về tài liệu, câu trả lời và nhóm học. Chọn thông báo để đến nội dung liên quan khi có liên kết.",
    ],
    action: "Mở tổng quan",
  },
  settings: {
    title: "Hồ sơ và cài đặt",
    intro: "Tùy chỉnh ảnh đại diện và cách đọc, gửi câu hỏi.",
    art: "profile",
    steps: [
      "Mở Tài khoản, chọn Hồ sơ và cài đặt, chọn Ảnh đại diện rồi bấm Lưu ảnh đại diện.",
      "Trong Giao diện & đọc, chọn Chế độ hiển thị và Cỡ chữ lời giải.",
      "Trong Hội thoại, chọn có dùng Enter để gửi hay không và bật hoặc tắt Tự cuộn theo câu trả lời.",
    ],
    action: "Mở cài đặt",
  },
} as const;

export type GuideTopic = keyof typeof guideTopics;
export const guideTopicIds = Object.keys(guideTopics) as GuideTopic[];

export const welcomeCards = [
  { topic: "study", title: "Hỏi trợ giảng", tryNext: "Thử hỏi “Gradient là gì?” rồi mở một trích dẫn nếu câu trả lời có nguồn." },
  { topic: "library", title: "Tìm và dùng tài liệu", tryNext: "Thử tìm một giáo trình trong Tài liệu chung, rồi chọn tài liệu đó khi đặt câu hỏi." },
  { topic: "groups", title: "Lập kế hoạch và học cùng nhóm", tryNext: "Thử tạo một kế hoạch ôn bài hoặc tìm một nhóm theo môn bạn đang học." },
] as const satisfies ReadonlyArray<{ topic: GuideTopic; title: string; tryNext: string }>;
