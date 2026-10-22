export function LearningScene({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`learning-scene ${compact ? "compact" : ""}`}
      aria-label="Minh họa phiên học có giải thích và trích dẫn"
    >
      <div className="scene-orbit orbit-green" aria-hidden="true" />
      <div className="scene-orbit orbit-purple" aria-hidden="true" />
      <div className="math-tile tile-purple" aria-hidden="true">
        x²
      </div>
      <div className="math-tile tile-yellow" aria-hidden="true">
        a + b
      </div>
      <div className="scene-card">
        <div className="scene-card-heading">
          <span className="scene-avatar" aria-label="Trợ giảng LearnStep">
            LS
          </span>
          <div>
            <strong>Một câu hỏi hay!</strong>
            <span>Cùng tìm hiểu từng bước nhé.</span>
          </div>
          <span className="scene-subject">GIẢI TÍCH</span>
        </div>
        <div className="scene-question">Đạo hàm của x² bằng bao nhiêu?</div>
        <div className="scene-answer">
          <span className="eyebrow">BẮT ĐẦU TỪ CÔNG THỨC</span>
          <div className="scene-equation">
            (x<sup>n</sup>)′ = n · x<sup>n − 1</sup>
          </div>
          <p>
            Thay n = 2, ta có <strong>(x²)′ = 2x.</strong>
            <br />
            Hiểu quy tắc, rồi áp dụng từng bước.{" "}
            <span className="citation">[S1]</span>
          </p>
        </div>
        <div className="scene-source">
          <span className="source-number">S1</span>
          <div>
            <strong>Giáo trình Giải tích</strong>
            <span>Trang 24 · Quy tắc đạo hàm</span>
          </div>
        </div>
      </div>
      <div className="scene-aha" aria-hidden="true">
        À, hiểu rồi!
      </div>
      <p className="scene-caption">
        Minh họa · Câu trả lời thực tế dựa trên tài liệu của bạn.
      </p>
    </div>
  );
}
