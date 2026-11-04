/* ==========================================================================
   UniSchedule AI - Logic
   JavaScript thuần, không phụ thuộc thư viện/CDN.
   ========================================================================== */

'use strict';

/* ------------------------- Cấu hình ------------------------- */

var STORAGE_KEY = 'uni_schedule_subjects_v2';

// Dán Gemini API Key hệ thống của bạn vào đây (nếu có).
var SYSTEM_GEMINI_API_KEY = '';
var GEMINI_MODEL = 'gemini-3-flash-preview';

// Phân bố tiết học: tiết -> giờ bắt đầu / kết thúc / thời gian nghỉ
var PERIOD_SCHEDULE = {
    1:  { buoi: 'Sáng',  start: '07:00', end: '07:50', nghi: '5 phút' },
    2:  { buoi: 'Sáng',  start: '07:55', end: '08:45', nghi: '10 phút' },
    3:  { buoi: 'Sáng',  start: '08:55', end: '09:45', nghi: '5 phút' },
    4:  { buoi: 'Sáng',  start: '09:50', end: '10:40', nghi: '5 phút' },
    5:  { buoi: 'Sáng',  start: '10:45', end: '11:35', nghi: '' },
    6:  { buoi: 'Chiều', start: '12:40', end: '13:30', nghi: '5 phút' },
    7:  { buoi: 'Chiều', start: '13:35', end: '14:25', nghi: '10 phút' },
    8:  { buoi: 'Chiều', start: '14:35', end: '15:25', nghi: '5 phút' },
    9:  { buoi: 'Chiều', start: '15:30', end: '16:20', nghi: '5 phút' },
    10: { buoi: 'Chiều', start: '16:25', end: '17:15', nghi: '' },
    11: { buoi: 'Tối',   start: '17:20', end: '18:10', nghi: '5 phút' },
    12: { buoi: 'Tối',   start: '18:15', end: '19:05', nghi: '' },
    13: { buoi: 'Tối',   start: '19:10', end: '20:00', nghi: '' }
};

/* ------------------------- State ------------------------- */

var subjectsList = [];
var selectedDate = new Date();
var selectedImageBase64 = null;
var ocrParsedData = [];
var currentUid = null;

/* ------------------------- Tiện ích ------------------------- */

function ico(name, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '"><use href="#i-' + name + '"/></svg>';
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDateISO(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function parseDateISO(str) {
    if (!str) return new Date();
    var p = String(str).split('-');
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}

function formatDateVN(dateObj) {
    var day = String(dateObj.getDate()).padStart(2, '0');
    var month = String(dateObj.getMonth() + 1).padStart(2, '0');
    return day + '/' + month + '/' + dateObj.getFullYear();
}

function getRelativeDateStr(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return formatDateISO(d);
}

// Chủ nhật = 8, Thứ 2 = 2 ... Thứ 7 = 7
function getThuFromDate(dateObj) {
    var jsDay = dateObj.getDay();
    return jsDay === 0 ? 8 : jsDay + 1;
}

function getThuLabel(thuNum) {
    var t = parseInt(thuNum, 10);
    return t === 8 ? 'Chủ Nhật' : 'Thứ ' + t;
}

// Chuẩn hoá "thu" về mảng số (2..8): nhận 6, "6", "6/7", [6,7]
function normalizeThu(thu) {
    if (Array.isArray(thu)) {
        return thu.map(Number).filter(function (n) { return n >= 2 && n <= 8; });
    }
    if (thu === null || thu === undefined || thu === '') return [];
    return String(thu).split(/[\/,;\s\-]+/).map(function (s) { return parseInt(s, 10); })
        .filter(function (n) { return n >= 2 && n <= 8; });
}

function getThuShort(thu) {
    return normalizeThu(thu).map(function (t) { return t === 8 ? 'CN' : 'T' + t; }).join('/');
}

function getThuDisplay(thu) {
    return normalizeThu(thu).map(function (t) { return t === 8 ? 'Chủ Nhật' : 'Thứ ' + t; }).join(', ');
}

// Tách khoảng tiết từ chuỗi "1-5", "6-10", "1-3 (07:00 - 09:25)"
function parseTietRange(tietStr) {
    if (!tietStr) return null;
    var main = String(tietStr).split('(')[0];
    var nums = (main.match(/\d+/g) || []).map(Number).filter(function (n) { return n >= 1 && n <= 13; });
    if (nums.length === 0) return null;
    return { start: Math.min.apply(null, nums), end: Math.max.apply(null, nums) };
}

function getGioHoc(tietStr) {
    var r = parseTietRange(tietStr);
    if (!r) return '';
    var a = PERIOD_SCHEDULE[r.start];
    var b = PERIOD_SCHEDULE[r.end];
    if (!a || !b) return '';
    return a.start + ' - ' + b.end;
}

function getBuoiFromTiet(tietStr) {
    var r = parseTietRange(tietStr);
    if (!r) return '';
    var p = PERIOD_SCHEDULE[r.start];
    return p ? p.buoi : '';
}

function buoiBadgeClass(buoi) {
    if (buoi === 'Sáng') return 'badge-morning';
    if (buoi === 'Chiều') return 'badge-afternoon';
    return 'badge-evening';
}

/* ------------------------- Lưu trữ ------------------------- */

function storageKeyFor(uid) {
    if (typeof window.cacheKeyFor === 'function') return window.cacheKeyFor(uid);
    return uid ? 'uni_schedule_cache_v1__' + uid : STORAGE_KEY;
}

function saveToLocalStorage() {
    try {
        localStorage.setItem(storageKeyFor(currentUid), JSON.stringify(subjectsList));
    } catch (e) {
        console.warn('Lỗi lưu localStorage:', e);
    }
}

function loadFromLocalStorage() {
    try {
        var raw = currentUid ? localStorage.getItem(storageKeyFor(currentUid)) : null;
        if (raw) {
            subjectsList = JSON.parse(raw);
        } else {
            // Chỉ đọc cache cũ (khóa chung, chưa gắn uid) khi chưa có chủ hoặc đúng chủ hiện tại,
            // để tài khoản khác trên cùng máy không thấy TKB của người trước.
            var localOwner = null;
            try { localOwner = localStorage.getItem('UNI_LAST_UID'); } catch (e) { /* bỏ qua */ }
            var allowed = typeof window.legacyCacheAllowed === 'function'
                ? window.legacyCacheAllowed(localOwner, currentUid)
                : (localOwner === null || localOwner === undefined || localOwner === currentUid);
            var legacy = allowed ? localStorage.getItem(STORAGE_KEY) : null;
            subjectsList = legacy ? JSON.parse(legacy) : [];
        }
        // Tương thích dữ liệu cũ: gộp trường "sdt" vào "ghiChu"
        subjectsList.forEach(function (s) {
            if (s.sdt) {
                if (!s.ghiChu) s.ghiChu = s.sdt;
                delete s.sdt;
            }
        });
    } catch (e) {
        console.warn('Lỗi đọc localStorage:', e);
    }
}

// Firestore là nguồn sự thật: cập nhật danh sách từ cloud rồi vẽ lại.
window.applyCloudSubjects = function (list) {
    subjectsList = Array.isArray(list) ? list : [];
    saveToLocalStorage();
    renderCurrentView();
};

/* ------------------------- Dữ liệu mẫu ------------------------- */

// Dữ liệu mẫu: BỊA HOÀN TOÀN (không phải lớp/môn/phòng thật của người dùng).
var SAMPLE_SUBJECTS = [
    {
        id: 'sub_demo_1',
        tenHocPhan: 'Nhập môn lập trình',
        lop: 'CNTT01',
        siSo: 40,
        soTC: 3,
        tongSoTiet: 45,
        thu: [2],
        tietHoc: '1-5',
        tuNgay: getRelativeDateStr(-10),
        denNgay: getRelativeDateStr(60),
        buoiHoc: 'Sáng',
        phongHoc: 'A101',
        donVi: 'Khoa CNTT',
        giangVien: 'Nguyễn Văn A',
        hinhThucThi: 'Báo cáo dự án',
        ghiChu: '0123456789'
    },
    {
        id: 'sub_demo_2',
        tenHocPhan: 'Kỹ năng mềm',
        lop: 'CNTT01',
        siSo: 40,
        soTC: 3,
        tongSoTiet: 45,
        thu: [6, 7],
        tietHoc: '6-10',
        tuNgay: getRelativeDateStr(-20),
        denNgay: getRelativeDateStr(45),
        buoiHoc: 'Chiều',
        phongHoc: 'A101',
        donVi: 'Khoa CNTT',
        giangVien: 'Nguyễn Thị B',
        hinhThucThi: 'TN trên MT',
        ghiChu: '0123456789'
    }
];

/* ------------------------- Điều hướng tab ------------------------- */

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(function (el) { el.classList.add('hidden'); });
    document.querySelectorAll('.tab-nav').forEach(function (b) { b.classList.remove('active'); });

    document.getElementById(tabId).classList.remove('hidden');

    var map = {
        todayTab: 'btnTabToday',
        weekTab: 'btnTabWeek',
        sheetTab: 'btnTabSheet',
        ocrTab: 'btnTabOCR',
        listTab: 'btnTabList',
        chatTab: 'btnTabChat'
    };
    var btn = map[tabId] && document.getElementById(map[tabId]);
    if (btn) btn.classList.add('active');

    renderCurrentView();
}

function renderCurrentView() {
    renderTodayView();
    renderWeekView();
    renderSheetView();
    renderAllSubjectsList();
}

/* ------------------------- Tab: Theo Ngày ------------------------- */

function onDateInputChange(val) {
    if (!val) return;
    selectedDate = parseDateISO(val);
    renderTodayView();
}

function changeDate(days) {
    selectedDate.setDate(selectedDate.getDate() + days);
    document.getElementById('selectedDateInput').value = formatDateISO(selectedDate);
    renderTodayView();
}

function selectToday() {
    selectedDate = new Date();
    document.getElementById('selectedDateInput').value = formatDateISO(selectedDate);
    renderTodayView();
    showToast('Đã chuyển về ngày hôm nay', 'info');
}

function renderTodayView() {
    var dateStr = formatDateISO(selectedDate);
    var thuNum = getThuFromDate(selectedDate);

    document.getElementById('displayDayInfo').textContent =
        getThuLabel(thuNum) + ', ' + formatDateVN(selectedDate);

    var container = document.getElementById('dailySubjectsContainer');
    container.innerHTML = '';

    var active = sortedSubjects().filter(function (s) {
        return normalizeThu(s.thu).indexOf(thuNum) !== -1 &&
            dateStr >= s.tuNgay && dateStr <= s.denNgay;
    });

    if (active.length === 0) {
        container.innerHTML =
            '<div class="empty">' +
                '<div class="empty-icon">' + ico('mug') + '</div>' +
                '<h3>Chưa có lịch học vào ngày này!</h3>' +
                '<p>Hãy bấm <strong>"Thêm môn"</strong> hoặc dùng tính năng <strong>"Quét Ảnh AI"</strong> để tải lịch học lên.</p>' +
            '</div>';
        return;
    }

    active.forEach(function (s) { container.appendChild(buildSubjectCard(s)); });
}

function buildSubjectCard(s) {
    var card = document.createElement('div');
    card.className = 'subject-card';

    var meta = [];
    if (s.lop) meta.push('<span>' + ico('users') + escapeHtml(s.lop) + '</span>');
    if (s.donVi) meta.push('<span>' + ico('building') + escapeHtml(s.donVi) + '</span>');
    if (s.soTC) meta.push('<span>' + ico('star') + escapeHtml(s.soTC) + ' TC</span>');

    card.innerHTML =
        '<div class="subject-head">' +
            '<div>' +
                '<span class="badge ' + buoiBadgeClass(s.buoiHoc) + '">Buổi ' + escapeHtml(s.buoiHoc || 'Học') + '</span>' +
                '<h3 class="subject-title">' + escapeHtml(s.tenHocPhan) + '</h3>' +
                (meta.length ? '<div class="subject-meta">' + meta.join('') + '</div>' : '') +
            '</div>' +
            '<div class="subject-actions">' +
                '<button class="icon-action" onclick="editSubject(\'' + s.id + '\')" title="Sửa">' + ico('pen') + '</button>' +
                '<button class="icon-action danger" onclick="deleteSubject(\'' + s.id + '\')" title="Xóa">' + ico('trash') + '</button>' +
            '</div>' +
        '</div>' +
        '<div class="info-grid">' +
            infoCell('clock', 'Tiết học', escapeHtml(s.tietHoc || 'Chưa rõ') + (getGioHoc(s.tietHoc) ? ' · ' + getGioHoc(s.tietHoc) : '')) +
            infoCell('pin', 'Phòng học', escapeHtml(s.phongHoc || 'Chưa rõ')) +
            infoCell('user', 'Giảng viên', escapeHtml(s.giangVien || 'Chưa rõ')) +
            infoCell('file', 'Hình thức thi', escapeHtml(s.hinhThucThi || 'Chưa rõ')) +
        '</div>' +
        (s.ghiChu ? '<div class="note">' + ico('info') + '<span>' + escapeHtml(s.ghiChu) + '</span></div>' : '');

    return card;
}

function infoCell(iconName, label, value) {
    return '<div class="info-cell">' + ico(iconName) +
        '<div><span class="lbl">' + label + '</span><span class="val">' + value + '</span></div></div>';
}

/* ------------------------- Tab: Cả Tuần ------------------------- */

function getStartOfWeek(d) {
    var date = new Date(d);
    var day = date.getDay();
    var diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
}

function changeWeek(offsetWeeks) {
    selectedDate.setDate(selectedDate.getDate() + offsetWeeks * 7);
    document.getElementById('selectedDateInput').value = formatDateISO(selectedDate);
    renderWeekView();
}

function renderWeekView() {
    var monday = getStartOfWeek(selectedDate);
    var sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    document.getElementById('weekRangeLabel').textContent =
        formatDateVN(monday) + ' - ' + formatDateVN(sunday);
    document.getElementById('weekSubLabel').textContent =
        'Tuần thuộc Tháng ' + (monday.getMonth() + 1) + '/' + monday.getFullYear();

    var container = document.getElementById('weeklyScheduleContainer');
    container.innerHTML = '';
    var todayStr = formatDateISO(new Date());
    var sorted = sortedSubjects();

    for (var i = 0; i < 7; i++) {
        var dayDate = new Date(monday);
        dayDate.setDate(monday.getDate() + i);
        var dateStr = formatDateISO(dayDate);
        var thuNum = getThuFromDate(dayDate);
        var isToday = dateStr === todayStr;

        var daySubjects = sorted.filter(function (s) {
            return normalizeThu(s.thu).indexOf(thuNum) !== -1 &&
                dateStr >= s.tuNgay && dateStr <= s.denNgay;
        });

        var block = document.createElement('div');
        block.className = 'day-block' + (isToday ? ' today' : '');

        var body;
        if (daySubjects.length === 0) {
            body = '<div class="day-body"><div class="day-empty">Không có môn học</div></div>';
        } else {
            body = '<div class="day-body">' + daySubjects.map(function (s) {
                return '<div class="day-item">' +
                    '<div>' +
                        '<div class="name">' + escapeHtml(s.tenHocPhan) + '</div>' +
                        '<div class="sub">' +
                            '<span class="pill">' + ico('clock') + 'Tiết ' + escapeHtml(s.tietHoc || '?') +
                                (getGioHoc(s.tietHoc) ? ' (' + getGioHoc(s.tietHoc) + ')' : '') + '</span>' +
                            (s.phongHoc ? ico('pin') + escapeHtml(s.phongHoc) : '') +
                        '</div>' +
                        (s.giangVien ? '<div class="sub">' + escapeHtml(s.giangVien) + '</div>' : '') +
                    '</div>' +
                    '<div class="subject-actions">' +
                        '<button class="icon-action" onclick="editSubject(\'' + s.id + '\')" title="Sửa môn">' + ico('pen') + '</button>' +
                        '<button class="icon-action danger" onclick="deleteSubject(\'' + s.id + '\')" title="Xóa môn">' + ico('trash') + '</button>' +
                    '</div>' +
                '</div>';
            }).join('') + '</div>';
        }

        block.innerHTML =
            '<div class="day-head">' +
                '<span>' + getThuLabel(thuNum) + ' (' + formatDateVN(dayDate) + ')</span>' +
                (isToday ? '<span class="today-tag">Hôm nay</span>' : '') +
            '</div>' + body;

        container.appendChild(block);
    }
}

/* ------------------------- Tab: Bảng TKB ------------------------- */

function sortedSubjects() {
    return subjectsList.slice().sort(function (a, b) {
        var aThu = normalizeThu(a.thu), bThu = normalizeThu(b.thu);
        var ta = aThu.length ? Math.min.apply(null, aThu) : 99;
        var tb = bThu.length ? Math.min.apply(null, bThu) : 99;
        if (ta !== tb) return ta - tb;
        var ra = parseTietRange(a.tietHoc), rb = parseTietRange(b.tietHoc);
        return (ra ? ra.start : 99) - (rb ? rb.start : 99);
    });
}

/* ------------------------- Gom nhóm theo môn học ------------------------- */
// Gộp các buổi có cùng "Tên học phần" + "Lớp" thành một môn duy nhất.
function monKey(s) {
    return (s.tenHocPhan || '').trim().toLowerCase() + '||' + (s.lop || '').trim().toLowerCase();
}

function groupSubjects(list) {
    var groups = [];
    var map = {};
    list.forEach(function (s) {
        var k = monKey(s);
        if (!map[k]) { map[k] = { key: k, sessions: [] }; groups.push(map[k]); }
        map[k].sessions.push(s);
    });
    return groups;
}

// Nhãn các thứ của cả nhóm, gộp & sắp tăng dần: T2/T6/T7
function groupThuLabel(sessions) {
    var set = [];
    sessions.forEach(function (s) {
        normalizeThu(s.thu).forEach(function (t) { if (set.indexOf(t) === -1) set.push(t); });
    });
    set.sort(function (a, b) { return a - b; });
    return set.map(function (t) { return t === 8 ? 'CN' : 'T' + t; }).join('/');
}

// Dựng các <tr> cho một môn; các cột chung được gộp ô (rowspan) để nhìn rõ cùng 1 môn.
function sheetRowsForGroup(group, groupIndex) {
    function v(x) { return x === null || x === undefined ? '' : String(x); }
    var n = group.sessions.length;
    var html = '';

    group.sessions.forEach(function (s, si) {
        var first = si === 0;
        var rs = ' rowspan="' + n + '"';
        var tds = [];

        // --- cột gộp: chỉ in ở dòng đầu, giữ chỗ cho các dòng sau ---
        if (first) tds.push('<td class="c"' + rs + '>' + (groupIndex + 1) + '</td>');
        if (first) tds.push('<td' + rs + '>' + escapeHtml(s.lop) + '</td>');
        if (first) tds.push('<td class="c"' + rs + '>' + escapeHtml(v(s.siSo)) + '</td>');
        if (first) tds.push('<td class="b"' + rs + '>' + escapeHtml(s.tenHocPhan) + '</td>');
        if (first) tds.push('<td class="c"' + rs + '>' + escapeHtml(v(s.soTC)) + '</td>');
        if (first) tds.push('<td class="c"' + rs + '>' + escapeHtml(v(s.tongSoTiet)) + '</td>');

        // --- cột riêng cho từng buổi ---
        tds.push('<td class="c">' + escapeHtml(s.buoiHoc || getBuoiFromTiet(s.tietHoc)) + '</td>');
        tds.push('<td class="c">' + escapeHtml(getThuDisplay(s.thu)) + '</td>');
        tds.push('<td class="c">' + escapeHtml(s.tietHoc) + '</td>');

        if (first) tds.push('<td class="c"' + rs + '>' + (s.tuNgay ? formatDateVN(parseDateISO(s.tuNgay)) : '') + '</td>');
        if (first) tds.push('<td class="c"' + rs + '>' + (s.denNgay ? formatDateVN(parseDateISO(s.denNgay)) : '') + '</td>');

        tds.push('<td>' + escapeHtml(s.phongHoc) + '</td>');
        if (first) tds.push('<td' + rs + '>' + escapeHtml(s.donVi) + '</td>');
        tds.push('<td>' + escapeHtml(s.giangVien) + '</td>');
        if (first) tds.push('<td' + rs + '>' + escapeHtml(s.hinhThucThi) + '</td>');
        if (first) tds.push('<td' + rs + '>' + escapeHtml(s.ghiChu) + '</td>');

        html += '<tr>' + tds.join('') + '</tr>';
    });

    return html;
}

function renderSheetView() {
    var tbody = document.getElementById('sheetTableBody');
    if (!tbody) return;
    var list = sortedSubjects();
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="16" class="c muted" style="font-style:italic;padding:18px">Chưa có dữ liệu thời khóa biểu.</td></tr>';
        return;
    }
    tbody.innerHTML = groupSubjects(list).map(sheetRowsForGroup).join('');
}

function renderPeriodTable() {
    var tbody = document.getElementById('periodTableBody');
    if (!tbody) return;
    var groups = [
        { buoi: 'Sáng', tiet: [1, 2, 3, 4, 5], cls: 'buoi-sang' },
        { buoi: 'Chiều', tiet: [6, 7, 8, 9, 10], cls: 'buoi-chieu' },
        { buoi: 'Tối', tiet: [11, 12, 13], cls: 'buoi-toi' }
    ];
    var html = '';
    groups.forEach(function (g) {
        g.tiet.forEach(function (t, i) {
            var p = PERIOD_SCHEDULE[t];
            html += '<tr>';
            if (i === 0) {
                html += '<td rowspan="' + g.tiet.length + '" class="c b ' + g.cls + '">' + g.buoi + '</td>';
            }
            html += '<td class="c">' + t + '</td>' +
                '<td class="c">' + p.start + ' - ' + p.end + '</td>' +
                '<td class="c">' + (p.nghi || '') + '</td></tr>';
        });
    });
    tbody.innerHTML = html;
}

/* ------------------------- Chọn nhiều Thứ ------------------------- */

var thuChipsInitialized = false;
function initThuChips() {
    if (thuChipsInitialized) return;
    thuChipsInitialized = true;
    document.querySelectorAll('#fieldThuGroup .chip').forEach(function (btn) {
        btn.addEventListener('click', function () { btn.classList.toggle('active'); });
    });
}

function getSelectedThu() {
    return Array.prototype.map.call(
        document.querySelectorAll('#fieldThuGroup .chip.active'),
        function (b) { return parseInt(b.dataset.thu, 10); }
    );
}

function setSelectedThu(thu) {
    var list = normalizeThu(thu);
    document.querySelectorAll('#fieldThuGroup .chip').forEach(function (b) {
        b.classList.toggle('active', list.indexOf(parseInt(b.dataset.thu, 10)) !== -1);
    });
}

function updateGioHocPreview() {
    var val = document.getElementById('fieldTietHoc').value;
    document.getElementById('fieldGioHocPreview').value = getGioHoc(val);
    var buoi = getBuoiFromTiet(val);
    if (buoi) document.getElementById('fieldBuoiHoc').value = buoi;
}

/* ------------------------- Quản lý môn ------------------------- */

function renderAllSubjectsList() {
    var container = document.getElementById('allSubjectsListContainer');
    container.innerHTML = '';

    if (subjectsList.length === 0) {
        container.innerHTML =
            '<div class="empty">' +
                '<div class="empty-icon">' + ico('list') + '</div>' +
                '<h3>Chưa có môn học nào</h3>' +
                '<p>Cơ sở dữ liệu đang trống.</p>' +
                '<div style="margin-top:14px"><button class="btn btn-primary btn-sm" onclick="openModal(\'addSubjectModal\')">' +
                    ico('plus') + ' Thêm môn học mới</button></div>' +
            '</div>';
        return;
    }

    groupSubjects(sortedSubjects()).forEach(function (g) {
        var first = g.sessions[0];

        // Mỗi buổi một dòng rõ ràng bên trong thẻ môn
        var buoiHtml = g.sessions.map(function (s) {
            var buoi = s.buoiHoc || getBuoiFromTiet(s.tietHoc) || '';
            var info = '<b>' + escapeHtml(getThuDisplay(s.thu)) + '</b>';
            if (s.tietHoc) info += ' · Tiết ' + escapeHtml(s.tietHoc);
            if (getGioHoc(s.tietHoc)) info += ' · ' + getGioHoc(s.tietHoc);
            if (s.phongHoc) info += ' · P. ' + escapeHtml(s.phongHoc);
            if (s.giangVien) info += ' · GV ' + escapeHtml(s.giangVien);
            return '<div class="buoi-row">' +
                (buoi ? '<span class="badge ' + buoiBadgeClass(buoi) + '">' + escapeHtml(buoi) + '</span>' : '') +
                '<span class="buoi-text">' + info + '</span>' +
                '<div class="buoi-actions">' +
                    '<button class="icon-action" onclick="editSubject(\'' + s.id + '\')" title="Sửa buổi này">' + ico('pen') + '</button>' +
                    '<button class="icon-action danger" onclick="deleteSubject(\'' + s.id + '\')" title="Xóa buổi này">' + ico('trash') + '</button>' +
                '</div>' +
            '</div>';
        }).join('');

        var meta = [];
        if (first.lop) meta.push('<span class="muted small">' + ico('users') + ' ' + escapeHtml(first.lop) + '</span>');
        if (first.donVi) meta.push('<span class="muted small">' + ico('building') + ' ' + escapeHtml(first.donVi) + '</span>');
        if (first.soTC) meta.push('<span class="badge badge-soft">' + escapeHtml(first.soTC) + ' TC</span>');
        if (first.tuNgay && first.denNgay) {
            meta.push('<span class="muted small">' + ico('calendar') + ' ' +
                formatDateVN(parseDateISO(first.tuNgay)) + ' - ' + formatDateVN(parseDateISO(first.denNgay)) + '</span>');
        }

        var card = document.createElement('div');
        card.className = 'mon-card';
        card.innerHTML =
            '<div class="mon-head">' +
                '<div class="li-name">' +
                    '<span class="badge badge-tag">' + (groupThuLabel(g.sessions) || '—') + '</span>' +
                    '<h4>' + escapeHtml(first.tenHocPhan) + '</h4>' +
                    meta.join('') +
                '</div>' +
            '</div>' +
            '<div class="buoi-list">' + buoiHtml + '</div>';
        container.appendChild(card);
    });
}

/* ------------------------- Modal ------------------------- */

function openModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
    if (modalId === 'addSubjectModal') {
        document.getElementById('subjectForm').reset();
        setSelectedThu([]);
        document.getElementById('fieldGioHocPreview').value = '';
        document.getElementById('fieldId').value = '';
        document.getElementById('modalSubjectTitle').textContent = 'Thêm môn học mới';
    }
}

function editSubject(id) {
    var s = subjectsList.filter(function (x) { return x.id === id; })[0];
    if (!s) { showToast('Không tìm thấy thông tin môn học!', 'error'); return; }

    document.getElementById('fieldId').value = s.id;
    document.getElementById('fieldTenHocPhan').value = s.tenHocPhan || '';
    document.getElementById('fieldLop').value = s.lop || '';
    document.getElementById('fieldSiSo').value = s.siSo || '';
    document.getElementById('fieldSoTC').value = s.soTC || '';
    document.getElementById('fieldTongSoTiet').value = s.tongSoTiet || '';
    document.getElementById('fieldDonVi').value = s.donVi || '';
    setSelectedThu(s.thu);
    document.getElementById('fieldTietHoc').value = s.tietHoc || '';
    document.getElementById('fieldGioHocPreview').value = getGioHoc(s.tietHoc);
    document.getElementById('fieldTuNgay').value = s.tuNgay || '';
    document.getElementById('fieldDenNgay').value = s.denNgay || '';
    document.getElementById('fieldBuoiHoc').value = s.buoiHoc || 'Sáng';
    document.getElementById('fieldPhongHoc').value = s.phongHoc || '';
    document.getElementById('fieldGiangVien').value = s.giangVien || '';
    document.getElementById('fieldHinhThucThi').value = s.hinhThucThi || '';
    document.getElementById('fieldGhiChu').value = s.ghiChu || '';

    document.getElementById('modalSubjectTitle').textContent = 'Chỉnh sửa môn học';
    openModal('addSubjectModal');
}

function handleSubjectFormSubmit(e) {
    e.preventDefault();

    var id = document.getElementById('fieldId').value || 'sub_' + Date.now();
    var thuArr = getSelectedThu();
    if (thuArr.length === 0) {
        showToast('Vui lòng chọn ít nhất một thứ học!', 'warning');
        return;
    }

    var siSoVal = document.getElementById('fieldSiSo').value;
    var soTCVal = document.getElementById('fieldSoTC').value;
    var tongVal = document.getElementById('fieldTongSoTiet').value;

    var subjectObj = {
        id: id,
        tenHocPhan: document.getElementById('fieldTenHocPhan').value.trim(),
        lop: document.getElementById('fieldLop').value.trim(),
        siSo: siSoVal ? parseInt(siSoVal, 10) : '',
        soTC: soTCVal ? parseInt(soTCVal, 10) : '',
        tongSoTiet: tongVal ? parseInt(tongVal, 10) : '',
        thu: thuArr,
        tietHoc: document.getElementById('fieldTietHoc').value.trim(),
        tuNgay: document.getElementById('fieldTuNgay').value,
        denNgay: document.getElementById('fieldDenNgay').value,
        buoiHoc: document.getElementById('fieldBuoiHoc').value,
        phongHoc: document.getElementById('fieldPhongHoc').value.trim(),
        donVi: document.getElementById('fieldDonVi').value.trim(),
        giangVien: document.getElementById('fieldGiangVien').value.trim(),
        hinhThucThi: document.getElementById('fieldHinhThucThi').value.trim(),
        ghiChu: document.getElementById('fieldGhiChu').value.trim()
    };

    var idx = -1;
    for (var i = 0; i < subjectsList.length; i++) {
        if (subjectsList[i].id === id) { idx = i; break; }
    }
    if (idx >= 0) {
        subjectsList[idx] = subjectObj;
        showToast('Đã cập nhật thông tin môn học!', 'success');
    } else {
        subjectsList.push(subjectObj);
        showToast('Đã thêm môn học mới thành công!', 'success');
    }

    saveToLocalStorage();
    if (typeof window.cloudSaveSubject === 'function') window.cloudSaveSubject(subjectObj);

    closeModal('addSubjectModal');
    renderCurrentView();
}

function deleteSubject(id) {
    subjectsList = subjectsList.filter(function (s) { return s.id !== id; });
    saveToLocalStorage();
    if (typeof window.cloudDeleteSubject === 'function') window.cloudDeleteSubject(id);
    renderCurrentView();
    showToast('Đã xóa môn học!', 'info');
}

function confirmClearAll() {
    if (subjectsList.length === 0) return;
    if (!window.confirm('Xóa toàn bộ ' + subjectsList.length + ' môn học?')) return;
    if (typeof window.cloudClearAllSubjects === 'function') window.cloudClearAllSubjects();
    subjectsList = [];
    saveToLocalStorage();
    renderCurrentView();
    showToast('Đã xóa toàn bộ thời khóa biểu!', 'warning');
}

/* ------------------------- OCR ------------------------- */

function toggleApiKeyInput() {
    document.getElementById('apiKeyContainer').classList.toggle('hidden');
    document.getElementById('apiKeyToggle').classList.toggle('open');
}

function handleImageSelected(event) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
        selectedImageBase64 = e.target.result;
        document.getElementById('imagePreview').src = selectedImageBase64;
        document.getElementById('uploadPlaceholder').classList.add('hidden');
        document.getElementById('imagePreviewContainer').classList.remove('hidden');
        document.getElementById('btnProcessOCR').disabled = false;
    };
    reader.readAsDataURL(file);
}

function removeSelectedImage() {
    selectedImageBase64 = null;
    document.getElementById('imageFileInput').value = '';
    document.getElementById('uploadPlaceholder').classList.remove('hidden');
    document.getElementById('imagePreviewContainer').classList.add('hidden');
    document.getElementById('btnProcessOCR').disabled = true;
}

function processImageOCR() {
    if (!selectedImageBase64) {
        showToast('Vui lòng chọn ảnh thời khóa biểu trước!', 'warning');
        return;
    }

    var customKey = document.getElementById('customApiKeyInput').value.trim();
    var apiKey = customKey || SYSTEM_GEMINI_API_KEY || '';
    if (!apiKey) {
        showToast("Chưa có Gemini API Key. Hãy nhập key ở mục 'Cấu hình Gemini API Key' rồi thử lại.", 'warning');
        return;
    }

    var btn = document.getElementById('btnProcessOCR');
    var btnText = document.getElementById('ocrBtnText');
    btn.disabled = true;
    btnText.textContent = 'AI Đang phân tích... (có thể mất 5-10s)';

    var base64Data = selectedImageBase64.split(',')[1];
    var mimeType = selectedImageBase64.split(';')[0].split(':')[1] || 'image/jpeg';
    var apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;

    var systemPrompt = 'Bạn là trợ lý AI đọc Thời khóa biểu đại học Việt Nam. Hãy đọc ảnh và trích xuất dữ liệu chính xác theo cấu trúc JSON yêu cầu. ' +
        'QUAN TRỌNG: mỗi BUỔI HỌC là MỘT phần tử riêng. Nếu một môn học được dạy ở nhiều buổi khác thứ hoặc khác tiết, phải tách thành nhiều phần tử, TUYỆT ĐỐI không gộp nhiều thứ/tiết vào cùng một phần tử.';

    var userPrompt = 'Hãy đọc ảnh thời khóa biểu này và trả về danh sách JSON. QUY TẮC BẮT BUỘC:\n' +
        '1) MỖI BUỔI HỌC LÀ MỘT PHẦN TỬ RIÊNG trong mảng.\n' +
        '2) Nếu một môn học có NHIỀU buổi (khác thứ, hoặc cùng thứ nhưng khác tiết), hãy tạo NHIỀU phần tử cho môn đó — mỗi phần tử là một buổi.\n' +
        '3) TUYỆT ĐỐI KHÔNG gộp nhiều thứ hay nhiều khoảng tiết vào cùng một phần tử. Mỗi phần tử chỉ có MỘT thứ và MỘT khoảng tiết.\n' +
        'Các trường của mỗi phần tử:\n' +
        '- tenHocPhan: Tên học phần/môn học\n' +
        '- lop: Lớp (ví dụ: CNTT01)\n' +
        '- siSo: Sĩ số lớp (số)\n' +
        '- soTC: Số tín chỉ (số)\n' +
        '- tongSoTiet: Tổng số tiết (số)\n' +
        '- thu: MỘT thứ duy nhất của buổi này — chỉ một số từ 2..7 (Thứ 2..Thứ 7) hoặc 8 (Chủ Nhật); KHÔNG dùng dấu "/"\n' +
        '- tietHoc: Chuỗi tiết học của buổi này (ví dụ "1-5", "6-10")\n' +
        '- tuNgay: Ngày bắt đầu dạng YYYY-MM-DD (đổi từ DD.MM.YYYY / DD/MM/YYYY nếu cần)\n' +
        '- denNgay: Ngày kết thúc dạng YYYY-MM-DD\n' +
        '- buoiHoc: "Sáng", "Chiều" hoặc "Tối" (theo tiết của buổi này)\n' +
        '- phongHoc: Tên phòng học\n' +
        '- donVi: Đơn vị/khoa phụ trách (ví dụ: Khoa CNTT)\n' +
        '- giangVien: Tên giảng viên\n' +
        '- hinhThucThi: Hình thức thi (Tự luận, TN trên MT, Thực hành...)\n' +
        '- ghiChu: Ghi chú (có thể là số điện thoại nếu có)';

    var payload = {
        contents: [{
            role: 'user',
            parts: [
                { text: userPrompt },
                { inlineData: { mimeType: mimeType, data: base64Data } }
            ]
        }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        tenHocPhan: { type: 'STRING' },
                        lop: { type: 'STRING' },
                        siSo: { type: 'INTEGER' },
                        soTC: { type: 'INTEGER' },
                        tongSoTiet: { type: 'INTEGER' },
                        thu: { type: 'STRING' },
                        tietHoc: { type: 'STRING' },
                        tuNgay: { type: 'STRING' },
                        denNgay: { type: 'STRING' },
                        buoiHoc: { type: 'STRING' },
                        phongHoc: { type: 'STRING' },
                        donVi: { type: 'STRING' },
                        giangVien: { type: 'STRING' },
                        hinhThucThi: { type: 'STRING' },
                        ghiChu: { type: 'STRING' }
                    },
                    required: ['tenHocPhan', 'thu', 'tuNgay', 'denNgay']
                }
            }
        }
    };

    fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            var jsonText = data && data.candidates && data.candidates[0] &&
                data.candidates[0].content && data.candidates[0].content.parts &&
                data.candidates[0].content.parts[0].text;
            if (!jsonText) throw new Error('Không thể phân tích dữ liệu JSON từ ảnh.');

            var parsedList = JSON.parse(jsonText);
            ocrParsedData = parsedList.map(function (item, idx) {
                var tietHoc = item.tietHoc || '1-5';
                return {
                    id: 'ocr_' + Date.now() + '_' + idx,
                    tenHocPhan: item.tenHocPhan || 'Môn học mới',
                    lop: item.lop || '',
                    siSo: item.siSo === undefined || item.siSo === null ? '' : item.siSo,
                    soTC: item.soTC === undefined || item.soTC === null ? '' : item.soTC,
                    tongSoTiet: item.tongSoTiet === undefined || item.tongSoTiet === null ? '' : item.tongSoTiet,
                    thu: item.thu === undefined || item.thu === null ? '2' : String(item.thu),
                    tietHoc: tietHoc,
                    tuNgay: item.tuNgay || formatDateISO(new Date()),
                    denNgay: item.denNgay || getRelativeDateStr(60),
                    buoiHoc: item.buoiHoc || getBuoiFromTiet(tietHoc) || 'Sáng',
                    phongHoc: item.phongHoc || '',
                    donVi: item.donVi || '',
                    giangVien: item.giangVien || '',
                    hinhThucThi: item.hinhThucThi || 'Tự luận',
                    ghiChu: item.ghiChu || item.sdt || ''
                };
            });

            renderOcrReviewTable();
            showToast('AI đã nhận diện thành công ' + ocrParsedData.length + ' môn học!', 'success');
        })
        .catch(function (err) {
            console.error(err);
            showToast("Chưa phân tích được ảnh. Kiểm tra ảnh hoặc bấm 'Nạp Dữ Liệu Mẫu' để thử nghiệm.", 'warning');
        })
        .then(function () {
            btn.disabled = false;
            btnText.textContent = 'Phân Tích Với Gemini AI';
        });
}

function loadSampleData() {
    ocrParsedData = SAMPLE_SUBJECTS.map(function (s, idx) {
        var copy = {};
        for (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) copy[k] = s[k]; }
        copy.id = 'ocr_sample_' + Date.now() + '_' + idx;
        return copy;
    });
    renderOcrReviewTable();
    showToast('Đã tải dữ liệu mẫu nhận diện!', 'info');
}

function ocrInput(idx, key, value, type, extra) {
    type = type || 'text';
    var attrs = 'value="' + escapeHtml(value) + '" onchange="updateOcrItem(' + idx + ',\'' + key + '\',this.value)"';
    var cls = 'input' + (extra ? ' ' + extra : '');
    return '<input type="' + type + '" ' + attrs + ' class="' + cls + '">';
}

function renderOcrReviewTable() {
    var section = document.getElementById('ocrReviewSection');
    var tbody = document.getElementById('ocrTableBody');
    var badge = document.getElementById('ocrCountBadge');

    section.classList.remove('hidden');
    badge.textContent = ocrParsedData.length + ' môn';
    tbody.innerHTML = '';

    ocrParsedData.forEach(function (row, idx) {
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td class="text-center b muted">' + (idx + 1) + '</td>' +
            '<td>' + ocrInput(idx, 'tenHocPhan', row.tenHocPhan) + '</td>' +
            '<td>' + ocrInput(idx, 'lop', row.lop) + '</td>' +
            '<td>' + ocrInput(idx, 'siSo', row.siSo, 'number') + '</td>' +
            '<td>' + ocrInput(idx, 'soTC', row.soTC, 'number') + '</td>' +
            '<td>' + ocrInput(idx, 'tongSoTiet', row.tongSoTiet, 'number') + '</td>' +
            '<td>' + ocrInput(idx, 'thu', row.thu, 'text') + '</td>' +
            '<td>' + ocrInput(idx, 'tietHoc', row.tietHoc) + '</td>' +
            '<td>' + ocrInput(idx, 'tuNgay', row.tuNgay, 'date') + '</td>' +
            '<td>' + ocrInput(idx, 'denNgay', row.denNgay, 'date') + '</td>' +
            '<td><select onchange="updateOcrItem(' + idx + ',\'buoiHoc\',this.value)" class="input">' +
                '<option value="Sáng"' + (row.buoiHoc === 'Sáng' ? ' selected' : '') + '>Sáng</option>' +
                '<option value="Chiều"' + (row.buoiHoc === 'Chiều' ? ' selected' : '') + '>Chiều</option>' +
                '<option value="Tối"' + (row.buoiHoc === 'Tối' ? ' selected' : '') + '>Tối</option>' +
            '</select></td>' +
            '<td>' + ocrInput(idx, 'phongHoc', row.phongHoc) + '</td>' +
            '<td>' + ocrInput(idx, 'donVi', row.donVi) + '</td>' +
            '<td>' + ocrInput(idx, 'giangVien', row.giangVien) + '</td>' +
            '<td>' + ocrInput(idx, 'hinhThucThi', row.hinhThucThi) + '</td>' +
            '<td>' + ocrInput(idx, 'ghiChu', row.ghiChu) + '</td>' +
            '<td class="text-center"><button class="icon-action danger" onclick="removeOcrRow(' + idx + ')" title="Xóa">' + ico('trash') + '</button></td>';
        tbody.appendChild(tr);
    });
}

function updateOcrItem(index, key, value) {
    if (!ocrParsedData[index]) return;
    if (key === 'soTC' || key === 'tongSoTiet' || key === 'siSo') {
        ocrParsedData[index][key] = value === '' ? '' : parseInt(value, 10);
    } else {
        ocrParsedData[index][key] = value;
    }
}

function addOcrRow() {
    ocrParsedData.push({
        id: 'ocr_manual_' + Date.now(),
        tenHocPhan: 'Môn mới',
        lop: '',
        siSo: '',
        soTC: '',
        tongSoTiet: '',
        thu: '2',
        tietHoc: '1-5',
        tuNgay: formatDateISO(new Date()),
        denNgay: getRelativeDateStr(60),
        buoiHoc: 'Sáng',
        phongHoc: '',
        donVi: '',
        giangVien: '',
        hinhThucThi: '',
        ghiChu: ''
    });
    renderOcrReviewTable();
}

function removeOcrRow(index) {
    ocrParsedData.splice(index, 1);
    renderOcrReviewTable();
}

function saveOcrResultsToSchedule() {
    if (ocrParsedData.length === 0) {
        showToast('Không có môn nào để lưu!', 'warning');
        return;
    }
    var toSave = ocrParsedData.map(function (item) {
        var thuArr = normalizeThu(item.thu);
        var copy = {};
        for (var k in item) { if (Object.prototype.hasOwnProperty.call(item, k)) copy[k] = item[k]; }
        copy.thu = thuArr.length ? thuArr : [2];
        return copy;
    });

    subjectsList = subjectsList.concat(toSave);
    saveToLocalStorage();
    toSave.forEach(function (item) {
        if (typeof window.cloudSaveSubject === 'function') window.cloudSaveSubject(item);
    });

    renderCurrentView();
    showToast('Đã nhập thành công ' + toSave.length + ' môn vào thời khóa biểu!', 'success');
    switchTab('todayTab');
}

/* ------------------------- Toast ------------------------- */

function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toastContainer');
    var iconMap = { success: 'check', warning: 'warn', info: 'info', error: 'x' };
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = ico(iconMap[type] || 'info') + '<span class="grow">' + escapeHtml(message) + '</span>';
    container.appendChild(toast);

    requestAnimationFrame(function () { toast.classList.add('show'); });
    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () { toast.remove(); }, 300);
    }, 3500);
}

/* ------------------------- Khởi động ------------------------- */

function init() {
    loadFromLocalStorage();
    document.getElementById('selectedDateInput').value = formatDateISO(selectedDate);
    initThuChips();
    renderPeriodTable();
    renderCurrentView();
}

/* ------------------------- Điều khiển bởi màn đăng nhập ------------------------- */

function setAppVisible(visible) {
    var main = document.querySelector('main.page');
    var tabs = document.querySelector('.tabs');
    var addBtn = document.getElementById('addSubjectBtn');
    if (main) main.classList.toggle('hidden', !visible);
    if (tabs) tabs.classList.toggle('hidden', !visible);
    if (addBtn) addBtn.classList.toggle('hidden', !visible);
}

window.startUniSchedule = function (user) {
    currentUid = user ? user.uid : null;
    setAppVisible(true);
    init();
    if (currentUid && !(user && user.guest)) setupCloudSync(user);
};

// Quyết định có nên mời người dùng tải TKB cục bộ lên tài khoản rồi mở đồng bộ.
function setupCloudSync(user) {
    if (typeof window.initSync !== 'function') return;

    var localList = subjectsList.slice();
    var localOwner = null;
    try { localOwner = localStorage.getItem('UNI_LAST_UID'); } catch (e) { /* bỏ qua */ }
    // Đánh dấu chủ sở hữu cache NGAY (không xoá khi đăng xuất) để máy dùng chung không lộ dữ liệu.
    try { localStorage.setItem('UNI_LAST_UID', user.uid); } catch (e) { /* bỏ qua */ }

    function proceed() { window.initSync(user); }

    if (!localList.length || typeof window.cloudSubjectsEmpty !== 'function') {
        proceed();
        return;
    }

    window.cloudSubjectsEmpty(user).then(function (empty) {
        var eligible = typeof window.shouldOfferUpload === 'function' && window.shouldOfferUpload({
            localOwner: localOwner,
            uid: user.uid,
            hasLocalData: localList.length > 0,
            hasCloudData: !empty
        });
        if (!eligible) { proceed(); return; }

        if (window.confirm('Bạn có ' + localList.length + ' môn học lưu trên máy này. Tải lên tài khoản của bạn?')) {
            window.migrateLocalToCloud(user, localList).then(proceed).catch(function (e) {
                console.warn('Lỗi tải TKB lên cloud:', e);
                proceed();
            });
        } else {
            showToast('Giữ dữ liệu trên máy. Đồng bộ cloud tạm tắt cho phiên này.', 'info');
        }
    }).catch(function (e) {
        console.warn('Lỗi kiểm tra cloud:', e);
        proceed();
    });
}

window.stopUniSchedule = function () {
    currentUid = null;
    subjectsList = [];
    setAppVisible(false);
    if (typeof window.teardownSync === 'function') window.teardownSync();
};
