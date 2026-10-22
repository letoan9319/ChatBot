import Link from "next/link";
import { LearningScene } from "@/components/learning-scene";
import { Brand } from "@/components/brand";

const courses = [
  {
    name: "Giải tích",
    formula: "f′(x)",
    label: "TỪ GIỚI HẠN ĐẾN TÍCH PHÂN",
    description: "Gỡ rối công thức, hiểu ý nghĩa và theo dõi từng bước giải.",
    color: "green",
  },
  {
    name: "Đại số tuyến tính",
    formula: "Ax = b",
    label: "MA TRẬN, VECTOR & HƠN THẾ",
    description:
      "Kết nối những khái niệm trừu tượng với ví dụ trong giáo trình.",
    color: "purple",
  },
  {
    name: "Vật lý đại cương",
    formula: "F = ma",
    label: "HIỂU HIỆN TƯỢNG, NHỚ BẢN CHẤT",
    description: "Tìm hiểu các định luật và cách vận dụng vào bài tập.",
    color: "yellow",
  },
];

export default function Home() {
  return (
    <main className="landing" id="dau-trang">
      <a href="#noi-dung" className="skip-link">
        Đến nội dung chính
      </a>
      <header className="site-header wrap">
        <Brand />
        <nav aria-label="Điều hướng chính">
          <a href="#cach-hoc">Cách học</a>
          <a href="#mon-hoc">Môn học</a>
          <Link className="button secondary small" href="/auth">
            Đăng nhập
          </Link>
        </nav>
      </header>

      <section className="hero wrap" id="noi-dung" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="hero-badge">MỘT GÓC NHỎ, NHIỀU ĐIỀU HAY</p>
          <h1 id="hero-title">
            Tài liệu của bạn.
            <br />
            Câu hỏi của bạn.
            <br />
            <span className="highlight">Cùng hiểu thật rõ.</span>
          </h1>
          <p className="lead">
            Biến giáo trình thành cuộc trò chuyện dễ hiểu. Hỏi điều còn vướng,
            xem lời giải từng bước và đối chiếu ngay với nguồn.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/study">
              Bắt đầu học cùng nhau
            </Link>
            <a className="text-link" href="#cach-hoc">
              Mình sẽ học thế nào?
            </a>
          </div>
          <div className="hero-trust">
            <span>PDF & DOCX</span>
            <span>Có trích dẫn</span>
            <span>Tài liệu riêng tư</span>
          </div>
        </div>
        <LearningScene />
      </section>

      <section className="learning-promise">
        <div className="wrap promise-content">
          <p>Không cần hiểu hết ngay từ đầu.</p>
          <strong>Cứ hỏi. Từng chút một, bạn sẽ hiểu hơn.</strong>
        </div>
      </section>

      <section
        className="courses-section wrap"
        id="mon-hoc"
        aria-labelledby="courses-title"
      >
        <div className="section-heading">
          <p className="eyebrow">BẠN ĐANG HỌC MÔN GÌ?</p>
          <h2 id="courses-title">Môn hơi khó? Có bạn đồng hành.</h2>
          <p className="section-description">
            Bắt đầu từ đúng giáo trình bạn đang học.
          </p>
        </div>
        <div className="course-grid">
          {courses.map((course) => (
            <Link
              href="/study"
              key={course.name}
              className={`course-card course-${course.color}`}
            >
              <div className="course-illustration" aria-hidden="true">
                <span>{course.formula}</span>
                <div className="course-dot" />
              </div>
              <div className="course-content">
                <p className="eyebrow">{course.label}</p>
                <h3>{course.name}</h3>
                <p>{course.description}</p>
                <span className="course-action">Vào góc học tập</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section
        id="cach-hoc"
        className="how-section"
        aria-labelledby="how-title"
      >
        <div className="wrap">
          <div className="section-heading">
            <p className="eyebrow">ĐƠN GIẢN THÔI, CHỈ 3 BƯỚC</p>
            <h2 id="how-title">Từ “chưa hiểu” đến “à, ra thế!”.</h2>
            <p className="section-description">
              Mang theo tài liệu và một chút tò mò là đủ.
            </p>
          </div>
          <div className="steps">
            <article>
              <span className="step-number">01</span>
              <h3>Tải tài liệu lên</h3>
              <p>
                Chọn PDF hoặc DOCX có văn bản. Thư viện của bạn luôn được lưu
                riêng.
              </p>
              <span className="step-note">TỐI ĐA 20 MB / TÀI LIỆU</span>
            </article>
            <article>
              <span className="step-number">02</span>
              <h3>Hỏi điều bạn thắc mắc</h3>
              <p>
                Chọn tài liệu và đặt câu hỏi. Trợ giảng cùng bạn tìm lời giải
                thích dễ hiểu.
              </p>
              <span className="step-note">GIẢI THÍCH TỪNG BƯỚC</span>
            </article>
            <article>
              <span className="step-number">03</span>
              <h3>Hiểu rồi, kiểm tra lại</h3>
              <p>
                Đọc công thức và mở trích dẫn để đối chiếu với đúng đoạn trong
                giáo trình.
              </p>
              <span className="step-note">CÓ NGUỒN ĐỂ ĐỐI CHIẾU</span>
            </article>
          </div>
        </div>
      </section>

      <section className="closing wrap">
        <div>
          <p className="eyebrow">MỖI CÂU HỎI LÀ MỘT KHỞI ĐẦU</p>
          <h2>
            Sẵn sàng cho một
            <br />
            điều mới hôm nay?
          </h2>
          <p>Tài liệu đã có. Sự tò mò cũng có. Bắt đầu thôi!</p>
          <Link href="/study" className="button">
            Mở góc học tập của mình
          </Link>
        </div>
        <div className="closing-tiles" aria-hidden="true">
          <span>HỎI</span>
          <span>HIỂU</span>
          <span>NHỚ</span>
        </div>
      </section>

      <footer className="wrap footer">
        <Brand />
        <p>
          Trợ giảng AI có thể nhầm lẫn.
          <br />
          Luôn đối chiếu lời giải với tài liệu của bạn.
        </p>
        <a className="text-link" href="#dau-trang">
          Về đầu trang
        </a>
      </footer>
    </main>
  );
}
