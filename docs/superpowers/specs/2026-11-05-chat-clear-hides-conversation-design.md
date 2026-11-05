# Thiết kế: Xoá lịch sử = ẩn luôn cuộc trò chuyện

Ngày: 2026-11-05

## Ý định

Danh sách bên trái (`#roomList`) bị đầy dần các "khung chat" đã xoá lịch sử: dòng
vẫn nằm lại, chỉ đổi thành "Chưa có tin nhắn". Người dùng muốn: xoá lịch sử thì
dòng đó biến mất khỏi danh sách cho gọn; khi có tin mới thì tự hiện lại để không
bỏ lỡ tin.

## Mục tiêu

- Sau khi "Xoá lịch sử", phòng (chat riêng + nhóm) biến mất khỏi danh sách **của
  riêng mình**.
- Khi có tin mới hiển thị (mới hơn mốc xoá, không bị chặn), phòng tự hiện lại
  kèm badge chưa đọc.
- Không ảnh hưởng tới người khác và tới dữ liệu.
- Kênh chung không bao giờ bị ẩn.

## Ngoài phạm vi

- Không đổi database (không thêm cột/bảng).
- Không thêm hành động "ẩn" tách riêng — hành vi gắn liền với "Xoá lịch sử".
- Không ẩn các phòng mới chưa có tin nhắn (chỉ ẩn sau khi xoá lịch sử).

## Ràng buộc

- Nền tĩnh, vanilla JS, giữ nguyên UI hiện có; `core.js` thuần (chỉ thêm hàm).
- Dùng lại `reads.cleared_at` sẵn có; mốc xoá theo giờ server (đã có từ trước).
- Tái dùng `previewByRoom` (danh sách tin hiển thị, đã lọc chặn và mốc xoá).

## Các cách tiếp cận

- **Đề xuất (đã chọn):** suy ra "ẩn" từ `cleared_at` + không còn tin hiển thị nào.
  Không đổi DB, ít rủi ro, tái dùng mọi cơ chế đang có; "tự hiện lại" là hệ quả
  tự nhiên khi có tin mới.
- **Loại:** thêm cột `hidden`/`hidden_at` vào `reads`. Kiểm soát rõ hơn nhưng phải
  chạy lại schema, và logic "tự hiện lại khi có tin mới" phức tạp hơn hẳn. Không
  cần thiết cho yêu cầu này.

## Quyết định

- Thêm hàm thuần `isRoomHidden(room, clearedAt, preview)` trong `core.js`:
  `true` khi phòng không phải kênh chung, `clearedAt` có giá trị, và `preview`
  rỗng.
- `renderRoomList` lọc bỏ các phòng ẩn khỏi mục đang tham gia (không lọc lời mời,
  không lọc kênh chung).
- `clearHistory`: sau khi lưu mốc thành công, nếu là phòng đang mở thì đóng khung
  chat và đưa tiêu đề về "Chọn một phòng".
- Viết test trước (RED) cho `isRoomHidden` trong `tests/core.test.js`.

## Còn lại cho người xây

- Chi tiết nhỏ về nhãn/không có gì đáng kể; giữ nguyên văn phong UI hiện tại.
