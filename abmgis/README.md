# ABMGIS — NetLogo × PMTiles

ABMGIS là bản web hoá mô hình `segregationDC.nlogo` trong `Week 6.zip`, kết hợp tư duy Agent-Based Modeling của NetLogo với GIS web bằng MapLibre GL JS và PMTiles.

## Mục tiêu

- Chạy trực tiếp trên GitHub Pages, không cần Java/JVM hoặc backend.
- Giao diện tiếng Việt, responsive.
- Bảo toàn logic mô hình Schelling từ NetLogo: `setup → move → update-colors → tick`.
- Dùng đúng 188 polygon và 1.130 quan hệ láng giềng từ dữ liệu gốc.
- Hiển thị nền PMTiles bằng MapLibre; mô phỏng cập nhật màu polygon theo trạng thái tác tử.
- Giữ cả mô hình NetLogo gốc và một bản web hoá trong `model/`.

## Cấu trúc

```text
abmgis/
├── index.html
├── styles.css
├── app.js
├── data/
│   ├── dc.geojson
│   ├── neighbors.json
│   └── metadata.json
└── model/
    ├── segregationDC-original.nlogo
    └── segregationDC-web.nlogo
```

## Vì sao không chạy nguyên xi file `.nlogo`?

Mô hình gốc dùng `extensions [gis]` và `file-open/file-read` để đọc `neighbors.txt`. NetLogo Web chạy trong trình duyệt nên không có file-system như NetLogo Desktop. Bản web thay phần I/O này bằng JSON/HTTP nhưng giữ cấu trúc thuật toán và topology của mô hình.

## PMTiles

Ứng dụng đăng ký `pmtiles://` protocol cho MapLibre bằng `pmtiles.js` và dùng PMTiles vector demo của MapLibre làm nền mặc định. Có fallback sang OpenFreeMap nếu nguồn demo PMTiles không tải được.

## Chạy local

Do trình duyệt chặn `fetch()` khi mở trực tiếp bằng `file://`, hãy chạy một static server:

```bash
cd abmgis
python -m http.server 8000
```

Sau đó mở `http://localhost:8000`.

## GitHub Pages

Workflow `.github/workflows/abmgis-pages.yml` đóng gói thư mục `abmgis/` và deploy lên GitHub Pages sau mỗi push vào `main` có thay đổi liên quan.