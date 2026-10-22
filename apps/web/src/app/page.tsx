import Link from "next/link";
import { LearningScene } from "@/components/learning-scene";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-provider";
import { ScrollReveal } from "@/components/scroll-reveal";

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
    <ScrollReveal>
      <main className="landing" id="dau-trang">
        <a href="#noi-dung" className="skip-link">
          Đến nội dung chính
        </a>
        <header className="site-header wrap">
          <Brand />
          <nav aria-label="Điều hướng chính">
            <ThemeToggle />
            <a href="#cach-hoc">Cách học</a>
            <a href="#mon-hoc">Môn học</a>
            <Link className="button secondary small" href="/auth">
              Đăng nhập
            </Link>
          </nav>
        </header>

        <section className="hero wrap" id="noi-dung" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="hero-badge">TRỢ GIẢNG AI CHO VIỆC TỰ HỌC</p>
            <h1 id="hero-title">
              Tự học chủ động.
              <br />
              <span className="highlight">Hiểu rõ từng bước.</span>
            </h1>
            <p className="lead">
              Trao đổi với AI dựa trên giáo trình của bạn. Xem giải thích từng
              bước và kiểm tra các trích dẫn từ tài liệu.
            </p>
            <div className="hero-actions">
              <Link className="button" href="/study">
                Bắt đầu học
              </Link>
              <a className="text-link" href="#cach-hoc">
                Xem cách sử dụng
              </a>
            </div>
            <div className="hero-trust">
              <span>Hỗ trợ PDF, DOCX</span>
              <span>Trích dẫn tài liệu</span>
              <span>Thư viện cá nhân</span>
            </div>
          </div>
          <LearningScene />
        </section>

        <section className="learning-promise">
          <div className="wrap promise-content" data-reveal>
            <p>Học theo tài liệu của bạn.</p>
            <strong>Đọc, đặt câu hỏi và kiểm tra lại nguồn.</strong>
          </div>
        </section>

        <section
          className="courses-section wrap"
          id="mon-hoc"
          aria-labelledby="courses-title"
        >
          <div className="section-heading" data-reveal>
            <p className="eyebrow">NỘI DUNG HỖ TRỢ</p>
            <h2 id="courses-title">Ba môn học, một không gian học tập.</h2>
            <p className="section-description">
              Bắt đầu từ đúng giáo trình bạn đang học.
            </p>
          </div>
          <div className="course-grid">
            {courses.map((course, index) => (
              <Link
                href="/study"
                key={course.name}
                className={`course-card course-${course.color}`}
                data-reveal
                data-reveal-delay={index * 90}
              >
                <div className="course-illustration" aria-hidden="true">
                  <span>{course.formula}</span>
                  <div className="course-dot" />
                </div>
                <div className="course-content">
                  <p className="eyebrow">{course.label}</p>
                  <h3>{course.name}</h3>
                  <p>{course.description}</p>
                  <span className="course-action">Bắt đầu học</span>
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
            <div className="section-heading" data-reveal>
              <p className="eyebrow">QUY TRÌNH SỬ DỤNG</p>
              <h2 id="how-title">Bắt đầu trong ba bước.</h2>
              <p className="section-description">
                Chọn tài liệu, đặt câu hỏi và đối chiếu lời giải.
              </p>
            </div>
            <div className="steps">
              <article data-reveal>
                <span className="step-number">01</span>
                <h3>Tải tài liệu lên</h3>
                <p>
                  Chọn PDF hoặc DOCX có văn bản. Thư viện của bạn luôn được lưu
                  riêng.
                </p>
                <span className="step-note">TỐI ĐA 20 MB / TÀI LIỆU</span>
              </article>
              <article data-reveal data-reveal-delay="90">
                <span className="step-number">02</span>
                <h3>Đặt câu hỏi</h3>
                <p>
                  Trợ giảng tìm các đoạn liên quan và giải thích dựa trên nội
                  dung tài liệu.
                </p>
                <span className="step-note">GIẢI THÍCH TỪNG BƯỚC</span>
              </article>
              <article data-reveal data-reveal-delay="180">
                <span className="step-number">03</span>
                <h3>Đối chiếu với nguồn</h3>
                <p>
                  Đọc công thức và mở trích dẫn để đối chiếu với đúng đoạn trong
                  giáo trình.
                </p>
                <span className="step-note">CÓ NGUỒN ĐỂ ĐỐI CHIẾU</span>
              </article>
            </div>
          </div>
        </section>

        <section className="closing wrap" data-reveal>
          <div>
            <p className="eyebrow">KHÔNG GIAN TỰ HỌC CỦA BẠN</p>
            <h2>
              Bắt đầu với
              <br />
              tài liệu đang học.
            </h2>
            <p>Tải giáo trình và đặt câu hỏi đầu tiên trên LearnStep.</p>
            <Link href="/study" className="button">
              Bắt đầu học
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
    </ScrollReveal>
  );
}
