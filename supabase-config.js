// Cấu hình Supabase — điền từ Supabase Dashboard > Project Settings > API.
// Cấu hình này là CÔNG KHAI (không phải secret): bảo vệ dựa trên Row Level Security.
window.SUPABASE_CONFIG = {
    url: 'https://tofydyyvndrqvewqohfx.supabase.co',
    anonKey: 'sb_publishable_-AelCKvPU6H6FFR4IVtEsQ_2105gWlM',
    // Tên Edge Function xử lý đăng nhập khôi phục (phải khớp tên hàm đã deploy).
    // Nếu đổi tên hàm trên Supabase, sửa giá trị này cho khớp.
    accountFunction: 'swift-api'
};
