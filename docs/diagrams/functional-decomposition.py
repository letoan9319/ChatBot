"""Author the functional tree from the maintained use cases and worker scope."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent


def use_cases(filename):
    source = (ROOT / filename).read_text(encoding='utf-8')
    result = []
    for code, label in re.findall(r' usecase "([A-Z]+-\d+)\\n(.*?)" as ', source):
        result.append({'label': label.split('\\n--')[0].replace('\\n', ' '), 'use_case': code})
    return result


def node(label, children, evidence):
    return {'label': label, 'children': children, 'evidence': evidence}


def leaves(*labels):
    return [{'label': label} for label in labels]


def designed(label, children):
    item = node(label, children, 'docs/diagrams/learning-modes-proposal.md')

    def mark(branch):
        branch['status'] = 'designed'
        for child in branch.get('children', []):
            mark(child)

    mark(item)
    return item


def build_tree():
    return node('LearnStep — Hỗ trợ tự học theo tài liệu', [
        node('Quản lý tài khoản và hồ sơ', use_cases('02a-account-use-cases.puml'),
             'apps/web/src/components/auth-form.tsx; apps/web/src/components/username-setup.tsx'),
        node('Quản lý kho tài liệu', [
            node('Quản lý tài liệu cá nhân', use_cases('02b-personal-document-use-cases.puml'),
                 'apps/web/src/components/document-repository.tsx'),
            node('Tra cứu và sử dụng tài liệu chung', use_cases('02c-shared-document-use-cases.puml'),
                 'supabase/migrations/202610300001_document_repository.sql'),
            node('Xử lý và lập chỉ mục tài liệu', leaves(
                'Trích xuất văn bản PDF / DOCX', 'Chia đoạn và giữ vị trí nguồn',
                'Tạo embedding và ghi chỉ mục vector', 'Lưu các đoạn văn bản và kết quả xử lý'),
                 'services/worker/src/study_worker/documents.py; services/worker/src/study_worker/main.py'),
        ], 'docs/document-repository.md'),
        node('Hỗ trợ hỏi đáp và hội thoại', [
            node('Hỏi đáp và đối chiếu trích dẫn', use_cases('02d-rag-use-cases.puml'),
                 'apps/web/src/components/study-workspace.tsx'),
            node('Tra cứu và tiếp tục hội thoại đã lưu', use_cases('02e-history-use-cases.puml'),
                 'apps/web/src/components/study-workspace.tsx'),
            node('Xử lý câu hỏi theo nguồn', leaves(
                'Truy xuất các đoạn nguồn được phép', 'Sắp xếp lại nguồn khi bật rerank',
                'Tạo context và sinh câu trả lời', 'Kiểm tra nhãn trích dẫn / báo thiếu bằng chứng'),
                 'services/worker/src/study_worker/main.py; services/worker/src/study_worker/rag.py'),
        ], 'docs/architecture.md'),
        node('Hỗ trợ nhóm học tập', use_cases('02f-study-group-use-cases.puml'),
             'apps/web/src/components/study-groups.tsx; supabase/migrations/202610290001_community.sql'),
        node('Theo dõi hoạt động học', [
            node('Cung cấp thông tin hoạt động học', use_cases('02h-learning-activity-use-cases.puml'),
                 'apps/web/src/components/study-overview.tsx; apps/web/src/components/study-streak.tsx'),
            node('Ghi nhận ngày học hợp lệ', leaves(
                'Ghi ngày khi hoàn tất chat có nguồn', 'Tính chuỗi ngày, kỷ lục và lịch tuần'),
                 'supabase/migrations/202610220005_study_streaks.sql; supabase/migrations/202610300001_document_repository.sql'),
        ], 'docs/streaks.md'),
        node('Cung cấp thông báo trong ứng dụng', [
            node('Tra cứu và xử lý thông báo', use_cases('02g-notification-use-cases.puml'),
                 'apps/web/src/components/notification-center.tsx'),
            node('Tạo thông báo theo sự kiện', leaves(
                'Thông báo kết quả xử lý tài liệu', 'Thông báo kết quả / gián đoạn câu trả lời',
                'Thông báo tin nhắn nhóm mới'),
                 'supabase/migrations/202610290001_community.sql'),
        ], 'docs/community.md'),
        node('Tùy chỉnh trải nghiệm học', use_cases('02i-settings-use-cases.puml'),
             'apps/web/src/components/study-settings.tsx; apps/web/src/components/use-study-preferences.ts'),
        node('Vận hành và bảo vệ xử lý', [
            node('Công bố nguồn chung bằng SQL đặc quyền', use_cases('02j-publication-use-cases.puml'),
                 'docs/document-repository.md; supabase/migrations/202610300001_document_repository.sql'),
            node('Điều phối công việc nền', leaves(
                'Tiếp nhận và nhận xử lý công việc', 'Giữ lease và cập nhật heartbeat',
                'Thử lại khi lỗi / lưu trạng thái kết thúc', 'Chọn provider AI và fallback theo cấu hình'),
                 'services/worker/src/study_worker/main.py; services/worker/src/study_worker/config.py; services/worker/src/study_worker/fallback.py'),
            node('Kiểm soát truy cập và tính nhất quán', leaves(
                'Kiểm tra chủ sở hữu, thành viên và nguồn công bố',
                'Áp dụng quota và khóa idempotency',
                'Kiểm tra phiên bản nguồn trước lưu kết quả',
                'Cấp URL có thời hạn cho tệp được phép'),
                 'apps/web/src/app/api/[[...path]]/route.ts; supabase/migrations/202610220001_initial.sql; services/worker/src/study_worker/main.py'),
            node('Dọn dữ liệu tài liệu bị xóa', leaves(
                'Xóa tệp, vector và nội dung các đoạn',
                'Dọn upload bỏ dở / quét lại tệp phát sinh trễ'),
                 'services/worker/src/study_worker/main.py'),
        ], 'docs/deployment.md'),
        designed('Học theo tiến trình', [
            node('Thiết lập lộ trình học', leaves(
                'Chọn môn học và mục tiêu đầu ra',
                'Xác định kiến thức ban đầu',
                'Lập kế hoạch và nhịp học phù hợp'),
                 'docs/diagrams/learning-modes-proposal.md'),
            node('Học lần lượt theo bài và chặng', leaves(
                'Nhận thứ tự bài và kiến thức tiên quyết',
                'Học nội dung gắn với tài liệu nguồn',
                'Luyện tập và làm kiểm tra cuối bài',
                'Chuyển chặng khi đạt điều kiện hoàn thành'),
                 'docs/diagrams/learning-modes-proposal.md'),
            node('Đánh giá và điều chỉnh tiến trình', leaves(
                'Xem mức hoàn thành theo bài và chặng',
                'Xác định phần kiến thức cần củng cố',
                'Học bù và điều chỉnh kế hoạch'),
                 'docs/diagrams/learning-modes-proposal.md'),
        ]),
        designed('Tự học', [
            node('Xác định nội dung và mục tiêu tự học', leaves(
                'Lựa chọn chủ đề và tài liệu tự học',
                'Đặt mục tiêu tự học',
                'Lập kế hoạch thời gian tự học'),
                 'docs/diagrams/learning-modes-proposal.md'),
            node('Học và luyện tập', leaves(
                'Ghi chú gắn với đoạn tài liệu',
                'Tạo tóm tắt và thẻ ghi nhớ',
                'Tự kiểm tra kiến thức theo chủ đề',
                'Hỏi trợ giảng theo nội dung đang học'),
                 'docs/diagrams/learning-modes-proposal.md'),
            node('Ôn tập và theo dõi kết quả', leaves(
                'Tự đánh giá mức độ đạt mục tiêu',
                'Lập lịch ôn lại kiến thức cần nhớ',
                'Xem lại ghi chú và các lần tự kiểm tra'),
                 'docs/diagrams/learning-modes-proposal.md'),
        ]),
    ], 'docs/diagrams/use-cases.md')


STYLE = '''@startwbs
skinparam backgroundColor white
skinparam defaultFontName Arial
skinparam defaultFontSize 16
skinparam shadowing false
<style>
wbsDiagram {
 node {
  BackgroundColor #f5faf7
  LineColor #218660
  FontColor #273340
  Padding 12
  Margin 4
  MaximumWidth 290
  RoundCorner 4
 }
 :depth(0) {
  BackgroundColor #e2efe8
  FontSize 24
  FontStyle bold
  MaximumWidth 450
 }
 :depth(1) {
  BackgroundColor #eaf3ee
  FontStyle bold
 }
 arrow {
  LineColor #526477
  LineThickness 1.5
 }
}
</style>
'''


def walk(item, code='0', depth=0):
    yield item, code, depth
    for i, child in enumerate(item.get('children', []), 1):
        yield from walk(child, str(i) if depth == 0 else f'{code}.{i}', depth + 1)


def main():
    tree = build_tree()
    rows = list(walk(tree))
    codes = [n['use_case'] for n, _, _ in rows if 'use_case' in n]
    assert len(codes) == len(set(codes)) == 64
    (ROOT / 'functional-decomposition.json').write_text(
        json.dumps(tree, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for filename, max_depth in [('13-functional-decomposition', 2), ('13a-functional-decomposition-detail', 3),
                                ('13b-learning-modes-proposal', 3)]:
        lines = [STYLE]
        for item, code, depth in rows:
            if filename == '13b-learning-modes-proposal':
                if depth == 0:
                    lines.append('* Phương thức học tập')
                    continue
                if code.split('.')[0] not in ('9', '10'):
                    continue
            if depth > max_depth:
                continue
            prefix = '*' * (depth + 1) + ('<' if depth >= 2 else '')
            lines.append(f"{prefix} {code}. {item['label']}")
        lines.append('@endwbs')
        (ROOT / f'{filename}.puml').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Functional tree: {len(tree["children"])} branches, {len(rows)} nodes, '
          'covers all 64 maintained use cases and the two learning modes.')


if __name__ == '__main__':
    main()
