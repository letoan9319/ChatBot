const messages: Record<string, string> = {
  email_address_not_authorized:
    "Dịch vụ email chưa cho phép gửi xác nhận tới địa chỉ này. Quản trị viên cần cấu hình dịch vụ gửi email trước khi mở đăng ký.",
  over_email_send_rate_limit:
    "Đã đạt giới hạn gửi email xác nhận. Vui lòng chờ rồi thử lại.",
  over_request_rate_limit:
    "Có quá nhiều yêu cầu. Vui lòng chờ một lúc rồi thử lại.",
  signup_disabled: "Hệ thống hiện chưa mở đăng ký tài khoản mới.",
  email_provider_disabled: "Hệ thống hiện chưa bật đăng nhập bằng email.",
  email_not_confirmed:
    "Bạn cần xác nhận địa chỉ email trước khi đăng nhập. Hãy kiểm tra hộp thư và thư rác.",
  invalid_credentials: "Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.",
  user_already_exists: "Email này đã được đăng ký. Bạn có thể đăng nhập hoặc đặt lại mật khẩu.",
  email_exists: "Email này đã được đăng ký. Bạn có thể đăng nhập hoặc đặt lại mật khẩu.",
  email_address_invalid: "Địa chỉ email không được chấp nhận. Vui lòng dùng địa chỉ email thật.",
  weak_password: "Mật khẩu chưa đạt yêu cầu. Hãy dùng mật khẩu dài hơn và khó đoán hơn.",
  same_password: "Mật khẩu mới cần khác mật khẩu hiện tại.",
  otp_expired:
    "Liên kết xác thực không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới.",
  flow_state_not_found:
    "Liên kết xác thực không hợp lệ hoặc được mở ở trình duyệt khác. Vui lòng yêu cầu liên kết mới trên trình duyệt này.",
  flow_state_expired:
    "Liên kết xác thực đã hết hạn. Vui lòng yêu cầu liên kết mới.",
  bad_code_verifier:
    "Liên kết xác thực cần được mở trên cùng trình duyệt đã gửi yêu cầu. Vui lòng thử lại.",
  captcha_failed: "Không thể xác minh yêu cầu đăng ký. Vui lòng thử lại sau.",
  unexpected_failure: "Máy chủ chưa thể hoàn tất yêu cầu tài khoản. Vui lòng thử lại sau.",
};

export function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    if ("code" in error && typeof error.code === "string" && Object.hasOwn(messages, error.code)) {
      return messages[error.code];
    }
    if ("name" in error && error.name === "AuthSessionMissingError") {
      return "Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới.";
    }
    if ("name" in error && error.name === "AuthRetryableFetchError") {
      return "Không thể kết nối dịch vụ tài khoản. Vui lòng kiểm tra mạng và thử lại.";
    }
    if ("message" in error && error.message === "Invalid API key") {
      return "Kết nối dịch vụ tài khoản chưa được cấu hình đúng. Vui lòng liên hệ quản trị viên.";
    }
  }
  return "Không thể hoàn thành yêu cầu. Vui lòng thử lại sau hoặc liên hệ quản trị viên.";
}
